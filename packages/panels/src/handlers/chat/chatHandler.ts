import type { AppRequest, AppResponse } from '@rudderjs/core'
import type { AiMessage, ConversationStoreMeta } from '@rudderjs/ai'
import type { Panel } from '../../Panel.js'
import type { ChatRequestBody, SSESend, ConversationStoreLike } from './types.js'
import { extractUserId, resolveConversationStore, createSSEStream } from './types.js'
import { loadAi } from './lazyImports.js'
import { resolveContext } from './contexts/resolveContext.js'
import { ChatContextError, type ChatContext } from './contexts/types.js'
import { ResourceChatContext } from './contexts/ResourceChatContext.js'
import { persistConversation } from './persistence.js'

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

  // 2. Resolve conversation store + load history
  let store: ConversationStoreLike | null = null
  try { store = await resolveConversationStore() } catch { /* no store */ }

  let conversationId = body.conversationId
  let loadedHistory: AiMessage[] = []

  if (store) {
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
  // Legacy fallback: if no store, accept history off the request body
  if (!store && body.history && body.history.length > 0) {
    loadedHistory = body.history.map(h => ({ role: h.role, content: h.content })) as AiMessage[]
  }

  // 3. Run the chat (fire-and-forget — SSE pumps from the stream)
  void runChat({ send, close, context, body, loadedHistory, conversationId, store }).catch(err => {
    send('error', { message: err instanceof Error ? err.message : 'Chat failed.' })
    close()
  })

  // 4. Return SSE response
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
  send:           SSESend
  close:          () => void
  context:        ChatContext
  body:           ChatRequestBody
  loadedHistory:  AiMessage[]
  conversationId: string | undefined
  store:          ConversationStoreLike | null
}

async function runChat(deps: RunChatDeps): Promise<void> {
  const { send, close, context, body, loadedHistory, conversationId, store } = deps

  // Force-agent branch — only meaningful for ResourceChatContext.
  // The current ResourceAgent path doesn't go through agent() at all; it
  // calls agentDef.stream() directly, so we keep it as a localized branch
  // here rather than pretending it folds into the main loop.
  if (context.kind === 'resource') {
    const resCtx = context as ResourceChatContext
    const forceAgent = resCtx.getForceAgent()
    if (forceAgent) {
      const userInput = body.message ?? extractLastUserMessage(body.messages) ?? ''
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

  const userInput = body.message ?? extractLastUserMessage(body.messages) ?? ''
  const transformedInput = context.transformUserInput(userInput, loadedHistory)

  try {
    const a = agentFn({
      instructions: systemPrompt,
      tools:        tools.length > 0 ? tools : undefined,
      model:        body.model,
    })

    const { stream, response } = a.stream(transformedInput, {
      history: loadedHistory.length > 0 ? loadedHistory : undefined,
    })

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
    send('complete', { done: true, usage: result.usage, steps: result.steps.length })

    if (conversationId && store) {
      await persistConversation(store, conversationId, userInput, result, loadedHistory.length === 0)
    }
  } finally {
    close()
  }
}

// ─── Force-agent branch (lifted from old handleForceAgent) ──

interface RunForceAgentDeps {
  send:     SSESend
  agentDef: import('../../agents/ResourceAgent.js').ResourceAgent
  agentCtx: import('../../agents/ResourceAgent.js').ResourceAgentContext
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

// ─── Helpers ────────────────────────────────────────────────

function extractLastUserMessage(messages: AiMessage[] | undefined): string | undefined {
  if (!messages || messages.length === 0) return undefined
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m && m.role === 'user' && typeof m.content === 'string') return m.content
  }
  return undefined
}

/* eslint-enable @typescript-eslint/no-explicit-any */
