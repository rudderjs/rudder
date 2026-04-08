import { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react'
import type { ResourceAgentMeta } from '@rudderjs/panels'
import { executeClientTool, hasClientTool } from './clientTools.js'

// ─── Chat message parts (structured content) ───────────────

export type ChatMessagePart =
  | { type: 'text'; text: string }
  | { type: 'tool_call'; tool: string; input?: Record<string, unknown>; id?: string }
  | { type: 'tool_result'; tool: string; result?: unknown; id?: string }
  | { type: 'agent_start'; agentSlug: string; agentLabel: string }
  | { type: 'complete'; steps: number; tokens: number }
  | { type: 'error'; message: string }
  | {
      type:         'approval_request'
      toolCall:     { id: string; name: string; arguments: Record<string, unknown> }
      isClientTool: boolean
      /** Set once the user clicks one of the buttons. The card stays in the
       * conversation as a record of the decision. */
      resolved?:    'approved' | 'rejected'
    }

// ─── Wire-format message (matches @rudderjs/ai AiMessage) ──

interface WireToolCall {
  id:        string
  name:      string
  arguments: Record<string, unknown>
}

interface WireMessage {
  role:        'system' | 'user' | 'assistant' | 'tool'
  content:     string
  toolCallId?: string
  toolCalls?:  WireToolCall[]
}

// ─── Pending approval (surfaced to UI for the modal) ───────

export interface PendingApproval {
  toolCall:     WireToolCall
  isClientTool: boolean
}

// ─── Chat message ──────────────────────────────────────────

export interface ChatMessage {
  id:     string
  role:   'user' | 'assistant'
  text:   string              // concatenated text (backward compat + plain chat)
  parts?: ChatMessagePart[]   // structured content for rich rendering
  /** Text selection that was active when this message was sent (user messages only). */
  selection?: TextSelection | undefined
}

// ─── Agent run request (from FormActions dropdown) ──────────

export interface AgentRunRequest {
  agentSlug:    string
  agentLabel:   string
  resourceSlug: string
  recordId:     string
  apiBase:      string
  input?:       string
}

// ─── Resource context (set by edit page) ────────────────────

export interface ResourceContext {
  resourceSlug: string
  recordId:     string
  apiBase:      string
  agents:       ResourceAgentMeta[]
}

// ─── Conversation list item ─────────────────────────────────

export interface ConversationItem {
  id:        string
  title:     string
  createdAt: string
  updatedAt?: string
}

// ─── Text selection (from editor) ───────────────────────────

export interface TextSelection {
  field: string
  text:  string
}

// ─── Field update callback ──────────────────────────────────

export type OnFieldUpdate = (field: string, value: string) => void

// ─── Context shape ──────────────────────────────────────────

interface AiChatContextValue {
  /** Whether the chat panel is open. */
  open: boolean
  setOpen: (v: boolean) => void

  /** Trigger an agent run — adds to chat and runs via forceAgent. */
  triggerRun: (run: AgentRunRequest) => void

  /** Field updates from agent tool calls — append-only array for SchemaForm animation. */
  fieldUpdates: Array<{ field: string; value: string }>

  /** Called when agent updates a field via SSE tool_call. */
  onFieldUpdate: OnFieldUpdate

  /** Clear field updates (e.g. on navigation). */
  clearFieldUpdates: () => void

  /** Chat messages. */
  messages: ChatMessage[]

  /** Send a free-form chat message (or with forceAgent hint). */
  sendMessage: (text: string, opts?: { forceAgent?: string }) => void

  /** Whether the AI is generating a response. */
  isGenerating: boolean

  /** Clear the conversation. */
  clearMessages: () => void

  /** Resource context — set by edit page, null on other pages. */
  resourceContext: ResourceContext | null
  setResourceContext: (ctx: ResourceContext | null) => void

  /** Current conversation ID (null = no conversation yet). */
  conversationId: string | null

  /** Recent conversations list. */
  conversations: ConversationItem[]

  /** Whether the conversation list overlay is visible. */
  showConversations: boolean
  setShowConversations: (v: boolean) => void

  /** Load a specific conversation's messages. */
  loadConversation: (id: string) => Promise<void>

  /** Fetch the conversations list. */
  loadConversations: () => Promise<void>

  /** Start a new conversation (clears current). */
  newConversation: () => void

  /** Delete a conversation. */
  deleteConversation: (id: string) => Promise<void>

  /** Available AI models. */
  models: Array<{ id: string; label: string }>

  /** Currently selected model (null = default). */
  selectedModel: string | null
  setSelectedModel: (model: string | null) => void

  /** Text selection from an editor field — sent as context to AI. */
  selection: TextSelection | null
  setSelection: (sel: TextSelection | null) => void

  /** A tool call awaiting user approval (null when none). */
  pendingApproval: PendingApproval | null

  /** Approve the currently-pending tool call. Re-submits the chat. */
  approvePending: () => void

  /** Reject the currently-pending tool call. Re-submits the chat. */
  rejectPending: () => void
}

const AiChatContext = createContext<AiChatContextValue | null>(null)

// ─── SSE parser helper ──────────────────────────────────────
//
// Mutable state collected across all chunks of a single chat turn. Used by
// `runChatTurn` to know what happened during streaming and act on it after
// the connection closes (e.g. execute pending client tools, surface a
// pending approval to the UI, decide whether to re-POST).

interface TurnState {
  assistantText:        string
  assistantToolCalls:   WireToolCall[]
  /** Server-side tool results streamed via `tool_result` SSE events. We append
   * these to `wireMessagesRef` after the assistant message so the wire log
   * mirrors what the server persisted, which lets a follow-up continuation pass
   * the prefix check in `continuation.ts`. Order is arrival order (== execution
   * order in the agent loop). See docs/plans/mixed-tool-continuation-plan.md. */
  serverToolResults:    WireMessage[]
  pendingClientTools:   WireToolCall[]
  pendingApproval:      PendingApproval | null
  done:                 boolean
}

function newTurnState(): TurnState {
  return {
    assistantText:      '',
    assistantToolCalls: [],
    serverToolResults:  [],
    pendingClientTools: [],
    pendingApproval:    null,
    done:               false,
  }
}

function parseSSELines(
  lines: string[],
  assistantId: string,
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>,
  onFieldUpdateRef: React.RefObject<OnFieldUpdate | undefined>,
  turnState: TurnState,
  onConversation?: (convId: string, isNew: boolean) => void,
) {
  let currentEvent = ''

  for (const line of lines) {
    if (line.startsWith('event: ')) {
      currentEvent = line.slice(7)
    } else if (line.startsWith('data: ') && currentEvent) {
      try {
        const data = JSON.parse(line.slice(6))

        switch (currentEvent) {
          case 'conversation': {
            const convData = data as { conversationId: string; isNew: boolean }
            onConversation?.(convData.conversationId, convData.isNew)
            break
          }

          case 'text': {
            const text = (data as { text: string }).text
            turnState.assistantText += text
            setMessages(prev => prev.map(m => {
              if (m.id !== assistantId) return m
              // Append to text parts or create new one
              const parts = [...(m.parts ?? [])]
              const lastPart = parts[parts.length - 1]
              if (lastPart?.type === 'text') {
                parts[parts.length - 1] = { type: 'text', text: lastPart.text + text }
              } else {
                parts.push({ type: 'text', text })
              }
              return { ...m, text: m.text + text, parts }
            }))
            break
          }

          case 'tool_call': {
            const toolData = data as { id?: string; tool: string; input?: Record<string, unknown> }
            // Track wire-format tool call so a possible continuation can
            // round-trip the assistant message correctly.
            turnState.assistantToolCalls.push({
              id:        toolData.id ?? crypto.randomUUID(),
              name:      toolData.tool,
              arguments: toolData.input ?? {},
            })
            setMessages(prev => prev.map(m => {
              if (m.id !== assistantId) return m
              const part: ChatMessagePart = { type: 'tool_call', tool: toolData.tool }
              if (toolData.input !== undefined) part.input = toolData.input
              if (toolData.id    !== undefined) part.id    = toolData.id
              const parts = [...(m.parts ?? []), part]
              return { ...m, parts }
            }))
            // Trigger field animation for update_field
            if (toolData.tool === 'update_field' && toolData.input?.field && toolData.input?.value != null) {
              onFieldUpdateRef.current?.(toolData.input.field as string, toolData.input.value as string)
            }
            break
          }

          case 'tool_result': {
            // Server-side tool result. Buffer it for the wire log so a
            // follow-up continuation can present a prefix that matches what
            // the server persisted. Also surface inline in the assistant
            // bubble so users see what each tool actually returned.
            const resultData = data as { id?: string; tool?: string; toolCallId?: string; content: string }
            const toolCallId = resultData.toolCallId ?? resultData.id
            if (toolCallId) {
              turnState.serverToolResults.push({
                role:       'tool',
                content:    resultData.content,
                toolCallId,
              })
            }
            setMessages(prev => prev.map(m => {
              if (m.id !== assistantId) return m
              const part: ChatMessagePart = {
                type:   'tool_result',
                tool:   resultData.tool ?? 'unknown',
                result: resultData.content,
              }
              if (toolCallId) part.id = toolCallId
              return { ...m, parts: [...(m.parts ?? []), part] }
            }))
            break
          }

          case 'pending_client_tools': {
            const pendingData = data as { toolCalls: WireToolCall[] }
            turnState.pendingClientTools = pendingData.toolCalls ?? []
            break
          }

          case 'tool_approval_required': {
            const approvalData = data as { toolCall: WireToolCall; isClientTool: boolean }
            turnState.pendingApproval = {
              toolCall:     approvalData.toolCall,
              isClientTool: approvalData.isClientTool,
            }
            // Also surface the approval card inline in the assistant bubble.
            setMessages(prev => prev.map(m => {
              if (m.id !== assistantId) return m
              const part: ChatMessagePart = {
                type:         'approval_request',
                toolCall:     approvalData.toolCall,
                isClientTool: approvalData.isClientTool,
              }
              return { ...m, parts: [...(m.parts ?? []), part] }
            }))
            break
          }

          case 'agent_start': {
            const agentData = data as { agentSlug: string; agentLabel: string }
            setMessages(prev => prev.map(m => {
              if (m.id !== assistantId) return m
              const parts = [...(m.parts ?? []), { type: 'agent_start' as const, ...agentData }]
              return { ...m, parts }
            }))
            break
          }

          case 'agent_complete':
          case 'complete': {
            const completeData = data as { steps?: number; usage?: { totalTokens?: number }; tokens?: number; done?: boolean; awaiting?: string }
            if (completeData.done === true) turnState.done = true
            const steps = completeData.steps ?? 0
            const tokens = completeData.tokens ?? completeData.usage?.totalTokens ?? 0
            if (steps > 0 || tokens > 0) {
              setMessages(prev => prev.map(m => {
                if (m.id !== assistantId) return m
                const parts = [...(m.parts ?? []), { type: 'complete' as const, steps, tokens }]
                return { ...m, parts }
              }))
            }
            break
          }

          case 'error': {
            const errData = data as { message: string }
            setMessages(prev => prev.map(m => {
              if (m.id !== assistantId) return m
              const parts = [...(m.parts ?? []), { type: 'error' as const, message: errData.message }]
              return { ...m, parts }
            }))
            break
          }
        }
      } catch { /* skip malformed JSON */ }
      currentEvent = ''
    }
  }
}

// ─── Provider ───────────────────────────────────────────────

export function AiChatProvider({ children, panelPath }: { children: React.ReactNode; panelPath?: string }) {
  const [open, setOpen] = useState(false)
  const [fieldUpdates, setFieldUpdates] = useState<Array<{ field: string; value: string }>>([])
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isGenerating, setIsGenerating] = useState(false)
  const [resourceContext, setResourceContextState] = useState<ResourceContext | null>(null)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [conversations, setConversations] = useState<ConversationItem[]>([])
  const [models, setModels] = useState<Array<{ id: string; label: string }>>([])
  const [selectedModel, setSelectedModelState] = useState<string | null>(null)
  const selectedModelRef = useRef<string | null>(null)
  const [showConversations, setShowConversations] = useState(false)
  const [selection, setSelectionState] = useState<TextSelection | null>(null)
  const selectionRef = useRef<TextSelection | null>(null)
  const resourceContextRef = useRef<ResourceContext | null>(null)
  const conversationIdRef = useRef<string | null>(null)
  const panelApiBase = panelPath ? `${panelPath}/api` : ''
  const restoredRef = useRef(false)
  const abortRef = useRef<AbortController | null>(null)
  const onFieldUpdateRef = useRef<OnFieldUpdate | undefined>(undefined)

  // Wire-format conversation kept in lockstep with what the server has
  // persisted, plus anything we've appended locally during a continuation
  // round-trip. Used to re-POST as `body.messages`. Reset whenever the
  // conversation changes.
  const wireMessagesRef = useRef<WireMessage[]>([])

  // Pending approval (surfaced to UI) — also stashed for re-submission.
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null)
  const pendingApprovalAssistantIdRef = useRef<string | null>(null)

  // Keep refs in sync with state
  resourceContextRef.current = resourceContext
  conversationIdRef.current = conversationId
  selectedModelRef.current = selectedModel
  selectionRef.current = selection

  const setSelectedModel = useCallback((model: string | null) => {
    selectedModelRef.current = model
    setSelectedModelState(model)
  }, [])

  const setResourceContext = useCallback((ctx: ResourceContext | null) => {
    resourceContextRef.current = ctx
    setResourceContextState(ctx)
  }, [])

  const setSelection = useCallback((sel: TextSelection | null) => {
    selectionRef.current = sel
    setSelectionState(sel)
  }, [])

  // Fetch available models on mount
  useEffect(() => {
    if (!panelApiBase) return
    fetch(`${panelApiBase}/_chat/models`)
      .then(r => r.ok ? r.json() : null)
      .then((data: { models: Array<{ id: string; label: string }>; default: string } | null) => {
        if (data?.models?.length) setModels(data.models)
      })
      .catch(() => {})
  }, [panelApiBase])

  // Restore most recent conversation on mount
  useEffect(() => {
    if (restoredRef.current || !panelApiBase) return
    restoredRef.current = true

    fetch(`${panelApiBase}/_chat/conversations`)
      .then(r => r.ok ? r.json() : null)
      .then((data: { conversations: ConversationItem[] } | null) => {
        const latest = data?.conversations?.[0]
        if (!latest || conversationIdRef.current) return
        fetch(`${panelApiBase}/_chat/conversations/${latest.id}`)
          .then(r => r.ok ? r.json() : null)
          .then((convData: { messages: WireMessage[] } | null) => {
            if (!convData?.messages?.length || conversationIdRef.current) return
            wireMessagesRef.current = convData.messages
            const loaded: ChatMessage[] = convData.messages
              .filter(m => m.role === 'user' || m.role === 'assistant')
              .map(m => ({
                id: crypto.randomUUID(),
                role: m.role as 'user' | 'assistant',
                text: m.content,
                parts: [{ type: 'text' as const, text: m.content }],
              }))
            setMessages(loaded)
            setConversationId(latest.id)
            conversationIdRef.current = latest.id
          })
          .catch(() => {})
      })
      .catch(() => {})
  }, [panelApiBase])

  const onFieldUpdate: OnFieldUpdate = useCallback((field, value) => {
    setFieldUpdates(prev => [...prev, { field, value }])
  }, [])

  // Keep refs in sync
  onFieldUpdateRef.current = onFieldUpdate

  const clearFieldUpdates = useCallback(() => {
    setFieldUpdates([])
  }, [])

  /**
   * Run one POST + SSE-stream cycle. Recursively calls itself to handle
   * client-tool round-trips. For approval-required stops, surfaces the tool
   * call to UI state and exits; the caller decides what to do next via
   * `approvePending` / `rejectPending`.
   */
  const runChatTurn = useCallback(async (params: {
    assistantId:    string
    body:           Record<string, unknown>
    url:            string
    usePanelChat:   boolean
    abortCtrl:      AbortController
    onConversation: (convId: string, isNew: boolean) => void
  }): Promise<void> => {
    const { assistantId, body, url, usePanelChat, abortCtrl, onConversation } = params
    const turnState = newTurnState()

    let resp: Response
    try {
      resp = await fetch(url, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
        signal:  abortCtrl.signal,
      })
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setMessages(prev => prev.map(m =>
          m.id === assistantId
            ? { ...m, text: `Error: ${(err as Error).message}`, parts: [{ type: 'error', message: (err as Error).message }] }
            : m,
        ))
      }
      return
    }

    if (!resp.ok || !resp.body) {
      setMessages(prev => prev.map(m =>
        m.id === assistantId
          ? { ...m, text: `Error: HTTP ${resp.status}`, parts: [{ type: 'error', message: `HTTP ${resp.status}` }] }
          : m,
      ))
      return
    }

    const reader  = resp.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      if (usePanelChat) {
        parseSSELines(lines, assistantId, setMessages, onFieldUpdateRef, turnState, onConversation)
      } else {
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const data = JSON.parse(line.slice(6)) as { text?: string; done?: boolean }
            if (data.text) {
              setMessages(prev => prev.map(m => {
                if (m.id !== assistantId) return m
                const parts = [...(m.parts ?? [])]
                const lastPart = parts[parts.length - 1]
                if (lastPart?.type === 'text') {
                  parts[parts.length - 1] = { type: 'text', text: lastPart.text + data.text }
                } else {
                  parts.push({ type: 'text', text: data.text! })
                }
                return { ...m, text: m.text + data.text, parts }
              }))
            }
          } catch { /* skip */ }
        }
      }
    }

    // Stream closed. Build the assistant message in wire format and append
    // it to the running conversation log.
    const assistantMsg: WireMessage = {
      role:    'assistant',
      content: turnState.assistantText,
      ...(turnState.assistantToolCalls.length > 0 ? { toolCalls: turnState.assistantToolCalls } : {}),
    }
    wireMessagesRef.current = [
      ...wireMessagesRef.current,
      assistantMsg,
      // Server-side tool results land BEFORE any client-tool results so the
      // wire log mirrors the persisted shape `[..., assistant, tool{server}]`
      // (client tool results, if any, are appended below as the new tail).
      // This is what unblocks mixed-tool turns through the continuation
      // prefix check.
      ...turnState.serverToolResults,
    ]

    // ── Client tools pending: execute locally and re-POST ────
    if (turnState.pendingClientTools.length > 0) {
      const toolMessages: WireMessage[] = []
      for (const tc of turnState.pendingClientTools) {
        let resultStr: string
        if (hasClientTool(tc.name)) {
          try {
            const result = await executeClientTool(tc.name, tc.arguments)
            resultStr = typeof result === 'string' ? result : JSON.stringify(result)
          } catch (err) {
            resultStr = JSON.stringify({ error: (err as Error).message })
          }
        } else {
          resultStr = JSON.stringify({ error: `No client handler for tool "${tc.name}"` })
        }
        toolMessages.push({ role: 'tool', content: resultStr, toolCallId: tc.id })
        // Visualise the result inline in the assistant message
        setMessages(prev => prev.map(m => {
          if (m.id !== assistantId) return m
          const parts = [...(m.parts ?? []), { type: 'tool_result' as const, tool: tc.name, result: resultStr, id: tc.id }]
          return { ...m, parts }
        }))
      }
      wireMessagesRef.current = [...wireMessagesRef.current, ...toolMessages]

      // Continuation request — strips fresh-prompt-only fields and hands the
      // server the full wire log via `messages`. Pull conversationId from the
      // ref (not the original body) because a brand-new conversation only
      // gets its id mid-stream via the `conversation` SSE event.
      const continuationBody: Record<string, unknown> = { ...body, messages: wireMessagesRef.current }
      delete continuationBody.message
      delete continuationBody.selection
      delete continuationBody.forceAgent
      if (conversationIdRef.current) continuationBody.conversationId = conversationIdRef.current

      await runChatTurn({ assistantId, body: continuationBody, url, usePanelChat, abortCtrl, onConversation })
      return
    }

    // ── Approval pending: surface to UI, await decision ──────
    if (turnState.pendingApproval) {
      pendingApprovalAssistantIdRef.current = assistantId
      setPendingApproval(turnState.pendingApproval)
      // Keep `isGenerating` true until the user decides — runChatTurn will
      // be re-invoked from approvePending/rejectPending.
    }
  }, [])

  const sendMessage = useCallback((text: string, opts?: { forceAgent?: string }) => {
    // Snapshot selection before clearing — attach to user message for display
    const msgSelection = selectionRef.current ?? undefined
    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: 'user', text, selection: msgSelection }
    const assistantId = crypto.randomUUID()

    setMessages(prev => [...prev, userMsg, { id: assistantId, role: 'assistant', text: '', parts: [] }])
    setIsGenerating(true)
    setFieldUpdates([])
    // Clear selection after sending (it's been captured in the request body + user message)
    setSelectionState(null)
    selectionRef.current = null

    // Abort any in-flight request
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    // Read from refs for latest state
    const rc = resourceContextRef.current
    const usePanelChat = !!panelApiBase
    const url = usePanelChat
      ? `${panelApiBase}/_chat`
      : '/api/ai/stream'

    const body: Record<string, unknown> = { message: text }

    if (usePanelChat) {
      // Send conversationId (server manages history)
      if (conversationIdRef.current) {
        body.conversationId = conversationIdRef.current
      }
      // Send selected model
      if (selectedModelRef.current) {
        body.model = selectedModelRef.current
      }
      // Include resource context if on a resource edit page
      if (rc) {
        body.resourceContext = {
          resourceSlug: rc.resourceSlug,
          recordId: rc.recordId,
        }
      }
      if (opts?.forceAgent) {
        body.forceAgent = opts.forceAgent
      }
      // Include text selection context if present (use snapshot �� ref is already cleared)
      if (msgSelection) {
        body.selection = msgSelection
      }
    }

    // Handle conversation ID from SSE
    const onConversation = (convId: string, _isNew: boolean) => {
      setConversationId(convId)
      conversationIdRef.current = convId
    }

    // Track this user message in the wire log so a possible continuation can
    // re-POST it as part of `body.messages`.
    wireMessagesRef.current = [...wireMessagesRef.current, { role: 'user', content: text }]

    void runChatTurn({ assistantId, body, url, usePanelChat, abortCtrl: ctrl, onConversation })
      .finally(() => {
        // Only stop the spinner if we are not waiting on user approval.
        if (!pendingApprovalAssistantIdRef.current) setIsGenerating(false)
      })
  }, [panelApiBase, runChatTurn])  // eslint-disable-line react-hooks/exhaustive-deps

  // ── Approval decision → re-submit ─────────────────────────

  const submitApprovalDecision = useCallback((approve: boolean) => {
    const pa = pendingApproval
    const assistantId = pendingApprovalAssistantIdRef.current
    if (!pa || !assistantId) return
    setPendingApproval(null)
    pendingApprovalAssistantIdRef.current = null

    // Mark the inline approval card as resolved so it stops showing buttons.
    const decision: 'approved' | 'rejected' = approve ? 'approved' : 'rejected'
    setMessages(prev => prev.map(m => {
      if (m.id !== assistantId) return m
      const parts = (m.parts ?? []).map(p =>
        p.type === 'approval_request' && p.toolCall.id === pa.toolCall.id
          ? { ...p, resolved: decision }
          : p,
      )
      return { ...m, parts }
    }))

    const usePanelChat = !!panelApiBase
    const url = usePanelChat ? `${panelApiBase}/_chat` : '/api/ai/stream'
    const ctrl = new AbortController()
    abortRef.current?.abort()
    abortRef.current = ctrl

    const continuationBody: Record<string, unknown> = { messages: wireMessagesRef.current }
    if (conversationIdRef.current) continuationBody.conversationId = conversationIdRef.current
    if (selectedModelRef.current)   continuationBody.model          = selectedModelRef.current
    const rc = resourceContextRef.current
    if (rc) continuationBody.resourceContext = { resourceSlug: rc.resourceSlug, recordId: rc.recordId }
    if (approve) continuationBody.approvedToolCallIds = [pa.toolCall.id]
    else         continuationBody.rejectedToolCallIds = [pa.toolCall.id]

    const onConversation = (convId: string, _isNew: boolean) => {
      setConversationId(convId)
      conversationIdRef.current = convId
    }

    void runChatTurn({ assistantId, body: continuationBody, url, usePanelChat, abortCtrl: ctrl, onConversation })
      .finally(() => {
        if (!pendingApprovalAssistantIdRef.current) setIsGenerating(false)
      })
  }, [pendingApproval, panelApiBase, runChatTurn])

  const approvePending = useCallback(() => submitApprovalDecision(true),  [submitApprovalDecision])
  const rejectPending  = useCallback(() => submitApprovalDecision(false), [submitApprovalDecision])

  const triggerRun = useCallback((run: AgentRunRequest) => {
    setOpen(true)
    // Ensure resource context is set for the agent run
    setResourceContext({
      resourceSlug: run.resourceSlug,
      recordId: run.recordId,
      apiBase: run.apiBase,
      agents: [], // agents list not needed for forceAgent
    })
    // Small delay to let resourceContext update before sendMessage reads it
    setTimeout(() => {
      sendMessage(`Run "${run.agentLabel}"`, { forceAgent: run.agentSlug })
    }, 0)
  }, [sendMessage])

  const clearMessages = useCallback(() => {
    abortRef.current?.abort()
    setMessages([])
    setConversationId(null)
    conversationIdRef.current = null
    wireMessagesRef.current = []
    setPendingApproval(null)
    pendingApprovalAssistantIdRef.current = null
    setIsGenerating(false)
  }, [])

  const newConversation = useCallback(() => {
    abortRef.current?.abort()
    setMessages([])
    setConversationId(null)
    conversationIdRef.current = null
    wireMessagesRef.current = []
    setPendingApproval(null)
    pendingApprovalAssistantIdRef.current = null
    setIsGenerating(false)
    setShowConversations(false)
  }, [])

  const getApiBase = useCallback(() => {
    return panelApiBase
  }, [panelApiBase])

  const loadConversations = useCallback(async () => {
    const apiBase = getApiBase()
    if (!apiBase) return
    try {
      const rc = resourceContextRef.current
      const params = new URLSearchParams()
      if (rc?.resourceSlug) params.set('resourceSlug', rc.resourceSlug)
      if (rc?.recordId) params.set('recordId', rc.recordId)
      const url = `${apiBase}/_chat/conversations${params.toString() ? `?${params}` : ''}`
      const resp = await fetch(url)
      if (resp.ok) {
        const data = await resp.json() as { conversations: ConversationItem[] }
        setConversations(data.conversations ?? [])
      }
    } catch { /* failed to load conversations */ }
  }, [getApiBase])

  const loadConversation = useCallback(async (id: string) => {
    const apiBase = getApiBase()
    if (!apiBase) return
    try {
      const resp = await fetch(`${apiBase}/_chat/conversations/${id}`)
      if (resp.ok) {
        const data = await resp.json() as { messages: WireMessage[] }
        const all = data.messages ?? []
        // Mirror full wire-format conversation so a continuation re-POST has
        // the entire prefix to satisfy server-side validation.
        wireMessagesRef.current = all
        const loaded: ChatMessage[] = all
          .filter(m => m.role === 'user' || m.role === 'assistant')
          .map(m => ({
            id: crypto.randomUUID(),
            role: m.role as 'user' | 'assistant',
            text: m.content,
            parts: [{ type: 'text' as const, text: m.content }],
          }))
        setMessages(loaded)
        setConversationId(id)
        conversationIdRef.current = id
        setPendingApproval(null)
        pendingApprovalAssistantIdRef.current = null
        setShowConversations(false)
      }
    } catch { /* failed to load conversation */ }
  }, [getApiBase])

  const deleteConversation = useCallback(async (id: string) => {
    const apiBase = getApiBase()
    if (!apiBase) return
    try {
      await fetch(`${apiBase}/_chat/conversations/${id}`, { method: 'DELETE' })
      setConversations(prev => prev.filter(c => c.id !== id))
      // If deleting the active conversation, clear it
      if (conversationIdRef.current === id) {
        newConversation()
      }
    } catch { /* failed to delete */ }
  }, [getApiBase, newConversation])

  return (
    <AiChatContext.Provider value={{
      open, setOpen,
      triggerRun,
      fieldUpdates, onFieldUpdate, clearFieldUpdates,
      messages, sendMessage, isGenerating, clearMessages,
      resourceContext, setResourceContext,
      conversationId, conversations, showConversations, setShowConversations,
      loadConversation, loadConversations, newConversation, deleteConversation,
      models, selectedModel, setSelectedModel,
      selection, setSelection,
      pendingApproval, approvePending, rejectPending,
    }}>
      {children}
    </AiChatContext.Provider>
  )
}

// ─── Hook ───────────────────────────────────────────────────

export function useAiChat(): AiChatContextValue {
  const ctx = useContext(AiChatContext)
  if (!ctx) throw new Error('useAiChat must be used within AiChatProvider')
  return ctx
}

/** Safe variant — returns null when AiChatProvider is not mounted. */
export function useAiChatSafe(): AiChatContextValue | null {
  return useContext(AiChatContext)
}
