import { createContext, useContext, useState, useCallback, useRef } from 'react'
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
}

const AiChatContext = createContext<AiChatContextValue | null>(null)

// ─── SSE parser helper ──────────────────────────────────────

function parseSSELines(
  lines: string[],
  assistantId: string,
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>,
  onFieldUpdateRef: React.RefObject<OnFieldUpdate | undefined>,
) {
  let currentEvent = ''

  for (const line of lines) {
    if (line.startsWith('event: ')) {
      currentEvent = line.slice(7)
    } else if (line.startsWith('data: ') && currentEvent) {
      try {
        const data = JSON.parse(line.slice(6))

        switch (currentEvent) {
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

export function AiChatProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const [fieldUpdates, setFieldUpdates] = useState<Array<{ field: string; value: string }>>([])
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isGenerating, setIsGenerating] = useState(false)
  const [resourceContext, setResourceContextState] = useState<ResourceContext | null>(null)
  const resourceContextRef = useRef<ResourceContext | null>(null)
  const messagesRef = useRef<ChatMessage[]>([])
  const abortRef = useRef<AbortController | null>(null)
  const onFieldUpdateRef = useRef<OnFieldUpdate | undefined>(undefined)

  // Keep refs in sync with state
  resourceContextRef.current = resourceContext
  messagesRef.current = messages

  const setResourceContext = useCallback((ctx: ResourceContext | null) => {
    resourceContextRef.current = ctx
    setResourceContextState(ctx)
  }, [])

  const onFieldUpdate: OnFieldUpdate = useCallback((field, value) => {
    setFieldUpdates(prev => [...prev, { field, value }])
  }, [])

  // Keep ref in sync
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

    // Abort any in-flight request
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    // Read from refs for latest state
    const rc = resourceContextRef.current
    const hasResourceContext = !!rc
    const url = hasResourceContext
      ? `${rc!.apiBase}/_chat`
      : '/api/ai/stream'

    const body: Record<string, unknown> = { message: text }

    if (hasResourceContext) {
      // Include conversation history (last 20 messages)
      body.history = messagesRef.current.slice(-20).map(m => ({ role: m.role, content: m.text }))
      body.resourceContext = {
        resourceSlug: rc!.resourceSlug,
        recordId: rc!.recordId,
      }
      if (opts?.forceAgent) {
        body.forceAgent = opts.forceAgent
      }
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

        if (hasResourceContext) {
          // Panel chat endpoint — named SSE events
          parseSSELines(lines, assistantId, setMessages, onFieldUpdateRef)
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
    setIsGenerating(false)
  }, [])

  return (
    <AiChatContext.Provider value={{
      open, setOpen,
      triggerRun,
      fieldUpdates, onFieldUpdate, clearFieldUpdates,
      messages, sendMessage, isGenerating, clearMessages,
      resourceContext, setResourceContext,
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
