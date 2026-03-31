import { AiRegistry } from './registry.js'
import type {
  ProviderFactory,
  ProviderAdapter,
  ProviderRequestOptions,
  ProviderResponse,
  StreamChunk,
} from './types.js'

/**
 * Testing fake for @boostkit/ai.
 *
 * @example
 * const fake = AiFake.fake()
 * fake.respondWith('Mocked response')
 *
 * const response = await AI.prompt('Hello')
 * assert.strictEqual(response.text, 'Mocked response')
 *
 * fake.assertPrompted(input => input.includes('Hello'))
 * fake.restore()
 */
export class AiFake {
  private readonly calls: ProviderRequestOptions[] = []
  private _response = 'fake response'

  /** Set the text response the fake will return */
  respondWith(text: string): void {
    this._response = text
  }

  /** Install the fake — replaces all registered providers with a mock */
  static fake(): AiFake {
    const fake = new AiFake()

    const adapter: ProviderAdapter = {
      async generate(opts: ProviderRequestOptions): Promise<ProviderResponse> {
        fake.calls.push(opts)
        return {
          message: { role: 'assistant', content: fake._response },
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          finishReason: 'stop',
        }
      },
      async *stream(opts: ProviderRequestOptions): AsyncIterable<StreamChunk> {
        fake.calls.push(opts)
        yield { type: 'text-delta', text: fake._response }
        yield { type: 'finish', finishReason: 'stop', usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } }
      },
    }

    const factory: ProviderFactory = {
      name: '__fake__',
      create: () => adapter,
    }

    AiRegistry.reset()
    AiRegistry.register(factory)
    AiRegistry.setDefault('__fake__/default')
    return fake
  }

  /** Assert at least one prompt was sent, optionally matching a predicate */
  assertPrompted(predicate?: (input: string) => boolean): void {
    if (this.calls.length === 0) throw new Error('[BoostKit AI] Expected at least one prompt, but none were sent.')
    if (predicate) {
      const match = this.calls.some(c => {
        const userMsg = c.messages.find(m => m.role === 'user')
        return userMsg ? predicate(userMsg.content) : false
      })
      if (!match) throw new Error('[BoostKit AI] No prompt matched the predicate.')
    }
  }

  /** Assert no prompts were sent */
  assertNothingPrompted(): void {
    if (this.calls.length > 0) {
      throw new Error(`[BoostKit AI] Expected no prompts, but ${this.calls.length} were sent.`)
    }
  }

  /** Get all recorded provider calls */
  getCalls(): ProviderRequestOptions[] {
    return [...this.calls]
  }

  /** Restore — clears the fake (user must re-register real providers) */
  restore(): void {
    AiRegistry.reset()
  }
}
