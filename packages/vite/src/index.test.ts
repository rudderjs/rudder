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

    // Check resolve alias
    assert.ok(config.resolve, 'should have resolve')
    const resolve = config.resolve as { alias: Record<string, string> }
    assert.ok(resolve.alias['@'], 'should have @ alias')
    assert.ok(resolve.alias['@'].endsWith('/src'), '@ alias should point to src/')

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
