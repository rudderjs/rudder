import assert from 'node:assert/strict'
import { test, beforeEach } from 'node:test'
import type { OrmAdapter, QueryListener, Row } from '@rudderjs/contracts'
import {
  DB,
  registerConnectionResolver,
  registerNamedTransactionRunner,
  __resetAdapterResolver,
} from './index.js'

// A minimal fake adapter capturing raw-exec calls, one per connection name.
function makeFakeAdapter(tag: string): {
  adapter: OrmAdapter
  calls: { method: string; sql: string; bindings: readonly unknown[] }[]
  listeners: QueryListener[]
} {
  const calls: { method: string; sql: string; bindings: readonly unknown[] }[] = []
  const listeners: QueryListener[] = []
  const adapter = {
    async selectRaw(sql: string, bindings: readonly unknown[]): Promise<Row[]> {
      calls.push({ method: 'selectRaw', sql, bindings })
      return [{ tag }]
    },
    async affectingStatement(sql: string, bindings: readonly unknown[]): Promise<number> {
      calls.push({ method: 'affectingStatement', sql, bindings })
      return 1
    },
    onQuery(listener: QueryListener): void {
      listeners.push(listener)
    },
  } as unknown as OrmAdapter
  return { adapter, calls, listeners }
}

beforeEach(() => {
  __resetAdapterResolver()
})

test('DB.connection methods reject with a clear error when no resolver is registered', async () => {
  await assert.rejects(
    () => DB.connection('reporting').select('select 1', []),
    /No connection resolver is available/,
  )
})

test('DB.connection routes each call through the resolver with the right name', async () => {
  const main = makeFakeAdapter('main')
  const reporting = makeFakeAdapter('reporting')
  const resolved: string[] = []
  registerConnectionResolver(async (name) => {
    resolved.push(name)
    return name === 'reporting' ? reporting.adapter : main.adapter
  })

  const rows = await DB.connection('reporting').select('select * from stats', [9])
  await DB.connection('reporting').insert('insert into stats values (?)', [1])
  await DB.connection('main').statement('vacuum', [])

  assert.deepEqual(rows, [{ tag: 'reporting' }])
  assert.deepEqual(resolved, ['reporting', 'reporting', 'main'])
  assert.deepEqual(reporting.calls.map((c) => c.method), ['selectRaw', 'affectingStatement'])
  assert.deepEqual(main.calls.map((c) => c.method), ['affectingStatement'])
})

test('DB.connection update/delete route to affectingStatement', async () => {
  const fake = makeFakeAdapter('x')
  registerConnectionResolver(async () => fake.adapter)

  assert.equal(await DB.connection('x').update('update t set a = ?', [1]), 1)
  assert.equal(await DB.connection('x').delete('delete from t', []), 1)
  assert.deepEqual(fake.calls.map((c) => c.method), ['affectingStatement', 'affectingStatement'])
})

test('DB.connection(name).transaction routes to the named runner with the name', async () => {
  const seen: string[] = []
  registerNamedTransactionRunner(async (name, fn) => {
    seen.push(name)
    return fn()
  })

  const result = await DB.connection('reporting').transaction(async () => 42)

  assert.equal(result, 42)
  assert.deepEqual(seen, ['reporting'])
})

test('DB.connection(name).transaction rejects with a clear error when no runner is registered', async () => {
  await assert.rejects(
    () => DB.connection('reporting').transaction(async () => 1),
    /No named transaction runner is available/,
  )
})

test('DB.connection(name).listen resolves the connection then attaches the listener', async () => {
  const fake = makeFakeAdapter('x')
  registerConnectionResolver(async () => fake.adapter)

  const listener: QueryListener = () => {}
  await DB.connection('x').listen(listener)

  assert.deepEqual(fake.listeners, [listener])
})

test('a connection without raw seams rejects with the adapter-naming error', async () => {
  const bare = {} as unknown as OrmAdapter
  registerConnectionResolver(async () => bare)

  await assert.rejects(
    () => DB.connection('x').select('select 1', []),
    /does not implement selectRaw/,
  )
  await assert.rejects(
    () => DB.connection('x').listen(() => {}),
    /does not implement onQuery/,
  )
})
