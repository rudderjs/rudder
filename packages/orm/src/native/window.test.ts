// Window functions through the Model layer — `selectWindow` on `Model` statics
// + query chains (the compiler units and per-dialect SQL pins live in
// @rudderjs/database's own window.test.ts; this suite proves the
// hydrating-proxy forwarding, Model hydration with the window alias as an
// extra attribute, and the unsupported-adapter guard).

import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import type { OrmAdapter, QueryBuilder } from '@rudderjs/contracts'
import { Model, ModelRegistry } from '../index.js'
import { NativeAdapter, BetterSqlite3Driver } from '@rudderjs/database/native'
import type { Driver } from '@rudderjs/database/native'

class Post extends Model {
  static override table = 'posts'
  id!:     number
  userId!: number
  title!:  string
  views!:  number
}

let driver: Driver

describe('selectWindow (Model layer, native sqlite)', () => {
  before(async () => {
    driver = await BetterSqlite3Driver.open({ filename: ':memory:' })
    await driver.execute(
      'CREATE TABLE posts (id INTEGER PRIMARY KEY AUTOINCREMENT, userId INTEGER, title TEXT, views INTEGER)', [])
    ModelRegistry.reset()
    ModelRegistry.set(await NativeAdapter.make({ driverInstance: driver }))
    for (const [userId, title, views] of [
      [1, 'a1', 30], [1, 'a2', 20], [1, 'a3', 10],
      [2, 'b1', 50], [2, 'b2', 40],
    ] as const) {
      await Post.create({ userId, title, views })
    }
  })
  after(async () => { await driver.close() })

  it('Model static — partitioned row numbers, rows hydrate as Models with the alias', async () => {
    const rows = await Post
      .selectWindow('rowNumber', { as: 'rn', partitionBy: 'userId', orderBy: { column: 'views', direction: 'desc' } })
      .get()
    assert.ok(rows[0] instanceof Post)
    const byTitle = new Map(rows.map(r => [r.title, Number((r as Post & { rn: number }).rn)]))
    assert.deepEqual(
      ['a1', 'a2', 'a3', 'b1', 'b2'].map(t => byTitle.get(t)),
      [1, 2, 3, 1, 2],
    )
    // Base columns still hydrate (ADDITIVE projection).
    assert.ok(rows.every(r => r.title !== undefined && r.views !== undefined))
  })

  it('chains with where/orderBy on a Model.query() chain', async () => {
    const rows = await Post.query()
      .where('userId', 2)
      .selectWindow('rank', { as: 'viewRank', orderBy: { column: 'views', direction: 'desc' } })
      .orderBy('id', 'ASC')
      .get()
    assert.deepEqual(rows.map(r => Number((r as Post & { viewRank: number }).viewRank)), [1, 2])
  })

  it('serializes the alias on toJSON (plain extra attribute)', async () => {
    const rows = await Post
      .selectWindow('denseRank', { as: 'dr', orderBy: 'views' })
      .where('userId', '=', 1)
      .get()
    const json = rows.map(r => r.toJSON() as Record<string, unknown>)
    assert.ok(json.every(j => typeof j['dr'] === 'number' || typeof j['dr'] === 'bigint'))
  })
})

describe('selectWindow — unsupported-adapter guard', () => {
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
      () => Thing.query().selectWindow('rowNumber', { as: 'rn' }),
      /selectWindow\(\) is not supported on this adapter/,
    )
  })
})
