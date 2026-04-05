import { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react'
import type { ResourceAgentMeta } from '@rudderjs/panels'

// ─── Chat message parts (structured content) ───────────────

export type ChatMessagePart =
  | { type: 'text'; text: string }
  | { type: 'tool_call'; tool: string; input?: Record<string, unknown> }
  | { type: 'agent_start'; agentSlug: string; agentLabel: string }
  | { type: 'complete'; steps: number; tokens: number }
  | { type: 'error'; message: string }

// ─── Chat message ──────────────────────────────────────────

export interface ChatMessage {
  id:     string
  role:   'user' | 'assistant'
  text:   string              // concatenated text (backward compat + plain chat)
  parts?: ChatMessagePart[]   // structured content for rich rendering
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
}

const AiChatContext = createContext<AiChatContextValue | null>(null)

// ─── SSE parser helper ──────────────────────────────────────

function parseSSELines(
  lines: string[],
  assistantId: string,
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>,
  onFieldUpdateRef: React.RefObject<OnFieldUpdate | undefined>,
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
            const toolData = data as { tool: string; input?: Record<string, unknown> }
            setMessages(prev => prev.map(m => {
              if (m.id !== assistantId) return m
              const parts = [...(m.parts ?? []), { type: 'tool_call' as const, tool: toolData.tool, input: toolData.input }]
              return { ...m, parts }
            }))
            // Trigger field animation for update_field
            if (toolData.tool === 'update_field' && toolData.input?.field && toolData.input?.value != null) {
              onFieldUpdateRef.current?.(toolData.input.field as string, toolData.input.value as string)
            }
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
            const completeData = data as { steps?: number; usage?: { totalTokens?: number }; tokens?: number; done?: boolean }
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
          .then((convData: { messages: Array<{ role: string; content: string }> } | null) => {
            if (!convData?.messages?.length || conversationIdRef.current) return
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

  const sendMessage = useCallback((text: string, opts?: { forceAgent?: string }) => {
    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: 'user', text }
    const assistantId = crypto.randomUUID()

    setMessages(prev => [...prev, userMsg, { id: assistantId, role: 'assistant', text: '', parts: [] }])
    setIsGenerating(true)
    setFieldUpdates([])
    // Clear selection after sending (it's been captured in the request body)
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
      // Include text selection context if present
      if (selectionRef.current) {
        body.selection = selectionRef.current
      }
    }

    // Handle conversation ID from SSE
    const onConversation = (convId: string, _isNew: boolean) => {
      setConversationId(convId)
      conversationIdRef.current = convId
    }

    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    }).then(async (resp) => {
      if (!resp.ok || !resp.body) {
        setMessages(prev => prev.map(m =>
          m.id === assistantId
            ? { ...m, text: `Error: HTTP ${resp.status}`, parts: [{ type: 'error', message: `HTTP ${resp.status}` }] }
            : m
        ))
        setIsGenerating(false)
        return
      }

      const reader = resp.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        if (usePanelChat) {
          // Panel chat endpoint — named SSE events
          parseSSELines(lines, assistantId, setMessages, onFieldUpdateRef, onConversation)
        } else {
          // Fallback /api/ai/stream — simple data-only SSE
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
      setIsGenerating(false)
    }).catch((err) => {
      if ((err as Error).name !== 'AbortError') {
        setMessages(prev => prev.map(m =>
          m.id === assistantId
            ? { ...m, text: `Error: ${(err as Error).message}`, parts: [{ type: 'error', message: (err as Error).message }] }
            : m
        ))
      }
      setIsGenerating(false)
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

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
    setIsGenerating(false)
  }, [])

  const newConversation = useCallback(() => {
    abortRef.current?.abort()
    setMessages([])
    setConversationId(null)
    conversationIdRef.current = null
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
        const data = await resp.json() as { messages: Array<{ role: string; content: string }> }
        const loaded: ChatMessage[] = (data.messages ?? [])
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
