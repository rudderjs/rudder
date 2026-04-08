import { useState, useEffect, useRef } from 'react'
import type { PanelAgentMeta } from '@rudderjs/panels'

// ─── SSE event types ────────────────────────────────────────

interface TextEvent   { text: string }
interface ToolEvent   { tool: string; input?: Record<string, unknown> }
interface CompleteEvent { text: string; usage: { promptTokens: number; completionTokens: number; totalTokens: number }; steps: number }
interface ErrorEvent  { message: string }

type OutputEntry =
  | { type: 'text'; text: string }
  | { type: 'tool_call'; tool: string; input?: Record<string, unknown> }
  | { type: 'complete'; data: CompleteEvent }
  | { type: 'error'; message: string }

// ─── Hook: run agent via SSE ────────────────────────────────

export type AgentStatus = 'idle' | 'running' | 'complete' | 'error'

/** Called when the agent updates a field — the value should be animated into the form. */
export type OnFieldUpdate = (field: string, value: string) => void

export function useAgentRun(apiBase: string, resourceSlug: string, onFieldUpdate?: OnFieldUpdate) {
  const [entries, setEntries] = useState<OutputEntry[]>([])
  const [status, setStatus]   = useState<AgentStatus>('idle')
  const abortRef = useRef<AbortController | null>(null)
  const onFieldUpdateRef = useRef(onFieldUpdate)
  onFieldUpdateRef.current = onFieldUpdate

  function run(agentSlug: string, recordId: string, input?: string) {
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    setEntries([])
    setStatus('running')

    const url = `${apiBase}/${resourceSlug}/${recordId}/_agents/${agentSlug}`

    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input }),
      signal: ctrl.signal,
    }).then(async (resp) => {
      if (!resp.ok || !resp.body) {
        setStatus('error')
        setEntries(prev => [...prev, { type: 'error', message: `HTTP ${resp.status}` }])
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

        let currentEvent = ''
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7)
          } else if (line.startsWith('data: ') && currentEvent) {
            try {
              const data = JSON.parse(line.slice(6))
              switch (currentEvent) {
                case 'text':
                  setEntries(prev => {
                    const last = prev[prev.length - 1]
                    if (last?.type === 'text') {
                      return [...prev.slice(0, -1), { type: 'text', text: last.text + (data as TextEvent).text }]
                    }
                    return [...prev, { type: 'text', text: (data as TextEvent).text }]
                  })
                  break
                case 'tool_call': {
                  const toolData = data as ToolEvent
                  setEntries(prev => [...prev, { type: 'tool_call', ...toolData }])
                  // Notify parent to animate the field update
                  if (toolData.tool === 'update_field' && toolData.input?.field && toolData.input?.value != null) {
                    onFieldUpdateRef.current?.(toolData.input.field as string, toolData.input.value as string)
                  }
                  break
                }
                case 'complete':
                  setEntries(prev => [...prev, { type: 'complete', data: data as CompleteEvent }])
                  setStatus('complete')
                  break
                case 'error':
                  setEntries(prev => [...prev, { type: 'error', message: (data as ErrorEvent).message }])
                  setStatus('error')
                  break
              }
            } catch { /* skip malformed JSON */ }
            currentEvent = ''
          }
        }
      }
    }).catch((err) => {
      if ((err as Error).name !== 'AbortError') {
        setStatus('error')
        setEntries(prev => [...prev, { type: 'error', message: (err as Error).message }])
      }
    })
  }

  function reset() {
    abortRef.current?.abort()
    setEntries([])
    setStatus('idle')
  }

  useEffect(() => () => { abortRef.current?.abort() }, [])

  return { entries, status, run, reset }
}

// ─── Output renderer ────────────────────────────────────────

interface AgentOutputProps {
  entries: OutputEntry[]
  status:  AgentStatus
}

export function AgentOutput({ entries, status }: AgentOutputProps) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Scroll within the sidebar container only — not the whole page
    const el = bottomRef.current
    if (el?.parentElement) {
      el.parentElement.scrollTop = el.parentElement.scrollHeight
    }
  }, [entries.length])

  if (entries.length === 0 && status === 'idle') return null

  return (
    <div className="space-y-2 text-sm">
      {entries.map((entry, i) => {
        switch (entry.type) {
          case 'text':
            return (
              <div key={i} className="text-foreground whitespace-pre-wrap">
                {entry.text}
              </div>
            )
          case 'tool_call':
            return (
              <div key={i} className="flex items-center gap-2 text-muted-foreground">
                <svg className="w-3.5 h-3.5 text-primary shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                <span>Updated <span className="font-medium text-foreground">{(entry as { input?: Record<string, unknown> }).input?.field as string ?? entry.tool.replace('update_', '')}</span></span>
              </div>
            )
          case 'complete':
            return (
              <div key={i} className="pt-2 border-t text-muted-foreground">
                Done — {entry.data.steps} step{entry.data.steps !== 1 ? 's' : ''}, {entry.data.usage.totalTokens} tokens
              </div>
            )
          case 'error':
            return (
              <div key={i} className="text-red-600 dark:text-red-400">
                Error: {entry.message}
              </div>
            )
        }
      })}

      {status === 'running' && (
        <div className="flex items-center gap-2 text-muted-foreground">
          <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
          Thinking...
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  )
}
