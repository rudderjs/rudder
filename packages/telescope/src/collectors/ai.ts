import type { Collector, TelescopeStorage, TelescopeConfig } from '../types.js'
import { createEntry } from '../storage.js'
import { batchOpts } from '../batch-context.js'

/**
 * Records AI agent executions by hooking into @rudderjs/ai's observer registry.
 */
export class AiCollector implements Collector {
  readonly name = 'AI Collector'
  readonly type = 'ai' as const

  constructor(
    private readonly storage: TelescopeStorage,
    private readonly config:  TelescopeConfig,
  ) {}

  async register(): Promise<void> {
    try {
      const mod = await import('@rudderjs/ai/observers') as unknown as {
        aiObservers: { subscribe(fn: (event: AiEvent) => void): () => void }
      }
      const { aiObservers } = mod

      const storage   = this.storage
      const threshold = this.config.slowAiThreshold ?? 5000

      aiObservers.subscribe((event: AiEvent) => {
        // Telescope records one entry per agent run; per-step progress
        // events flow through the registry for live UIs / pulse but
        // shouldn't create a separate watcher entry.
        if (event.kind === 'agent.step.completed') return

        const tags: string[] = [
          `model:${event.model}`,
          `provider:${event.provider}`,
          `agent:${event.agentName}`,
        ]

        if (event.kind === 'agent.failed') tags.push('error')
        if (event.duration > threshold)    tags.push('slow')
        if (event.streaming)               tags.push('streaming')

        const toolCalls = event.steps.flatMap(s => s.toolCalls)
        if (toolCalls.length > 0) tags.push('has_tools')

        storage.store(createEntry('ai', {
          kind:             event.kind,
          agentName:        event.agentName,
          model:            event.model,
          provider:         event.provider,
          input:            event.input,
          output:           event.output,
          steps:            event.steps,
          tokens:           event.tokens,
          duration:         event.duration,
          finishReason:     event.finishReason,
          streaming:        event.streaming,
          conversationId:   event.conversationId,
          failoverAttempts: event.failoverAttempts,
          toolCallCount:    toolCalls.length,
          toolCalls,
          error:            event.kind === 'agent.failed' ? event.error : undefined,
        }, { tags, ...batchOpts() }))
      })
    } catch {
      // @rudderjs/ai not installed — skip
    }
  }
}

// ─── Local event shape (mirrors @rudderjs/ai observers — no runtime import) ──

interface AiToolCall {
  id:            string
  name:          string
  args:          unknown
  result:        unknown
  duration:      number
  needsApproval: boolean
}

interface AiStep {
  iteration:    number
  model:        string
  tokens:       { prompt: number; completion: number; total: number }
  finishReason: string
  toolCalls:    AiToolCall[]
}

type AiEvent =
  | {
      kind:             'agent.completed'
      agentName:        string
      model:            string
      provider:         string
      input:            string
      output:           string
      steps:            AiStep[]
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
      steps:            AiStep[]
      tokens:           { prompt: number; completion: number; total: number }
      duration:         number
      finishReason:     string
      streaming:        boolean
      conversationId:   string | null
      failoverAttempts: number
      error:            string
    }
  | {
      kind:           'agent.step.completed'
      agentName:      string
      model:          string
      provider:       string
      iteration:      number
      step:           AiStep
      tokens:         { prompt: number; completion: number; total: number }
      duration:       number
      streaming:      boolean
      conversationId: string | null
    }
