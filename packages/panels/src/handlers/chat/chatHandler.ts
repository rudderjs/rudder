import type { AppRequest, AppResponse } from '@rudderjs/core'
import type { AiMessage, ConversationStoreMeta } from '@rudderjs/ai'
import type { Panel } from '../../Panel.js'
import type { ChatRequestBody, SSESend, ConversationStoreLike } from './types.js'
import { extractUserId, resolveConversationStore, createSSEStream } from './types.js'
import { loadAi } from './lazyImports.js'
import { resolveContext } from './contexts/resolveContext.js'
import { ChatContextError, type ChatContext } from './contexts/types.js'
import { persistConversation, persistContinuation } from './persistence.js'
import { validateContinuation, ContinuationError } from './continuation.js'
import { streamAgentToSSE } from '../agentStream/index.js'
import { handleSubAgentResume } from './subAgentResume.js'

/* eslint-disable @typescript-eslint/no-explicit-any */

// ─── Main handler ───────────────────────────────────────────

export async function handlePanelChat(
  req:   AppRequest,
  res:   AppResponse,
  panel: Panel,
): Promise<unknown> {
  let body: ChatRequestBody
  try {
    body = req.body as ChatRequestBody
    if (!body?.message && !body?.messages) {
      return res.status(400).json({ message: 'Missing "message" or "messages".' })
    }
  } catch {
    return res.status(400).json({ message: 'Invalid request body.' })
  }

  const isContinuation = Array.isArray(body.messages) && body.messages.length > 0
  const isSubRunResume = typeof body.subRunId === 'string' && body.subRunId.length > 0

  const { readable, send, close } = createSSEStream()

  // Sub-run resume path — short-circuits the normal chat flow. The
  // sub-run dispatcher owns context resolution (it synthesizes a
  // resourceContext from stored state), validation (pending-id coverage
  // + ownership guards), and SSE output. Does NOT go through resolveContext,
  // runChat, or persistConversation below.
  if (isSubRunResume) {
    let store: ConversationStoreLike | null = null
    try { store = await resolveConversationStore() } catch { /* no store */ }

    // Sub-run resume requires a conversationId to resume the parent
    // chat agent against its persisted history. Without one, the
    // dispatcher still resumes the sub-agent itself but skips the
    // parent-loop drive-forward — see subAgentResume.ts.
    const convId = body.conversationId
    if (convId) send('conversation', { conversationId: convId, isNew: false })

    void handleSubAgentResume({
      req, body, panel, send, close, store,
      conversationId: convId,
    }).catch(err => {
      send('error', { message: err instanceof Error ? err.message : 'Sub-run resume failed.' })
      close()
    })

    const c = res.raw as { header(key: string, value: string): void; res: unknown }
    c.res = new Response(readable, {
      headers: {
        'Content-Type':  'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection':    'keep-alive',
      },
    })
    return c.res
  }

  // 1. Resolve context FIRST — may throw ChatContextError → return JSON 4xx.
  // Safe because the readable is not wired to the Response until the very end
  // of this function; an orphan readable just gets garbage collected.
  let context: ChatContext
  try {
    context = await resolveContext({ body, panel, req })
  } catch (err) {
    if (err instanceof ChatContextError) {
      return res.status(err.status).json({ message: err.message })
    }
    throw err
  }

  // 2. Resolve conversation store
  let store: ConversationStoreLike | null = null
  try { store = await resolveConversationStore() } catch { /* no store */ }

  let conversationId = body.conversationId
  let loadedHistory: AiMessage[] = []
  let continuationMessages: AiMessage[] | undefined

  // 3a. Continuation flow: validate body.messages against persisted conversation
  if (isContinuation) {
    if (!store) {
      return res.status(400).json({ message: 'Continuation requires a conversation store.' })
    }
    if (!conversationId) {
      return res.status(400).json({ message: 'Continuation requires "conversationId".' })
    }
    try {
      continuationMessages = await validateContinuation({
        store,
        conversationId,
        bodyMessages:        body.messages!,
        approvedToolCallIds: body.approvedToolCallIds,
        rejectedToolCallIds: body.rejectedToolCallIds,
      })
    } catch (err) {
      if (err instanceof ContinuationError) {
        return res.status(err.status).json({ message: err.message })
      }
      throw err
    }
    send('conversation', { conversationId, isNew: false })
  }
  // 3b. Fresh-prompt flow: load (or create) conversation history
  else if (store) {
    try {
      if (conversationId) {
        if (context.shouldLoadHistory()) {
          loadedHistory = await store.load(conversationId)
        }
      } else {
        const meta: ConversationStoreMeta = { ...context.getConversationMeta() }
        const reqUserId = extractUserId(req)
        if (reqUserId && !meta.userId) meta.userId = reqUserId
        conversationId = await store.create(undefined, meta)
      }
      send('conversation', { conversationId, isNew: !body.conversationId })
    } catch {
      store = null
    }
  }
  // 3c. Legacy fallback: no store, accept history off the request body
  if (!isContinuation && !store && body.history && body.history.length > 0) {
    loadedHistory = body.history.map(h => ({ role: h.role, content: h.content })) as AiMessage[]
  }

  // 4. Run the chat (fire-and-forget — SSE pumps from the stream)
  void runChat({
    send, close, context, body, loadedHistory, continuationMessages,
    conversationId, store,
  }).catch(err => {
    send('error', { message: err instanceof Error ? err.message : 'Chat failed.' })
    close()
  })

  // 5. Return SSE response
  const c = res.raw as { header(key: string, value: string): void; res: unknown }
  c.res = new Response(readable, {
    headers: {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection':    'keep-alive',
    },
  })
  return c.res
}

// ─── Shared agent loop ──────────────────────────────────────

interface RunChatDeps {
  send:                 SSESend
  close:                () => void
  context:              ChatContext
  body:                 ChatRequestBody
  loadedHistory:        AiMessage[]
  continuationMessages: AiMessage[] | undefined
  conversationId:       string | undefined
  store:                ConversationStoreLike | null
}

async function runChat(deps: RunChatDeps): Promise<void> {
  const { send, close, context, body, loadedHistory, continuationMessages, conversationId, store } = deps

  // Normal agent loop
  const { agent: agentFn } = await loadAi()
  const systemPrompt = context.buildSystemPrompt()
  const tools = context.buildTools()

  const userInput = body.message ?? ''
  const transformedInput = continuationMessages
    ? userInput
    : context.transformUserInput(userInput, loadedHistory)

  try {
    const a = agentFn({
      instructions: systemPrompt,
      tools:        tools.length > 0 ? tools : undefined,
      model:        body.model,
    })

    const promptOpts: {
      history?: AiMessage[]
      messages?: AiMessage[]
      toolCallStreamingMode?: 'placeholder' | 'stop-on-client-tool'
      approvedToolCallIds?: string[]
      rejectedToolCallIds?: string[]
    } = {
      toolCallStreamingMode: 'stop-on-client-tool',
    }
    if (continuationMessages) {
      promptOpts.messages = continuationMessages
    } else if (loadedHistory.length > 0) {
      promptOpts.history = loadedHistory
    }
    if (body.approvedToolCallIds && body.approvedToolCallIds.length > 0) {
      promptOpts.approvedToolCallIds = body.approvedToolCallIds
    }
    if (body.rejectedToolCallIds && body.rejectedToolCallIds.length > 0) {
      promptOpts.rejectedToolCallIds = body.rejectedToolCallIds
    }

    const { stream, response } = a.stream(transformedInput, promptOpts)
    const result = await streamAgentToSSE({ stream, response, send })

    // Persistence — branch on whether this was a fresh prompt or continuation.
    if (conversationId && store) {
      if (continuationMessages) {
        await persistContinuation(store, conversationId, continuationMessages, result)
      } else {
        await persistConversation(store, conversationId, userInput, result, loadedHistory.length === 0)
      }
    }

    if (result.finishReason === 'client_tool_calls') {
      send('complete', { done: false, awaiting: 'client_tools', usage: result.usage, steps: result.steps.length })
    } else if (result.finishReason === 'tool_approval_required') {
      send('complete', { done: false, awaiting: 'approval', usage: result.usage, steps: result.steps.length })
    } else {
      send('complete', { done: true, usage: result.usage, steps: result.steps.length })
    }
  } finally {
    close()
  }
}

/* eslint-enable @typescript-eslint/no-explicit-any */
