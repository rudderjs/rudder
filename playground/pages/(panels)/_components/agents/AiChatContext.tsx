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
}

const AiChatContext = createContext<AiChatContextValue | null>(null)

// ─── Provider ───────────────────────────────────────────────

export function AiChatProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen]           = useState(false)
  const [currentRun, setCurrentRun] = useState<AgentRunRequest | null>(null)
  const [runKey, setRunKey]       = useState(0)
  const [fieldUpdates, setFieldUpdates] = useState<Array<{ field: string; value: string }>>([])

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

  return (
    <AiChatContext.Provider value={{
      open, setOpen,
      triggerRun, currentRun, runKey,
      fieldUpdates, onFieldUpdate, clearFieldUpdates,
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
