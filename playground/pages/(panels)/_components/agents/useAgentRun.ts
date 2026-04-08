import { useState, useEffect, useRef } from 'react'
import { executeClientTool, hasClientTool } from './clientTools.js'

// ─── SSE event types ────────────────────────────────────────

interface TextEvent       { text: string }
interface ToolCallEvent   { id?: string; tool: string; input?: Record<string, unknown> }
interface ToolResultEvent { id?: string; tool: string; toolCallId: string; content: string }
interface CompleteEvent   { done?: boolean; awaiting?: 'client_tools' | 'approval'; text?: string; usage: { promptTokens: number; completionTokens: number; totalTokens: number }; steps: number }
interface ErrorEvent      { message: string }
interface RunStartedEvent { runId: string }
interface PendingClientToolsEvent { toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> }

type OutputEntry =
  | { type: 'text'; text: string }
  | { type: 'tool_call'; tool: string; input?: Record<string, unknown> }
  | { type: 'complete'; data: CompleteEvent }
  | { type: 'error'; message: string }

// ─── Wire-format messages (matches @rudderjs/ai AiMessage shape) ─────

interface WireToolCall {
  id:        string
  name:      string
  arguments: Record<string, unknown>
}

interface WireMessage {
  role:        'user' | 'assistant' | 'tool'
  content:     string
  toolCalls?:  WireToolCall[]
  toolCallId?: string
}

// ─── Hook: run agent via SSE (with client-tool round-trip support) ───

export type AgentStatus = 'idle' | 'running' | 'complete' | 'error'

/** Called when the agent updates a field — the value should be animated into the form. */
export type OnFieldUpdate = (field: string, value: string) => void

/** Optional run-time options. */
export interface RunOptions {
  /** Field-scope override — for per-field action button clicks. */
  field?: string
}

export function useAgentRun(apiBase: string, resourceSlug: string, onFieldUpdate?: OnFieldUpdate) {
  const [entries, setEntries] = useState<OutputEntry[]>([])
  const [status, setStatus]   = useState<AgentStatus>('idle')
  const abortRef = useRef<AbortController | null>(null)
  const onFieldUpdateRef = useRef(onFieldUpdate)
  onFieldUpdateRef.current = onFieldUpdate

  function run(agentSlug: string, recordId: string, input?: string, opts?: RunOptions) {
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    setEntries([])
    setStatus('running')

    const baseUrl = `${apiBase}/${resourceSlug}/${recordId}/_agents/${agentSlug}`
    const continueUrl = `${baseUrl}/continue`

    // Per-run conversation log used to build continuation messages when the
    // server pauses for client-tool round-trips. Mirrors the chat path's
    // `wireMessagesRef` pattern (`AiChatContext.tsx:559-573`).
    const wireMessages: WireMessage[] = [
      { role: 'user', content: input ?? 'Run your task on this record.' },
    ]

    void streamRequest(baseUrl, { input, ...(opts?.field ? { field: opts.field } : {}) })
      .catch((err) => {
        if ((err as Error).name !== 'AbortError') {
          setStatus('error')
          setEntries(prev => [...prev, { type: 'error', message: (err as Error).message }])
        }
      })

    /**
     * POST a request and consume the SSE response. On a `pending_client_tools`
     * pause, executes the registered handlers, builds the continuation
     * messages, and recursively POSTs to `/continue` until the loop finishes.
     */
    async function streamRequest(url: string, body: Record<string, unknown>): Promise<void> {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      })

      if (!resp.ok || !resp.body) {
        setStatus('error')
        setEntries(prev => [...prev, { type: 'error', message: `HTTP ${resp.status}` }])
        return
      }

      // Per-fetch turn state — captures everything the server emits during
      // ONE streaming response so we can assemble the assistant message and
      // tool result messages for any subsequent continuation.
      const turn = {
        assistantText:    '',
        assistantToolCalls: [] as WireToolCall[],
        serverToolResults:  [] as WireMessage[],
        pendingClientTools: [] as PendingClientToolsEvent['toolCalls'],
        runId:            undefined as string | undefined,
        finished:         false,    // 'complete' or 'error' arrived
        awaiting:         undefined as 'client_tools' | 'approval' | undefined,
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
              handleEvent(currentEvent, data, turn)
            } catch { /* skip malformed JSON */ }
            currentEvent = ''
          }
        }
      }

      // Stream closed. Append the assistant message + server tool results to
      // the running conversation log so any continuation request mirrors the
      // shape the @rudderjs/ai loop expects.
      const assistantMsg: WireMessage = {
        role:    'assistant',
        content: turn.assistantText,
        ...(turn.assistantToolCalls.length > 0 ? { toolCalls: turn.assistantToolCalls } : {}),
      }
      wireMessages.push(assistantMsg, ...turn.serverToolResults)

      // ── Pending client tools: execute locally and POST /continue ────
      if (turn.awaiting === 'client_tools' && turn.pendingClientTools.length > 0 && turn.runId) {
        const toolMessages: WireMessage[] = []
        for (const tc of turn.pendingClientTools) {
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
        }
        wireMessages.push(...toolMessages)

        // Recurse with the continuation. Errors propagate to the .catch() in
        // the outer run() call.
        await streamRequest(continueUrl, {
          runId:    turn.runId,
          messages: wireMessages,
        })
      }
    }

    /**
     * Apply a single SSE event to the per-turn state and emit a UI entry
     * where appropriate. Mutates `turn` in place; pure UI side effects via
     * `setEntries` / `setStatus` and the field-update callback.
     */
    function handleEvent(event: string, data: unknown, turn: {
      assistantText: string
      assistantToolCalls: WireToolCall[]
      serverToolResults: WireMessage[]
      pendingClientTools: PendingClientToolsEvent['toolCalls']
      runId: string | undefined
      finished: boolean
      awaiting: 'client_tools' | 'approval' | undefined
    }): void {
      switch (event) {
        case 'text': {
          const text = (data as TextEvent).text
          turn.assistantText += text
          setEntries(prev => {
            const last = prev[prev.length - 1]
            if (last?.type === 'text') {
              return [...prev.slice(0, -1), { type: 'text', text: last.text + text }]
            }
            return [...prev, { type: 'text', text }]
          })
          break
        }
        case 'tool_call': {
          const tc = data as ToolCallEvent
          if (tc.id) {
            turn.assistantToolCalls.push({
              id:        tc.id,
              name:      tc.tool,
              arguments: tc.input ?? {},
            })
          }
          setEntries(prev => [...prev, { type: 'tool_call', tool: tc.tool, ...(tc.input ? { input: tc.input } : {}) }])
          // Field-update animation hook (legacy update_field shape).
          if (tc.tool === 'update_field' && tc.input?.['field'] && tc.input['value'] != null) {
            onFieldUpdateRef.current?.(tc.input['field'] as string, tc.input['value'] as string)
          }
          break
        }
        case 'tool_result': {
          // Server-side tool result — append to the wire log so the next
          // continuation request mirrors the persisted shape. The `content`
          // string MUST match what the server's persistence layer would
          // write (string passthrough or JSON.stringify) — see the
          // mixed-tool-continuation invariant in agentStream/index.ts.
          const tr = data as ToolResultEvent
          turn.serverToolResults.push({
            role:       'tool',
            content:    tr.content,
            toolCallId: tr.toolCallId,
          })
          break
        }
        case 'run_started': {
          turn.runId = (data as RunStartedEvent).runId
          break
        }
        case 'pending_client_tools': {
          turn.pendingClientTools = (data as PendingClientToolsEvent).toolCalls
          break
        }
        case 'complete': {
          const c = data as CompleteEvent
          turn.finished = true
          turn.awaiting = c.awaiting
          // Only flip status to 'complete' once the loop is fully done — a
          // 'complete' event with `awaiting` set means the loop paused and
          // a continuation is about to start.
          if (!c.awaiting) {
            setEntries(prev => [...prev, { type: 'complete', data: c }])
            setStatus('complete')
          }
          break
        }
        case 'error': {
          turn.finished = true
          setEntries(prev => [...prev, { type: 'error', message: (data as ErrorEvent).message }])
          setStatus('error')
          break
        }
      }
    }
  }

  function reset() {
    abortRef.current?.abort()
    setEntries([])
    setStatus('idle')
  }

  useEffect(() => () => { abortRef.current?.abort() }, [])

  return { entries, status, run, reset }
}
