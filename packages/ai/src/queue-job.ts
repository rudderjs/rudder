import type { AgentPromptOptions, AgentResponse } from './types.js'

/**
 * Queued AI prompt builder.
 * Created via `agent.queue('prompt')`.
 *
 * @example
 * await agent.queue('Analyze this report')
 *   .onQueue('ai')
 *   .then(response => console.log(response.text))
 *   .catch(err => console.error(err))
 *   .send()
 */
export class QueuedPromptBuilder {
  private _queue = 'default'
  private _delay = 0
  private _thenFn: ((response: AgentResponse) => void | Promise<void>) | undefined
  private _catchFn: ((error: unknown) => void | Promise<void>) | undefined

  constructor(
    private readonly agentRef: { prompt(input: string, options?: AgentPromptOptions): Promise<AgentResponse> },
    private readonly input: string,
    private readonly options?: AgentPromptOptions,
  ) {}

  /** Set the queue name */
  onQueue(name: string): this {
    this._queue = name
    return this
  }

  /** Set a delay before the job runs */
  delay(ms: number): this {
    this._delay = ms
    return this
  }

  /** Callback when the prompt succeeds */
  then(fn: (response: AgentResponse) => void | Promise<void>): this {
    this._thenFn = fn
    return this
  }

  /** Callback when the prompt fails */
  catch(fn: (error: unknown) => void | Promise<void>): this {
    this._catchFn = fn
    return this
  }

  /** Dispatch the job to the queue */
  async send(): Promise<void> {
    // Lazy import @rudderjs/queue — uses dispatch(fn) for queued closures
    let dispatchFn: (fn: () => void | Promise<void>, options?: { queue?: string; delay?: number }) => Promise<void>
    try {
      const specifier = '@rudderjs/queue'
      const mod: Record<string, unknown> = await import(/* @vite-ignore */ specifier)
      dispatchFn = mod['dispatch'] as typeof dispatchFn
    } catch {
      throw new Error(
        '[RudderJS AI] @rudderjs/queue is required for agent.queue(). Install it: pnpm add @rudderjs/queue',
      )
    }

    const agentRef = this.agentRef
    const input = this.input
    const promptOptions = this.options
    const thenFn = this._thenFn
    const catchFn = this._catchFn

    await dispatchFn(async () => {
      try {
        const response = await agentRef.prompt(input, promptOptions)
        if (thenFn) await thenFn(response)
      } catch (error) {
        if (catchFn) {
          await catchFn(error)
        } else {
          throw error
        }
      }
    }, {
      queue: this._queue,
      delay: this._delay,
    })
  }
}
