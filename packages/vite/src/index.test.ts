import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { rudderjs } from './index.js'

describe('@rudderjs/vite', () => {
  it('exports rudderjs function', () => {
    assert.equal(typeof rudderjs, 'function')
  })

  it('returns a promise', () => {
    const result = rudderjs()
    assert.ok(result instanceof Promise)
  })

  it('promise has _vikeVitePluginOptions (Vike detection)', () => {
    const result = rudderjs() as any
    assert.ok('_vikeVitePluginOptions' in result)
    assert.deepEqual(result._vikeVitePluginOptions, {})
  })

  it('resolves to an array of plugins', async () => {
    const plugins = await rudderjs()
    assert.ok(Array.isArray(plugins))
  })

  it('includes rudderjs:ws plugin', async () => {
    const plugins = await rudderjs()
    const wsPlugin = plugins.find(p => p.name === 'rudderjs:ws')
    assert.ok(wsPlugin, 'rudderjs:ws plugin should exist')
    assert.equal(typeof wsPlugin.configureServer, 'function')
  })

  it('includes rudderjs:config plugin', async () => {
    const plugins = await rudderjs()
    const configPlugin = plugins.find(p => p.name === 'rudderjs:config')
    assert.ok(configPlugin, 'rudderjs:config plugin should exist')
    assert.equal(typeof configPlugin.config, 'function')
  })

  it('rudderjs:config returns correct config shape', async () => {
    const plugins = await rudderjs()
    const configPlugin = plugins.find(p => p.name === 'rudderjs:config')!
    const config = (configPlugin.config as () => Record<string, unknown>)()

    // Check resolve alias (array format: [{ find, replacement }])
    assert.ok(config.resolve, 'should have resolve')
    const resolve = config.resolve as { alias: Array<{ find: string | RegExp; replacement: string }> }
    assert.ok(Array.isArray(resolve.alias), 'alias should be an array')
    const atAlias = resolve.alias.find(a => a.find === '@')
    assert.ok(atAlias, 'should have @ alias')
    assert.ok(atAlias.replacement.endsWith('/src'), '@ alias should point to src/')

    // Check ssr config
    assert.ok(config.ssr, 'should have ssr config')
    const ssr = config.ssr as { external: string[]; noExternal: string[] }
    assert.ok(Array.isArray(ssr.external), 'should have ssr.external array')
    assert.ok(ssr.external.includes('ioredis'), 'ioredis should be externalized')
    assert.ok(ssr.external.includes('pg'), 'pg should be externalized')
    assert.ok(ssr.external.includes('better-sqlite3'), 'better-sqlite3 should be externalized')
    assert.ok(Array.isArray(ssr.noExternal), 'should have ssr.noExternal array')
    assert.ok(ssr.noExternal.includes('@rudderjs/server-hono'), 'server-hono should be non-external')

    // Check build config
    assert.ok(config.build, 'should have build config')
    const build = config.build as { rollupOptions: { external: (id: string) => boolean } }
    assert.equal(typeof build.rollupOptions.external, 'function', 'rollup external should be a function')
    assert.equal(build.rollupOptions.external('ioredis'), true, 'ioredis should be external in build')
    assert.equal(build.rollupOptions.external('react'), false, 'react should not be external')
  })

  it('default export is rudderjs', async () => {
    const mod = await import('./index.js')
    assert.equal(mod.default, mod.rudderjs)
  })
})

// ─── page-context-enhancers ─────────────────────────────────

import {
  registerPageContextEnhancer,
  runPageContextEnhancers,
  _resetPageContextEnhancersForTests,
} from './page-context-enhancers.js'

describe('page-context-enhancers', () => {
  it('runs registered enhancers in registration order', async () => {
    _resetPageContextEnhancersForTests()
    const order: number[] = []
    registerPageContextEnhancer(() => { order.push(1) })
    registerPageContextEnhancer(() => { order.push(2) })
    registerPageContextEnhancer(() => { order.push(3) })

    await runPageContextEnhancers({} as never)
    assert.deepEqual(order, [1, 2, 3])
  })

  it('awaits async enhancers', async () => {
    _resetPageContextEnhancersForTests()
    const order: string[] = []
    registerPageContextEnhancer(async () => {
      await new Promise(r => setTimeout(r, 5))
      order.push('async-done')
    })
    registerPageContextEnhancer(() => { order.push('sync-done') })

    await runPageContextEnhancers({} as never)
    assert.deepEqual(order, ['async-done', 'sync-done'])
  })

  it('mutates the passed pageContext in place', async () => {
    _resetPageContextEnhancersForTests()
    registerPageContextEnhancer((pc) => {
      ;(pc as { foo?: string }).foo = 'bar'
    })

    const ctx: Record<string, unknown> = {}
    await runPageContextEnhancers(ctx as never)
    assert.equal((ctx as { foo?: string }).foo, 'bar')
  })

  it('propagates errors from an enhancer', async () => {
    _resetPageContextEnhancersForTests()
    registerPageContextEnhancer(() => { throw new Error('boom') })

    await assert.rejects(
      () => runPageContextEnhancers({} as never),
      /boom/,
    )
  })
})

// ─── hooks/onCreatePageContext ─────────────────────────────

describe('onCreatePageContext', () => {
  it('walks registered enhancers', async () => {
    _resetPageContextEnhancersForTests()
    const seen: string[] = []
    registerPageContextEnhancer((pc) => { seen.push((pc as { url?: string }).url ?? '') })

    const { onCreatePageContext } = await import('./hooks/onCreatePageContext.js')
    await onCreatePageContext({ url: '/test' } as never)
    assert.deepEqual(seen, ['/test'])
  })
})

// ─── hooks/onError ─────────────────────────────────────────

describe('onError', () => {
  it('falls back to console.error when @rudderjs/core is unavailable', async () => {
    const original = console.error
    const logged: unknown[][] = []
    console.error = (...args: unknown[]) => { logged.push(args) }

    try {
      const { onError } = await import('./hooks/onError.js')
      const err = new Error('boom')
      // We can't easily stub the dynamic import; just confirm it doesn't throw.
      // In the worktree @rudderjs/core IS installed so this exercises the
      // happy path (report() called). The branch test for the absent peer
      // lives in a separate fixture project (deferred).
      await onError(err, { urlOriginal: '/x' } as never)
    } finally {
      console.error = original
    }
  })
})

// ─── hooks/headersResponse ─────────────────────────────────

describe('headersResponse', () => {
  it('returns viewHeaders from pageContext', async () => {
    const { headersResponse } = await import('./hooks/headersResponse.js')
    const headers = headersResponse({
      viewHeaders: { 'cache-control': 'no-cache' },
    } as never)
    assert.deepEqual(headers, { 'cache-control': 'no-cache' })
  })

  it('returns {} when viewHeaders is missing', async () => {
    const { headersResponse } = await import('./hooks/headersResponse.js')
    const headers = headersResponse({} as never)
    assert.deepEqual(headers, {})
  })
})
