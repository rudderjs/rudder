import assert from 'node:assert/strict'
import { test, beforeEach } from 'node:test'
import { DB } from '@rudderjs/database'
import { Model, ModelRegistry, ConnectionManager, transaction } from '../index.js'
// Side effect: registers the DB facade's resolvers (default adapter, named
// connections, default + named transaction runners).
import '../db-bridge.js'
import { NativeAdapter } from './adapter.js'

// Two in-memory sqlite databases standing in for two named connections —
// `:memory:` adapters are fully isolated, so cross-connection leakage shows up
// as data divergence with no server needed.
function registerNamed(name: string): void {
  ConnectionManager.register(name, () =>
    NativeAdapter.make({ driver: 'sqlite', url: ':memory:', connectionName: name }),
  )
}

async function disconnectAll(): Promise<void> {
  for (const name of ConnectionManager.names()) {
    const adapter = ConnectionManager.peek(name) as NativeAdapter | null
    if (adapter) await adapter.disconnect()
  }
}

beforeEach(() => {
  ConnectionManager.__reset()
})

test('DB.connection() opens lazily on first call and routes to that connection', async () => {
  registerNamed('main')
  registerNamed('reporting')
  ConnectionManager.setDefaultName('main')
  ModelRegistry.set(await ConnectionManager.ensure('main'))
  try {
    // Registered but untouched — still closed.
    assert.equal(ConnectionManager.peek('reporting'), null)

    await DB.connection('reporting').statement('create table stats (n integer)', [])
    await DB.connection('reporting').insert('insert into stats (n) values (?)', [7])

    // Opened now, and the data landed on the NAMED database — not the default.
    assert.ok(ConnectionManager.peek('reporting'))
    const rows = await DB.connection('reporting').select('select n from stats', [])
    assert.deepEqual(rows.map((r) => r.n), [7])
    const defaultTables = await DB.select(
      "select name from sqlite_master where type = 'table' and name = 'stats'", [])
    assert.equal(defaultTables.length, 0)
  } finally {
    await disconnectAll()
  }
})

test('DB.connection(default) resolves the SAME adapter instance the Models use', async () => {
  registerNamed('main')
  ConnectionManager.setDefaultName('main')
  const adapter = await ConnectionManager.ensure('main')
  ModelRegistry.set(adapter)
  try {
    class Widget extends Model {
      static override table = 'widgets'
      id!: number
      name!: string
    }
    await DB.statement('create table widgets (id integer primary key autoincrement, name text)', [])
    await Widget.create({ name: 'shared' })

    // Same in-memory database ⇒ same driver ⇒ one connection, not two.
    const rows = await DB.connection('main').select('select name from widgets', [])
    assert.deepEqual(rows.map((r) => r.name), ['shared'])
    assert.equal(ConnectionManager.peek('main'), adapter)
  } finally {
    await disconnectAll()
  }
})

test('a named-connection transaction scopes ONLY that connection', async () => {
  registerNamed('main')
  registerNamed('reporting')
  ConnectionManager.setDefaultName('main')
  ModelRegistry.set(await ConnectionManager.ensure('main'))
  try {
    await DB.statement('create table logs (msg text)', [])
    await DB.connection('reporting').statement('create table logs (msg text)', [])

    await assert.rejects(
      transaction(async () => {
        // Inside the 'reporting' transaction…
        await DB.connection('reporting').insert("insert into logs (msg) values ('doomed')", [])
        // …a DEFAULT-connection write must NOT be captured by it.
        await DB.insert("insert into logs (msg) values ('survives')", [])
        throw new Error('rollback reporting')
      }, { connection: 'reporting' }),
      /rollback reporting/,
    )

    const reporting = await DB.connection('reporting').select('select msg from logs', [])
    assert.equal(reporting.length, 0, 'reporting write must roll back')
    const main = await DB.select('select msg from logs', [])
    assert.deepEqual(main.map((r) => r.msg), ['survives'], 'default write must persist')
  } finally {
    await disconnectAll()
  }
})

test('a default-connection transaction does not capture named-connection writes', async () => {
  registerNamed('main')
  registerNamed('reporting')
  ConnectionManager.setDefaultName('main')
  ModelRegistry.set(await ConnectionManager.ensure('main'))
  try {
    await DB.statement('create table logs (msg text)', [])
    await DB.connection('reporting').statement('create table logs (msg text)', [])

    await assert.rejects(
      DB.transaction(async () => {
        await DB.insert("insert into logs (msg) values ('doomed')", [])
        await DB.connection('reporting').insert("insert into logs (msg) values ('survives')", [])
        throw new Error('rollback default')
      }),
      /rollback default/,
    )

    const main = await DB.select('select msg from logs', [])
    assert.equal(main.length, 0, 'default write must roll back')
    const reporting = await DB.connection('reporting').select('select msg from logs', [])
    assert.deepEqual(reporting.map((r) => r.msg), ['survives'], 'reporting write must persist')
  } finally {
    await disconnectAll()
  }
})

test('DB.connection(name).transaction commits and nests via SAVEPOINT', async () => {
  registerNamed('main')
  registerNamed('reporting')
  ConnectionManager.setDefaultName('main')
  ModelRegistry.set(await ConnectionManager.ensure('main'))
  try {
    const reporting = DB.connection('reporting')
    await reporting.statement('create table logs (msg text)', [])

    await reporting.transaction(async () => {
      await reporting.insert("insert into logs (msg) values ('outer')", [])
      // Nested named transaction → SAVEPOINT: the inner rollback must leave
      // the outer transaction (and its write) intact.
      await assert.rejects(
        DB.connection('reporting').transaction(async () => {
          await DB.connection('reporting').insert("insert into logs (msg) values ('inner')", [])
          throw new Error('inner rollback')
        }),
        /inner rollback/,
      )
    })

    const rows = await reporting.select('select msg from logs', [])
    assert.deepEqual(rows.map((r) => r.msg), ['outer'])
  } finally {
    await disconnectAll()
  }
})

test('getAdapter(name) on a registered-but-unopened connection throws a clear error', async () => {
  registerNamed('main')
  registerNamed('reporting')
  ConnectionManager.setDefaultName('main')
  ModelRegistry.set(await ConnectionManager.ensure('main'))
  try {
    assert.throws(
      () => ModelRegistry.getAdapter('reporting'),
      /connection 'reporting' is not open/,
    )
    // The default name routes to the registry adapter as before.
    assert.ok(ModelRegistry.getAdapter('main'))
    assert.ok(ModelRegistry.getAdapter())
  } finally {
    await disconnectAll()
  }
})

test('two named connections with the same URL hold distinct drivers', async () => {
  registerNamed('a')
  registerNamed('b')
  try {
    const a = await ConnectionManager.ensure('a')
    const b = await ConnectionManager.ensure('b')
    assert.notEqual(a, b)

    // Distinct :memory: databases — a table on 'a' is invisible on 'b'.
    await a.affectingStatement!('create table only_a (n integer)', [])
    const onB = await b.selectRaw!(
      "select name from sqlite_master where type = 'table' and name = 'only_a'", [])
    assert.equal(onB.length, 0)
  } finally {
    await disconnectAll()
  }
})
