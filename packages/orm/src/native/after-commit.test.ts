// afterCommit() — end-to-end on the NATIVE engine.
//
// Real better-sqlite3 with real BEGIN/SAVEPOINT/ROLLBACK: proves the callbacks
// run strictly AFTER the data is durable (a callback re-querying outside the
// transaction scope sees the committed rows), that a rollback drops them, and
// that savepoint nesting flushes only at the outermost commit. Also covers
// `DB.afterCommit()` sharing the same queue via the db-bridge. Queue-semantics
// units live in `../after-commit.test.ts`.

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import '../db-bridge.js' // side effect: pushes the orm runners into the DB facade
import { Model, ModelRegistry, transaction, afterCommit } from '../index.js'
import { DB } from '@rudderjs/database'
import { NativeAdapter, BetterSqlite3Driver, type Driver } from '@rudderjs/database/native'

class Order extends Model {
  static override table = 'orders'
  id!: number
  state!: string
}

let driver: Driver

beforeEach(async () => {
  driver = await BetterSqlite3Driver.open({ filename: ':memory:' })
  await driver.execute(`CREATE TABLE orders (id INTEGER PRIMARY KEY AUTOINCREMENT, state TEXT NOT NULL)`, [])
  ModelRegistry.reset()
  ModelRegistry.set(await NativeAdapter.make({ driverInstance: driver }))
})

afterEach(async () => {
  await driver.close()
})

describe('afterCommit — native sqlite E2E', () => {
  it('callbacks run after COMMIT and see the durable rows', async () => {
    let seenInsideCallback: number | undefined
    await transaction(async () => {
      const order = await Order.create({ state: 'placed' })
      await afterCommit(async () => {
        // Outside the transaction ALS scope now — this query runs on the base
        // connection and must see the committed row.
        const fresh = await Order.findOrFail(order.id)
        assert.strictEqual(fresh.state, 'placed')
        seenInsideCallback = fresh.id
      })
    })
    assert.ok(seenInsideCallback !== undefined)
  })

  it('a rollback drops both the rows and the callbacks', async () => {
    const ran: string[] = []
    await assert.rejects(
      transaction(async () => {
        await Order.create({ state: 'placed' })
        await afterCommit(() => { ran.push('cb') })
        throw new Error('rollback')
      }),
      /rollback/,
    )
    assert.deepStrictEqual(ran, [])
    assert.strictEqual(await Order.count(), 0)
  })

  it('savepoint nesting: inner callbacks flush at the outermost commit only', async () => {
    const log: string[] = []
    await transaction(async () => {
      await Order.create({ state: 'outer' })
      await transaction(async () => {
        await Order.create({ state: 'inner' })
        await afterCommit(() => { log.push('inner-cb') })
      })
      log.push('between')
    })
    assert.deepStrictEqual(log, ['between', 'inner-cb'])
    assert.strictEqual(await Order.count(), 2)
  })

  it('a rolled-back savepoint discards its callbacks AND its rows; outer commit flushes the rest', async () => {
    const log: string[] = []
    await transaction(async () => {
      await Order.create({ state: 'outer' })
      await afterCommit(() => { log.push('outer-cb') })
      await transaction(async () => {
        await Order.create({ state: 'inner' })
        await afterCommit(() => { log.push('inner-cb') })
        throw new Error('savepoint-rollback')
      }).catch(() => {})
    })
    assert.deepStrictEqual(log, ['outer-cb'])
    assert.strictEqual(await Order.count(), 1)
  })

  it('DB.afterCommit() shares the queue with transaction()/afterCommit()', async () => {
    const log: string[] = []
    await DB.transaction(async () => {
      await Order.create({ state: 'placed' })
      await DB.afterCommit(() => { log.push('db-cb') })
      await afterCommit(() => { log.push('orm-cb') })
      log.push('body')
    })
    assert.deepStrictEqual(log, ['body', 'db-cb', 'orm-cb'])
  })

  it('DB.afterCommit() with no open transaction runs immediately', async () => {
    const ran: string[] = []
    await DB.afterCommit(() => { ran.push('now') })
    assert.deepStrictEqual(ran, ['now'])
  })
})
