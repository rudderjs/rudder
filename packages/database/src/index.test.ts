import assert from 'node:assert/strict'
import { test, beforeEach } from 'node:test'
import type { OrmAdapter, Row } from '@rudderjs/contracts'
import {
  DB,
  Expression,
  registerAdapterResolver,
  resolveAdapter,
  __resetAdapterResolver,
} from './index.js'

// A minimal fake adapter capturing the raw-exec calls. Only the members the DB
// facade touches are implemented; the rest of OrmAdapter is cast away.
function makeFakeAdapter(over: Partial<OrmAdapter> = {}): {
  adapter: OrmAdapter
  calls: { method: string; sql: string; bindings: readonly unknown[] }[]
} {
  const calls: { method: string; sql: string; bindings: readonly unknown[] }[] = []
  const base = {
    async selectRaw(sql: string, bindings: readonly unknown[]): Promise<Row[]> {
      calls.push({ method: 'selectRaw', sql, bindings })
      return [{ one: 1 }]
    },
    async affectingStatement(sql: string, bindings: readonly unknown[]): Promise<number> {
      calls.push({ method: 'affectingStatement', sql, bindings })
      return 3
    },
  }
  const adapter = { ...base, ...over } as unknown as OrmAdapter
  return { adapter, calls }
}

beforeEach(() => {
  __resetAdapterResolver()
})

test('resolveAdapter throws a clear error when no resolver is registered', () => {
  assert.throws(() => resolveAdapter(), /No ORM adapter is available/)
})

test('DB.select routes to selectRaw and passes sql + bindings through', async () => {
  const { adapter, calls } = makeFakeAdapter()
  registerAdapterResolver(() => adapter)

  const rows = await DB.select('select * from users where id = ?', [7])

  assert.deepEqual(rows, [{ one: 1 }])
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0], {
    method: 'selectRaw',
    sql: 'select * from users where id = ?',
    bindings: [7],
  })
})

test('DB write methods route to affectingStatement and return the affected count', async () => {
  const { adapter, calls } = makeFakeAdapter()
  registerAdapterResolver(() => adapter)

  assert.equal(await DB.insert('insert into t (a) values (?)', [1]), 3)
  assert.equal(await DB.update('update t set a = ?', [2]), 3)
  assert.equal(await DB.delete('delete from t where a = ?', [3]), 3)
  assert.equal(await DB.statement('vacuum'), 3)

  assert.deepEqual(calls.map((c) => c.method), [
    'affectingStatement',
    'affectingStatement',
    'affectingStatement',
    'affectingStatement',
  ])
  // Default bindings are an empty array when omitted.
  assert.deepEqual(calls[3]?.bindings, [])
})

test('DB.select throws an adapter-named error when the seam is missing', async () => {
  const adapter = { constructor: { name: 'LegacyAdapter' } } as unknown as OrmAdapter
  registerAdapterResolver(() => adapter)

  await assert.rejects(
    () => DB.select('select 1'),
    /LegacyAdapter does not implement selectRaw\(\)/,
  )
})

test('DB write throws an adapter-named error when the seam is missing', async () => {
  const adapter = { constructor: { name: 'LegacyAdapter' } } as unknown as OrmAdapter
  registerAdapterResolver(() => adapter)

  await assert.rejects(
    () => DB.insert('insert into t default values'),
    /LegacyAdapter does not implement affectingStatement\(\)/,
  )
})

test('DB.raw wraps a literal as an Expression', () => {
  const expr = DB.raw('NOW()')
  assert.ok(expr instanceof Expression)
  assert.equal(expr.getValue(), 'NOW()')
  assert.equal(String(expr), 'NOW()')
})
