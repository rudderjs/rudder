// Model-layer named connections: `static connection` + `Model.on(name)` +
// the deferred record-and-replay QB (first query on a not-yet-open named
// connection records chainables, opens on the first terminal, replays).
//
// Two `:memory:` sqlite databases stand in for two connections — cross-
// connection leakage shows up as data divergence, no server needed. Schema for
// the named connection is created INSIDE its factory so the deferred path can
// be exercised end-to-end (the connection's first open happens at a Model
// terminal, not at a setup statement).

import assert from 'node:assert/strict'
import { test, beforeEach } from 'node:test'
import { Model, ModelRegistry, ConnectionManager, transaction } from './index.js'
import { NativeAdapter } from '@rudderjs/database/native'

class Metric extends Model {
  static override table = 'metrics'
  static override connection = 'metrics-db'
  id!: number
  name!: string
  value!: number
}

class Widget extends Model {
  static override table = 'widgets'
  id!: number
  name!: string
}

let factoryOpens: Record<string, number> = {}

async function setup(): Promise<void> {
  ConnectionManager.__reset()
  ModelRegistry.reset()
  factoryOpens = {}

  ConnectionManager.register('main', async () => {
    factoryOpens['main'] = (factoryOpens['main'] ?? 0) + 1
    const adapter = await NativeAdapter.make({ driver: 'sqlite', url: ':memory:', connectionName: 'main' })
    await adapter.affectingStatement(
      'create table widgets (id integer primary key autoincrement, name text)', [])
    return adapter
  })
  ConnectionManager.register('metrics-db', async () => {
    factoryOpens['metrics-db'] = (factoryOpens['metrics-db'] ?? 0) + 1
    const adapter = await NativeAdapter.make({ driver: 'sqlite', url: ':memory:', connectionName: 'metrics-db' })
    await adapter.affectingStatement(
      'create table metrics (id integer primary key autoincrement, name text, value integer)', [])
    return adapter
  })
  ConnectionManager.setDefaultName('main')
  ModelRegistry.set(await ConnectionManager.ensure('main'))
}

async function teardown(): Promise<void> {
  for (const name of ConnectionManager.names()) {
    const adapter = ConnectionManager.peek(name) as NativeAdapter | null
    if (adapter) await adapter.disconnect()
  }
  ConnectionManager.__reset()
}

beforeEach(async () => {
  await setup()
})

test('static connection routes CRUD to the named database; default models unaffected', async () => {
  try {
    const m = await Metric.create({ name: 'rps', value: 100 })
    assert.equal(m.name, 'rps')
    await Widget.create({ name: 'gear' })

    // Data landed on separate databases.
    const metricsMain = await (ConnectionManager.peek('main'))!.selectRaw!(
      "select name from sqlite_master where type = 'table' and name = 'metrics'", [])
    assert.equal(metricsMain.length, 0, 'metrics table must not exist on main')

    // Reads route to the named connection too — full round trip.
    const found = await Metric.where('name', 'rps').first()
    assert.equal(found?.value, 100)
    assert.equal(await Metric.count(), 1)
    assert.equal(await Widget.count(), 1)

    // update + delete on the named connection.
    await Metric.update(m.id, { value: 250 })
    assert.equal((await Metric.find(m.id))?.value, 250)
    await Metric.delete(m.id)
    assert.equal(await Metric.count(), 0)
  } finally {
    await teardown()
  }
})

test('the first Metric query opens metrics-db lazily — exactly once across concurrent queries', async () => {
  try {
    assert.equal(ConnectionManager.peek('metrics-db'), null, 'not open before first query')

    // Three concurrent FIRST queries: all deferred, one factory open.
    const [a, b, c] = await Promise.all([
      Metric.query().where('value', '>', 0).get(),
      Metric.count(),
      Metric.all(),
    ])
    assert.deepEqual([a.length, b, c.length], [0, 0, 0])
    assert.equal(factoryOpens['metrics-db'], 1, 'single-flight open')
    assert.ok(ConnectionManager.peek('metrics-db'), 'memoized after first terminal')
  } finally {
    await teardown()
  }
})

test('chainables recorded before the open replay in order (where sugar + orderBy + limit)', async () => {
  try {
    // Seed AFTER registering but via the model itself (first create opens).
    await Metric.create({ name: 'a', value: 1 })
    await Metric.create({ name: 'b', value: 2 })
    await Metric.create({ name: 'c', value: 3 })
    await Metric.create({ name: 'd', value: 4 })

    // Force a FRESH deferred path: re-register (clears the memoized adapter)
    // with a factory that reuses the SAME underlying driver via the HMR cache
    // (same connectionName + url ⇒ same :memory: database, data intact).
    ConnectionManager.register('metrics-db', async () => {
      factoryOpens['metrics-db'] = (factoryOpens['metrics-db'] ?? 0) + 1
      return NativeAdapter.make({ driver: 'sqlite', url: ':memory:', connectionName: 'metrics-db' })
    })
    assert.equal(ConnectionManager.peek('metrics-db'), null)

    const rows = await Metric
      .whereIn('name', ['a', 'b', 'c'])     // hydrating-proxy sugar → recorded primitives
      .where('value', '>', 1)
      .orderBy('value', 'DESC')
      .limit(1)
      .get()

    assert.equal(rows.length, 1)
    assert.equal(rows[0]?.name, 'c')
    assert.ok(rows[0] instanceof Metric, 'hydration intact through the deferred QB')
  } finally {
    await teardown()
  }
})

test('chunk/lazy work across the deferred boundary (limit/offset mutation after materialize)', async () => {
  try {
    for (let i = 1; i <= 5; i++) await Metric.create({ name: `m${i}`, value: i })

    // Fresh deferred path again (same trick as above).
    ConnectionManager.register('metrics-db', async () =>
      NativeAdapter.make({ driver: 'sqlite', url: ':memory:', connectionName: 'metrics-db' }))

    const seen: number[] = []
    await Metric.query().orderBy('value', 'ASC').chunk(2, (batch) => {
      seen.push(...batch.map((m) => m.value))
    })
    assert.deepEqual(seen, [1, 2, 3, 4, 5])

    const lazySeen: number[] = []
    for await (const m of Metric.query().orderBy('value', 'ASC').lazy(2)) {
      lazySeen.push(m.value)
    }
    assert.deepEqual(lazySeen, [1, 2, 3, 4, 5])
  } finally {
    await teardown()
  }
})

test('Model.on(name) runs a one-off query on another connection', async () => {
  try {
    // Widget lives on 'main'; create a widgets table on metrics-db with a row
    // to prove `on()` targets it.
    await DBexec('metrics-db', 'create table widgets (id integer primary key autoincrement, name text)')
    await DBexec('metrics-db', "insert into widgets (name) values ('on-metrics')")
    await Widget.create({ name: 'on-main' })

    const viaOn = await Widget.on('metrics-db').get()
    assert.deepEqual(viaOn.map((w) => w.name), ['on-metrics'])
    assert.ok(viaOn[0] instanceof Widget)

    const viaDefault = await Widget.all()
    assert.deepEqual(viaDefault.map((w) => w.name), ['on-main'])
  } finally {
    await teardown()
  }
})

test('Model.on(event, handler) two-arg form still registers lifecycle listeners', async () => {
  try {
    const events: string[] = []
    Widget.on('creating', () => { events.push('creating') })
    Widget.on('created', () => { events.push('created') })

    await Widget.create({ name: 'observed' })
    assert.deepEqual(events, ['creating', 'created'])
  } finally {
    await teardown()
  }
})

test('writes on a static-connection model join transaction(fn, { connection })', async () => {
  try {
    await assert.rejects(
      transaction(async () => {
        await Metric.create({ name: 'doomed', value: 1 })
        throw new Error('rollback metrics')
      }, { connection: 'metrics-db' }),
      /rollback metrics/,
    )
    assert.equal(await Metric.count(), 0, 'named tx rolled the model write back')

    await transaction(async () => {
      await Metric.create({ name: 'kept', value: 2 })
    }, { connection: 'metrics-db' })
    assert.equal(await Metric.count(), 1)
  } finally {
    await teardown()
  }
})

test('a DEFAULT-connection transaction does not capture a named-connection model write', async () => {
  try {
    await assert.rejects(
      transaction(async () => {
        await Widget.create({ name: 'doomed' })       // default — rolls back
        await Metric.create({ name: 'kept', value: 9 }) // metrics-db — not in this tx
        throw new Error('rollback default')
      }),
      /rollback default/,
    )
    assert.equal(await Widget.count(), 0)
    assert.equal(await Metric.count(), 1)
  } finally {
    await teardown()
  }
})

test('observer events fire for models on a named connection', async () => {
  try {
    const events: string[] = []
    Metric.on('creating', () => { events.push('creating') })
    Metric.on('created', () => { events.push('created') })

    await Metric.create({ name: 'observed', value: 1 })
    assert.deepEqual(events, ['creating', 'created'])
  } finally {
    await teardown()
  }
})

test('static connection naming an UNKNOWN connection fails with the configured-names error', async () => {
  try {
    class Orphan extends Model {
      static override table = 'orphans'
      static override connection = 'nope'
    }
    await assert.rejects(() => Orphan.count(), /Unknown database connection 'nope'/)
  } finally {
    await teardown()
  }
})

/** Raw statement helper on a named connection (opens it if needed). */
async function DBexec(name: string, sql: string): Promise<void> {
  const adapter = await ConnectionManager.ensure(name)
  await adapter.affectingStatement!(sql, [])
}
