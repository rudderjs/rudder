// NativeDatabaseProvider conformance.
//
// Boots the provider against a `config('database')` fixture and asserts the
// config-gated activation: it wires a NativeAdapter ONLY when the default
// connection sets `engine: 'native'`, stays inert otherwise, and rejects a
// non-sqlite driver. The inert path is the collision guard that lets
// `@rudderjs/orm` (installed in every app) be auto-discovered without clobbering
// a prisma/drizzle adapter.

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { ConfigRepository, setConfigRepository } from '@rudderjs/core'
import type { Application } from '@rudderjs/core'
import { Model, ModelRegistry } from '../index.js'
import { NativeAdapter } from './adapter.js'
import { NativeDatabaseProvider, nativeDatabase } from './provider.js'

// A minimal Application stub — the provider only touches `app.instance(...)`.
function fakeApp(): { app: Application; bindings: Array<[string, unknown]> } {
  const bindings: Array<[string, unknown]> = []
  const app = { instance: (name: string, value: unknown) => { bindings.push([name, value]) } }
  return { app: app as unknown as Application, bindings }
}

function setDbConfig(database: unknown): void {
  setConfigRepository(new ConfigRepository({ database }))
}

/** The driver the provider opened (cached on globalThis by NativeAdapter.make). */
function bootedDriver(): { execute(sql: string, b: readonly unknown[]): Promise<unknown[]> } {
  const cached = (globalThis as Record<string, unknown>)['__rudderjs_native_client__'] as
    | { driver: { execute(sql: string, b: readonly unknown[]): Promise<unknown[]> } }
    | undefined
  assert.ok(cached?.driver, 'provider should have opened + cached a native driver')
  return cached.driver
}

class Widget extends Model {
  static override table = 'widgets'
  id!: number
  name!: string
}

beforeEach(() => {
  ModelRegistry.reset()
  // Fresh in-memory DB per test: drop the cached driver so make() reopens.
  delete (globalThis as Record<string, unknown>)['__rudderjs_native_client__']
})

afterEach(() => {
  delete (globalThis as Record<string, unknown>)['__rudderjs_native_client__']
})

describe('NativeDatabaseProvider — activation', () => {
  it('wires a NativeAdapter when the default connection opts into engine:native', async () => {
    setDbConfig({ default: 'main', connections: { main: { engine: 'native', url: ':memory:' } } })
    const { app, bindings } = fakeApp()

    await new NativeDatabaseProvider(app).boot()

    const adapter = ModelRegistry.get()
    assert.ok(adapter instanceof NativeAdapter, 'native adapter registered')
    assert.deepStrictEqual(bindings.map(([n]) => n), ['db'], 'bound `db` on the container')
    assert.strictEqual(bindings[0]![1], adapter, '`db` binding is the same adapter')
  })

  it('routes Model queries through the booted native adapter (round-trip)', async () => {
    setDbConfig({ default: 'main', connections: { main: { engine: 'native', url: ':memory:' } } })
    await new NativeDatabaseProvider(fakeApp().app).boot()

    await bootedDriver().execute(
      'CREATE TABLE widgets (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)', [])
    const w = await Widget.create({ name: 'gear' })
    assert.strictEqual(w.name, 'gear')
    assert.strictEqual(await Widget.count(), 1)
  })

  it('stays inert when no connection selects the native engine', async () => {
    setDbConfig({ default: 'main', connections: { main: { driver: 'sqlite', url: ':memory:' } } })
    const { app, bindings } = fakeApp()

    await new NativeDatabaseProvider(app).boot()

    assert.strictEqual(ModelRegistry.get(), null, 'adapter left unset — prisma/drizzle would win')
    assert.strictEqual(bindings.length, 0, 'no container binding')
  })

  it('stays inert when there is no database config at all', async () => {
    setConfigRepository(new ConfigRepository({}))
    await new NativeDatabaseProvider(fakeApp().app).boot()
    assert.strictEqual(ModelRegistry.get(), null)
  })

  it('rejects a non-sqlite driver under engine:native', async () => {
    setDbConfig({ default: 'main', connections: { main: { engine: 'native', driver: 'postgresql' } } })
    await assert.rejects(
      new NativeDatabaseProvider(fakeApp().app).boot(),
      /supports the `sqlite` driver only/,
    )
    assert.strictEqual(ModelRegistry.get(), null)
  })

  it('nativeDatabase() returns the provider class for explicit wiring', () => {
    assert.strictEqual(nativeDatabase(), NativeDatabaseProvider)
  })
})
