// NativeDatabaseProvider conformance.
//
// Boots the provider against a `config('database')` fixture and asserts the
// config-gated activation: it wires a NativeAdapter ONLY when the default
// connection sets `engine: 'native'`, stays inert otherwise, accepts the three
// native drivers (sqlite/pg/mysql), and rejects an unknown driver. The inert
// path is the collision guard that lets
// `@rudderjs/orm` (installed in every app) be auto-discovered without clobbering
// a prisma/drizzle adapter.

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { ConfigRepository, setConfigRepository } from '@rudderjs/core'
import type { Application } from '@rudderjs/core'
import { Model, ModelRegistry, ConnectionManager } from '../index.js'
import { NativeAdapter } from '@rudderjs/database/native'
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

/** The driver the provider opened (cached on globalThis by NativeAdapter.make —
 *  a per-connection Map since multi-connection support; the provider boots the
 *  default connection, so the first entry is its driver). */
function bootedDriver(): { execute(sql: string, b: readonly unknown[]): Promise<unknown[]> } {
  const cache = (globalThis as Record<string, unknown>)['__rudderjs_native_client__'] as
    | Map<string, { driver: { execute(sql: string, b: readonly unknown[]): Promise<unknown[]> } }>
    | undefined
  const entry = cache && [...cache.values()][0]
  assert.ok(entry?.driver, 'provider should have opened + cached a native driver')
  return entry.driver
}

class Widget extends Model {
  static override table = 'widgets'
  id!: number
  name!: string
}

beforeEach(() => {
  ModelRegistry.reset()
  ConnectionManager.__reset()
  // Fresh in-memory DB per test: drop the cached driver so make() reopens.
  delete (globalThis as Record<string, unknown>)['__rudderjs_native_client__']
})

afterEach(() => {
  ConnectionManager.__reset()
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

  it('rejects an unknown driver under engine:native', async () => {
    setDbConfig({ default: 'main', connections: { main: { engine: 'native', driver: 'oracle' } } })
    await assert.rejects(
      new NativeDatabaseProvider(fakeApp().app).boot(),
      /Unknown native driver `oracle`/,
    )
    assert.strictEqual(ModelRegistry.get(), null)
  })

  it('accepts pg/mysql under engine:native (gate passes; fails later at connect)', async () => {
    // The gate no longer blocks pg/mysql — validation passes, so the error comes
    // from NativeAdapter.make trying to load the optional peer / connect, NOT
    // from the provider's driver allow-list. (`postgresql` is the prisma/drizzle
    // spelling — native uses `pg` — so it would still be rejected as unknown.)
    for (const driver of ['pg', 'mysql']) {
      const url = `${driver === 'pg' ? 'postgres' : 'mysql'}://localhost:1/none`
      setDbConfig({ default: 'main', connections: { main: { engine: 'native', driver, url } } })
      await assert.rejects(
        new NativeDatabaseProvider(fakeApp().app).boot(),
        (e: unknown) => e instanceof Error && !/Unknown native driver/.test(e.message),
        `${driver} should pass the gate and fail downstream, not at the allow-list`,
      )
      assert.strictEqual(ModelRegistry.get(), null)
    }
  })

  it('registers lazy factories for NAMED engine:native connections (no eager open)', async () => {
    setDbConfig({
      default: 'main',
      connections: {
        main:      { engine: 'native', url: ':memory:' },
        reporting: { engine: 'native', url: ':memory:' },
        // Menu entry owned by another adapter — must NOT be claimed here.
        postgresql: { driver: 'postgresql', url: 'postgres://nope' },
      },
    })
    await new NativeDatabaseProvider(fakeApp().app).boot()

    assert.strictEqual(ConnectionManager.defaultName(), 'main')
    assert.deepStrictEqual(ConnectionManager.names().sort(), ['main', 'reporting'])
    // Default opened eagerly — and it IS the registry adapter (one connection).
    assert.strictEqual(ConnectionManager.peek('main'), ModelRegistry.get())
    // Named connection stays closed until first use (menu semantics).
    assert.strictEqual(ConnectionManager.peek('reporting'), null)

    const reporting = await ConnectionManager.ensure('reporting')
    assert.ok(reporting instanceof NativeAdapter)
    assert.notStrictEqual(reporting, ModelRegistry.get(), 'distinct adapter per connection')
    await reporting.disconnect()
  })

  it('registers named engine:native connections even when the DEFAULT is another engine', async () => {
    setDbConfig({
      default: 'main',
      connections: {
        main:      { driver: 'sqlite', url: ':memory:' },        // prisma/drizzle-shaped
        reporting: { engine: 'native', url: ':memory:' },
      },
    })
    await new NativeDatabaseProvider(fakeApp().app).boot()

    // Inert for the default (collision guard intact)…
    assert.strictEqual(ModelRegistry.get(), null)
    // …but the named native connection is reachable, lazily.
    assert.deepStrictEqual(ConnectionManager.names(), ['reporting'])
    assert.strictEqual(ConnectionManager.peek('reporting'), null)
  })

  it('a typo in a NAMED connection driver surfaces at first use, not at boot', async () => {
    setDbConfig({
      default: 'main',
      connections: {
        main:      { engine: 'native', url: ':memory:' },
        reporting: { engine: 'native', driver: 'oracle' },
      },
    })
    // Boot succeeds — the bad named connection is lazy.
    await new NativeDatabaseProvider(fakeApp().app).boot()

    await assert.rejects(
      ConnectionManager.ensure('reporting'),
      /Unknown native driver `oracle` \(connection 'reporting'\)/,
    )
  })

  it('maps read/write/sticky config onto the adapter (replica serves the reads)', async () => {
    const { mkdtempSync, rmSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const dir = mkdtempSync(join(tmpdir(), 'rudder-provider-rw-'))
    try {
      // Seed distinguishable writer/replica files BEFORE the provider opens them.
      const seed = async (file: string, marker: string): Promise<string> => {
        const a = await NativeAdapter.make({ driver: 'sqlite', url: file })
        await a.affectingStatement('create table notes (id integer primary key autoincrement, src text)', [])
        await a.affectingStatement('insert into notes (src) values (?)', [marker])
        await a.disconnect()
        return file
      }
      const writeFile = await seed(join(dir, 'w.db'), 'writer')
      const readFile  = await seed(join(dir, 'r.db'), 'replica')

      setDbConfig({
        default: 'main',
        connections: {
          main: {
            engine: 'native',
            url:    writeFile,
            read:   { url: readFile },
            sticky: true,
          },
        },
      })
      await new NativeDatabaseProvider(fakeApp().app).boot()

      // Un-locked read → replica; write lands on the writer.
      const reads = await ModelRegistry.getAdapter().query<{ src: string }>('notes').get()
      assert.deepEqual(reads.map((r) => r.src), ['replica'])
      await ModelRegistry.getAdapter().query('notes').create({ src: 'fresh' })
      const writer = await NativeAdapter.make({ driver: 'sqlite', url: writeFile })
      const onWriter = await writer.selectRaw('select src from notes order by id', [])
      assert.deepEqual(onWriter.map((r) => r.src), ['writer', 'fresh'])
      await writer.disconnect()

      await (ModelRegistry.get() as NativeAdapter).disconnect()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('nativeDatabase() returns the provider class for explicit wiring', () => {
    assert.strictEqual(nativeDatabase(), NativeDatabaseProvider)
  })
})
