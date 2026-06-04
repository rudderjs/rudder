// whereExists / whereNotExists through the Model layer — hydrating-proxy
// forwarding, Model-rooted subquery bodies, statics, and the
// unsupported-adapter guard. (Compiler units + adapter E2E live in
// @rudderjs/database's where-exists.test.ts.)

import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import type { OrmAdapter, QueryBuilder } from '@rudderjs/contracts'
import { Model, ModelRegistry } from '../index.js'
import { NativeAdapter, BetterSqlite3Driver } from '@rudderjs/database/native'
import type { Driver } from '@rudderjs/database/native'

class User extends Model {
  static override table = 'users'
  id!:   number
  name!: string
}

class Order extends Model {
  static override table = 'orders'
  id!:     number
  userId!: number
  total!:  number
}

let driver: Driver

describe('whereExists (Model layer, native sqlite)', () => {
  before(async () => {
    driver = await BetterSqlite3Driver.open({ filename: ':memory:' })
    await driver.execute('CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)', [])
    await driver.execute('CREATE TABLE orders (id INTEGER PRIMARY KEY AUTOINCREMENT, userId INTEGER, total INTEGER)', [])
    ModelRegistry.reset()
    ModelRegistry.set(await NativeAdapter.make({ driverInstance: driver }))
    for (const name of ['alice', 'bob', 'carol']) await User.create({ name })
    // alice: 120 + 30; bob: 40; carol: none.
    for (const [userId, total] of [[1, 120], [1, 30], [2, 40]] as const) await Order.create({ userId, total })
  })
  after(async () => { await driver.close() })

  const names = (rows: User[]): string[] => rows.map(r => r.name).sort()

  it('Model static + builder body (a Model query correlates via whereColumn)', async () => {
    const rows = await User.whereExists(
      Order.query().whereColumn('orders.userId', '=', 'users.id'),
    ).get()
    assert.deepEqual(names(rows), ['alice', 'bob'])
    assert.ok(rows[0] instanceof User)
  })

  it('whereNotExists inverts; raw-SQL body binds', async () => {
    assert.deepEqual(
      names(await User.whereNotExists(Order.query().whereColumn('orders.userId', '=', 'users.id')).get()),
      ['carol'],
    )
    assert.deepEqual(
      names(await User.query().whereExists('SELECT 1 FROM orders WHERE orders.userId = users.id AND total > ?', [50]).get()),
      ['alice'],
    )
  })

  it('orWhereExists composes with prior clauses', async () => {
    const rows = await User.where('name', 'carol')
      .orWhereExists(Order.query().whereColumn('orders.userId', '=', 'users.id').where('total', '>', 100))
      .get()
    assert.deepEqual(names(rows), ['alice', 'carol'])
  })
})

describe('whereExists — unsupported-adapter guard', () => {
  it('throws the forward-or-throw error when the adapter QB lacks the method', () => {
    const bareQb = {} as QueryBuilder<unknown>
    const adapter = {
      query: () => bareQb,
      connect: async () => {},
      disconnect: async () => {},
    } as unknown as OrmAdapter
    ModelRegistry.reset()
    ModelRegistry.set(adapter)

    class Thing extends Model {
      static override table = 'things'
    }

    assert.throws(
      () => Thing.query().whereExists('SELECT 1'),
      /whereExists\(\) is not supported on this adapter/,
    )
    assert.throws(
      () => Thing.query().orWhereNotExists('SELECT 1'),
      /orWhereNotExists\(\) is not supported on this adapter/,
    )
  })
})
