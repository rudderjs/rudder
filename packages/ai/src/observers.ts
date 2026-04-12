/**
 * AI agent event observers — process-wide pub/sub for agent executions
 * made through `@rudderjs/ai`. Any package can subscribe to be notified
 * about completed or failed agent runs.
 *
 * Used today by `@rudderjs/telescope`'s AiCollector to record agent
 * executions into the dashboard. The registry is defined here (inside
 * `@rudderjs/ai`) so the observer contract lives with the package that
 * owns the AI abstraction.
 */

// ─── Event Types ──────────────────────────────────────────

export interface AiObserverToolCall {
  id:            string
  name:          string
  args:          unknown
  result:        unknown
  duration:      number
  needsApproval: boolean
}

export interface AiObserverStep {
  iteration:    number
  model:        string
  tokens:       { prompt: number; completion: number; total: number }
  finishReason: string
  toolCalls:    AiObserverToolCall[]
}

/** Discriminated union of every event the AI agent loop can emit. */
export type AiEvent =
  | {
      kind:             'agent.completed'
      agentName:        string
      model:            string
      provider:         string
      input:            string
      output:           string
      steps:            AiObserverStep[]
      tokens:           { prompt: number; completion: number; total: number }
      duration:         number
      finishReason:     string
      streaming:        boolean
      conversationId:   string | null
      failoverAttempts: number
    }
  | {
      kind:             'agent.failed'
      agentName:        string
      model:            string
      provider:         string
      input:            string
      output:           string
      steps:            AiObserverStep[]
      tokens:           { prompt: number; completion: number; total: number }
      duration:         number
      finishReason:     string
      streaming:        boolean
      conversationId:   string | null
      failoverAttempts: number
      error:            string
    }

export type AiObserver = (event: AiEvent) => void

export class AiObserverRegistry {
  private observers: AiObserver[] = []

  /** Subscribe; returns an unsubscribe function. */
  subscribe(fn: AiObserver): () => void {
    this.observers.push(fn)
    return () => { this.observers = this.observers.filter(o => o !== fn) }
  }

  /**
   * Called by `runAgentLoop()` / `runAgentLoopStreaming()` after each
   * agent execution. Errors thrown by observers are swallowed —
   * observability must never break agent runs.
   */
  emit(event: AiEvent): void {
    for (const o of this.observers) {
      try { o(event) } catch { /* observer errors must not break agents */ }
    }
  }

  /** @internal — used in tests */
  reset(): void { this.observers = [] }
}

// Process-wide singleton, like `httpObservers` in `@rudderjs/http`.
const _g = globalThis as Record<string, unknown>
if (!_g['__rudderjs_ai_observers__']) {
  _g['__rudderjs_ai_observers__'] = new AiObserverRegistry()
}

export const aiObservers = _g['__rudderjs_ai_observers__'] as AiObserverRegistry
