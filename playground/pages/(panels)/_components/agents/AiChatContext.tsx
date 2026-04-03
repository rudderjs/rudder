import { createContext, useContext, useState, useCallback, useRef } from 'react'
import type { OnFieldUpdate } from './AgentOutput.js'

// ─── Agent run request ──────────────────────────────────────

export interface AgentRunRequest {
  agentSlug:    string
  agentLabel:   string
  resourceSlug: string
  recordId:     string
  apiBase:      string
  input?:       string
}

// ─── Chat message ──────────────────────────────────────────

export interface ChatMessage {
  id:   string
  role: 'user' | 'assistant'
  text: string
}

// ─── Context shape ──────────────────────────────────────────

interface AiChatContextValue {
  /** Whether the chat panel is open. */
  open: boolean
  setOpen: (v: boolean) => void

  /** Trigger an agent run — auto-opens the chat panel. */
  triggerRun: (run: AgentRunRequest) => void

  /** The current (or most recent) agent run request. */
  currentRun: AgentRunRequest | null

  /** Incremented each time triggerRun is called — used as a key to restart the SSE hook. */
  runKey: number

  /** Field updates from agent tool calls — append-only array for SchemaForm animation. */
  fieldUpdates: Array<{ field: string; value: string }>

  /** Called by AiChatPanel when agent updates a field via SSE tool_call. */
  onFieldUpdate: OnFieldUpdate

  /** Clear field updates (e.g. on navigation). */
  clearFieldUpdates: () => void

  /** Chat messages for free-form conversation. */
  messages: ChatMessage[]

  /** Send a free-form chat message. */
  sendMessage: (text: string) => void

  /** Whether the AI is generating a response. */
  isGenerating: boolean

  /** Clear the conversation. */
  clearMessages: () => void
}

const AiChatContext = createContext<AiChatContextValue | null>(null)

// ─── Provider ───────────────────────────────────────────────

export function AiChatProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen]           = useState(false)
  const [currentRun, setCurrentRun] = useState<AgentRunRequest | null>(null)
  const [runKey, setRunKey]       = useState(0)
  const [fieldUpdates, setFieldUpdates] = useState<Array<{ field: string; value: string }>>([])
  const [messages, setMessages]   = useState<ChatMessage[]>([])
  const [isGenerating, setIsGenerating] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const triggerRun = useCallback((run: AgentRunRequest) => {
    setOpen(true)
    setCurrentRun(run)
    setRunKey(k => k + 1)
    setFieldUpdates([])
  }, [])

  const onFieldUpdate: OnFieldUpdate = useCallback((field, value) => {
    setFieldUpdates(prev => [...prev, { field, value }])
  }, [])

  const clearFieldUpdates = useCallback(() => {
    setFieldUpdates([])
  }, [])

  const sendMessage = useCallback((text: string) => {
    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: 'user', text }
    const assistantId = crypto.randomUUID()

    setMessages(prev => [...prev, userMsg])
    setIsGenerating(true)

    // Abort any in-flight request
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    // Add empty assistant message that we'll stream into
    setMessages(prev => [...prev, { id: assistantId, role: 'assistant', text: '' }])

    // Stream response from /api/ai/stream
    fetch('/api/ai/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text }),
      signal: ctrl.signal,
    }).then(async (resp) => {
      if (!resp.ok || !resp.body) {
        setMessages(prev => prev.map(m =>
          m.id === assistantId ? { ...m, text: `Error: HTTP ${resp.status}` } : m
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

        // Parse SSE lines
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const data = JSON.parse(line.slice(6)) as { text?: string }
            if (data.text) {
              setMessages(prev => prev.map(m =>
                m.id === assistantId ? { ...m, text: m.text + data.text } : m
              ))
            }
          } catch { /* skip malformed */ }
        }
      }
      setIsGenerating(false)
    }).catch((err) => {
      if ((err as Error).name !== 'AbortError') {
        setMessages(prev => prev.map(m =>
          m.id === assistantId ? { ...m, text: `Error: ${(err as Error).message}` } : m
        ))
      }
      setIsGenerating(false)
    })
  }, [])

  const clearMessages = useCallback(() => {
    abortRef.current?.abort()
    setMessages([])
    setIsGenerating(false)
    setCurrentRun(null)
  }, [])

  return (
    <AiChatContext.Provider value={{
      open, setOpen,
      triggerRun, currentRun, runKey,
      fieldUpdates, onFieldUpdate, clearFieldUpdates,
      messages, sendMessage, isGenerating, clearMessages,
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
