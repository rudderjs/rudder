// ─── onQuery — query listening on the native engine ────────
//
// Unit half: a fake driver proves the instrumented executor reports every
// execute()/affectingExecute() with sql + bindings + duration, that a throwing
// listener never breaks the query, and that bindings are snapshotted.
// E2E half: a real better-sqlite3 `:memory:` connection proves Model reads/
// writes, `DB.*` raw calls, and transaction-scoped queries all reach a
// listener registered via `adapter.onQuery()`.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { QueryEvent } from '@rudderjs/contracts'
import { DB } from '@rudderjs/database'
import { Model, ModelRegistry } from '../index.js'
// Side effect: registers the DB facade's adapter resolver + transaction runner.
import '../db-bridge.js'
import { NativeAdapter } from './adapter.js'
import type { Driver, Row, Transaction } from '@rudderjs/database/native'
import type { AffectingResult } from '@rudderjs/database/native'

// ── Unit: fake driver ──────────────────────────────────────

/** A no-op in-memory Driver: records what it executes, returns no rows. */
function makeFakeDriver(): { driver: Driver; executed: string[] } {
  const executed: string[] = []
  const driver: Driver = {
    async execute(sql: string): Promise<Row[]> {
      executed.push(sql)
      return []
    },
    async transaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
      return fn(this)
    },
    async close(): Promise<void> {},
  }
  return { driver, executed }
}

test('onQuery reports sql, bindings, and a numeric duration per executed query', async () => {
  const { driver } = makeFakeDriver()
  const adapter = await NativeAdapter.make({ driverInstance: driver })
  const events: QueryEvent[] = []
  adapter.onQuery((e) => events.push(e))

  await adapter.selectRaw('select * from users where id = ?', [7])

  assert.equal(events.length, 1)
  assert.equal(events[0]?.sql, 'select * from users where id = ?')
  assert.deepEqual(events[0]?.bindings, [7])
  assert.equal(typeof events[0]?.duration, 'number')
  assert.ok((events[0]?.duration ?? -1) >= 0)
  // Caller-supplied driverInstance — no built-in driver name to report.
  assert.equal(events[0]?.connection, undefined)
})

test('a throwing listener never breaks the query, and later listeners still fire', async () => {
  const { driver, executed } = makeFakeDriver()
  const adapter = await NativeAdapter.make({ driverInstance: driver })
  const seen: string[] = []
  adapter.onQuery(() => { throw new Error('broken collector') })
  adapter.onQuery((e) => seen.push(e.sql))

  const rows = await adapter.selectRaw('select 1', [])

  assert.deepEqual(rows, [])
  assert.deepEqual(executed, ['select 1'])
  assert.deepEqual(seen, ['select 1'])
})

test('bindings on the event are a snapshot — later mutation does not leak in', async () => {
  const { driver } = makeFakeDriver()
  const adapter = await NativeAdapter.make({ driverInstance: driver })
  const events: QueryEvent[] = []
  adapter.onQuery((e) => events.push(e))

  const bindings: unknown[] = ['a']
  await adapter.selectRaw('select ?', bindings)
  bindings[0] = 'mutated'

  assert.deepEqual(events[0]?.bindings, ['a'])
})

test('no listeners registered — queries run untouched (no emit overhead path)', async () => {
  const { driver, executed } = makeFakeDriver()
  const adapter = await NativeAdapter.make({ driverInstance: driver })

  await adapter.selectRaw('select 1', [])

  assert.deepEqual(executed, ['select 1'])
})

test('affectingExecute (no-RETURNING drivers) is instrumented and capability-preserved', async () => {
  const executed: string[] = []
  const driver: Driver & { affectingExecute(sql: string, bindings: readonly unknown[]): Promise<AffectingResult> } = {
    async execute(): Promise<Row[]> {
      throw new Error('should route through affectingExecute')
    },
    async affectingExecute(sql: string): Promise<AffectingResult> {
      executed.push(sql)
      return { insertId: null, affectedRows: 3 }
    },
    async transaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
      return fn(this)
    },
    async close(): Promise<void> {},
  }
  const adapter = await NativeAdapter.make({ driverInstance: driver })
  const events: QueryEvent[] = []
  adapter.onQuery((e) => events.push(e))

  // affectingStatement prefers the driver's affectingExecute when present —
  // the instrumented executor must preserve that capability AND report it.
  const affected = await adapter.affectingStatement('update t set a = ?', [1])

  assert.equal(affected, 3)
  assert.deepEqual(executed, ['update t set a = ?'])
  assert.equal(events.length, 1)
  assert.equal(events[0]?.sql, 'update t set a = ?')
})

// ── E2E: sqlite :memory: ───────────────────────────────────

class Gadget extends Model {
  static override table = 'gadgets'
  id!: number
  name!: string
}

test('sqlite E2E: Model reads/writes, DB.* raw calls, and transactions all report', async () => {
  const adapter = await NativeAdapter.make({ driver: 'sqlite', url: ':memory:' })
  ModelRegistry.set(adapter)
  try {
    await DB.statement('create table gadgets (id integer primary key autoincrement, name text)', [])

    const events: QueryEvent[] = []
    adapter.onQuery((e) => events.push(e))

    // Model write + read route through the instrumented executor.
    await Gadget.create({ name: 'sprocket' })
    const found = await Gadget.where('name', 'sprocket').first()
    assert.equal(found?.name, 'sprocket')

    // DB.* raw call reports too.
    await DB.select('select count(*) as c from gadgets', [])

    // Transaction-scoped queries share the top-level listener list.
    await DB.transaction(async () => {
      await Gadget.create({ name: 'in-tx' })
    })

    assert.ok(events.length >= 4, `expected >= 4 events, got ${events.length}`)
    const inserts = events.filter((e) => /^insert/i.test(e.sql))
    assert.equal(inserts.length, 2)
    assert.ok(inserts.every((e) => e.bindings.includes('sprocket') || e.bindings.includes('in-tx')))
    assert.ok(events.every((e) => e.connection === 'sqlite'))
    assert.ok(events.every((e) => typeof e.duration === 'number' && e.duration >= 0))
    // BEGIN/COMMIT run inside the driver — never reported.
    assert.ok(events.every((e) => !/^(begin|commit|rollback|savepoint|release)/i.test(e.sql)))
  } finally {
    await adapter.disconnect()
  }
})

test('sqlite E2E: DB.listen registers through the facade onto the active adapter', async () => {
  const adapter = await NativeAdapter.make({ driver: 'sqlite', url: ':memory:' })
  ModelRegistry.set(adapter)
  try {
    const seen: string[] = []
    DB.listen((e) => seen.push(e.sql))

    await DB.select('select 1 as one', [])

    assert.deepEqual(seen, ['select 1 as one'])
  } finally {
    await adapter.disconnect()
  }
})
