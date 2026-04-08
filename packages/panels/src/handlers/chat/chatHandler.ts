import type { AppRequest, AppResponse } from '@rudderjs/core'
import type { AiMessage, ConversationStoreMeta } from '@rudderjs/ai'
import type { Panel } from '../../Panel.js'
import type { ChatRequestBody, SSESend, ConversationStoreLike } from './types.js'
import { extractUserId, resolveConversationStore, createSSEStream } from './types.js'
import { loadAi } from './lazyImports.js'
import { resolveContext } from './contexts/resolveContext.js'
import { ChatContextError, type ChatContext } from './contexts/types.js'
import { ResourceChatContext } from './contexts/ResourceChatContext.js'
import { persistConversation, persistContinuation } from './persistence.js'
import { validateContinuation, ContinuationError } from './continuation.js'

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

  const { readable, send, close } = createSSEStream()

  // 1. Resolve context FIRST — may throw ChatContextError → return JSON 4xx.
  // Safe because the readable is not wired to the Response until the very end
  // of this function; an orphan readable just gets garbage collected.
  let context: ChatContext
  try {
    context = await resolveContext({ body, panel, req, send })
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

  // Force-agent branch — only meaningful for ResourceChatContext.
  // The current PanelAgent path doesn't go through agent() at all; it
  // calls agentDef.stream() directly, so we keep it as a localized branch
  // here rather than pretending it folds into the main loop.
  if (context.kind === 'resource' && !continuationMessages) {
    const resCtx = context as ResourceChatContext
    const forceAgent = resCtx.getForceAgent()
    if (forceAgent) {
      const userInput = body.message ?? ''
      await runForceAgent({
        send,
        agentDef: forceAgent,
        agentCtx: resCtx.getAgentContext(),
        input:    userInput,
      })
      close()
      return
    }
  }

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

    for await (const chunk of stream) {
      switch (chunk.type) {
        case 'text-delta':
          if (chunk.text) send('text', { text: chunk.text })
          break
        case 'tool-call':
          send('tool_call', {
            id:    chunk.toolCall?.id,
            tool:  chunk.toolCall?.name,
            input: chunk.toolCall?.arguments,
          })
          break
        case 'tool-result':
          // Forward server-side tool results so the browser can build a
          // wireMessagesRef that mirrors the persisted state. The `content`
          // string MUST match what persistence.ts writes (string passthrough,
          // otherwise JSON.stringify) so the continuation prefix check passes.
          // See docs/plans/mixed-tool-continuation-plan.md.
          send('tool_result', {
            id:         chunk.toolCall?.id,
            tool:       chunk.toolCall?.name,
            toolCallId: chunk.toolCall?.id,
            content:    typeof chunk.result === 'string' ? chunk.result : JSON.stringify(chunk.result),
          })
          break
        case 'pending-client-tools':
          send('pending_client_tools', { toolCalls: chunk.toolCalls ?? [] })
          break
        case 'pending-approval':
          send('tool_approval_required', {
            toolCall:     chunk.toolCall,
            isClientTool: chunk.isClientTool ?? false,
          })
          break
      }
    }

    const result = await response

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

// ─── Force-agent branch (lifted from old handleForceAgent) ──

interface RunForceAgentDeps {
  send:     SSESend
  agentDef: import('../../agents/PanelAgent.js').PanelAgent
  agentCtx: import('../../agents/PanelAgent.js').PanelAgentContext
  input:    string
}

async function runForceAgent(deps: RunForceAgentDeps): Promise<void> {
  const { send, agentDef, agentCtx, input } = deps
  send('agent_start', { agentSlug: agentDef.getSlug(), agentLabel: (agentDef as any)._label })

  try {
    const { stream, response } = await agentDef.stream(agentCtx, input)

    for await (const chunk of stream) {
      switch (chunk.type) {
        case 'text-delta':
          if (chunk.text) send('text', { text: chunk.text })
          break
        case 'tool-call':
          send('tool_call', { tool: chunk.toolCall?.name, input: chunk.toolCall?.arguments })
          break
      }
    }

    const result = await response
    send('agent_complete', { steps: result.steps.length, tokens: result.usage?.totalTokens ?? 0 })
    send('complete', { done: true })
  } catch (err) {
    send('error', { message: err instanceof Error ? err.message : 'Agent run failed.' })
  }
}

/* eslint-enable @typescript-eslint/no-explicit-any */
