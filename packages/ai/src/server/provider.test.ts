import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { ConfigRepository, setConfigRepository } from '@rudderjs/core'
import { AiRegistry } from '@gemstack/ai-sdk'
import { AiProvider } from './provider.js'

/**
 * Minimal `Application` stand-in. `boot()` only touches
 * `container.has('cache')`, `make()`, and `instance()`.
 */
function fakeApp(opts: { hasCache?: boolean } = {}) {
  const instances: Record<string, unknown> = {}
  return {
    container: { has: (key: string) => key === 'cache' && !!opts.hasCache },
    make:      () => { throw new Error('make() should not be called without a bound cache') },
    instance:  (key: string, value: unknown) => { instances[key] = value },
    _instances: instances,
  }
}

describe('@rudderjs/ai AiProvider', () => {
  beforeEach(() => { AiRegistry.reset() })

  it('extends the Rudder ServiceProvider lifecycle', () => {
    const app = fakeApp()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const provider = new AiProvider(app as any)
    assert.equal(typeof provider.register, 'function')
    assert.equal(typeof provider.boot, 'function')
  })

  it('boot() registers keyless drivers, skips key-requiring ones, and sets the default', async () => {
    setConfigRepository(new ConfigRepository({
      ai: {
        default: 'ollama/llama3',
        providers: {
          ollama: { driver: 'ollama' },          // no key needed → registered
          openai: { driver: 'openai' },           // missing apiKey → skipped
        },
        models: [],
      },
    }))

    const app = fakeApp()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await new AiProvider(app as any).boot()

    assert.equal(AiRegistry.getDefault(), 'ollama/llama3')
    assert.ok(AiRegistry.getFactory('ollama'), 'ollama should be registered')
    assert.throws(() => AiRegistry.getFactory('openai'), /not registered|openai/i)
    assert.equal(app._instances['ai.registry'], AiRegistry)
  })

  it('boot() plumbs the container cache into the Google cache registry when bound', async () => {
    setConfigRepository(new ConfigRepository({
      ai: { default: 'ollama/llama3', providers: { ollama: { driver: 'ollama' } }, models: [] },
    }))

    // hasCache=true makes buildGoogleCacheRegistry() call make('cache'); supply one.
    const app = fakeApp({ hasCache: true })
    app.make = () => ({ get: async () => null, set: async () => {}, forget: async () => {} }) as never

    // Should not throw — the registry accepts the bound CacheAdapter.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await new AiProvider(app as any).boot()
    assert.equal(AiRegistry.getDefault(), 'ollama/llama3')
  })
})
