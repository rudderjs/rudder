// Model-layer guard errors (audit §3 — throws that existed in source with no
// test asserting them): chunk/lazy size validation, named-scope typos, the
// upsert capability check, increment/decrement without a primary key, observer
// cancellation (a `false` return aborts the write with a clear error), and the
// deferred-connection QB's self-diagnosing method-unavailable throws.

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { Model, ModelRegistry, ConnectionManager } from './index.js'
import type { OrmAdapter, QueryBuilder } from '@rudderjs/contracts'
import { NativeAdapter, BetterSqlite3Driver } from '@rudderjs/database/native'
import type { Driver } from '@rudderjs/database/native'

let driver: Driver

beforeEach(async () => {
  driver = await BetterSqlite3Driver.open({ filename: ':memory:' })
  await driver.execute(
    `CREATE TABLE items (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, count INTEGER, deletedAt TEXT)`,
    [],
  )
  ModelRegistry.reset()
  ModelRegistry.set(await NativeAdapter.make({ driverInstance: driver }))
})
afterEach(async () => { await driver.close() })

// Fresh class per test where observers are registered — observer lists live on
// the class, so a shared fixture would leak handlers across tests.
function makeItem() {
  return class Item extends Model {
    static override table = 'items'
    id!: number
    name!: string
    count!: number
  }
}

describe('chunk() / lazy() size validation', () => {
  it('chunk rejects zero, negative, and non-integer sizes', async () => {
    const Item = makeItem()
    for (const bad of [0, -5, 1.5]) {
      await assert.rejects(
        () => Item.query().chunk(bad, () => {}),
        /chunk\(size, callback\): size must be a positive integer/,
      )
    }
  })

  it('lazy rejects a non-positive size at first iteration', async () => {
    const Item = makeItem()
    await assert.rejects(
      (async () => { for await (const _ of Item.query().lazy(0)) void _ })(),
      /lazy\(size\): size must be a positive integer/,
    )
  })
})

describe('named-scope typo guard', () => {
  it('scope("x") throws naming the scope and the model', () => {
    const Item = makeItem()
    assert.throws(
      () => (Item.query() as unknown as { scope(n: string): unknown }).scope('missing'),
      /Scope "missing" is not defined on Item/,
    )
  })
})

describe('upsert capability guard', () => {
  it('rejects with a clear error when the adapter QB lacks upsert()', async () => {
    // Minimal fake adapter: enough surface for _adapterQb, deliberately no upsert.
    const qb = { where: () => qb, get: async () => [] } as unknown as QueryBuilder<unknown>
    ModelRegistry.set({ query: () => qb } as unknown as OrmAdapter)
    const Item = makeItem()
    await assert.rejects(
      () => Item.upsert([{ name: 'a' }], 'name'),
      /The active adapter does not support upsert\(\) \(called on Item\)/,
    )
  })
})

describe('increment / decrement without a primary key', () => {
  it('both instance forms reject before touching the database', async () => {
    const Item = makeItem()
    const unsaved = new Item()
    await assert.rejects(() => unsaved.increment('count'), /Cannot increment a Item without a primary key/)
    await assert.rejects(() => unsaved.decrement('count'), /Cannot decrement a Item without a primary key/)
  })
})

describe('observer cancellation (false return aborts the write)', () => {
  it('creating → false cancels the create and persists nothing', async () => {
    const Item = makeItem()
    Item.on('creating', () => false)
    await assert.rejects(() => Item.create({ name: 'x' }), /Create cancelled by observer on Item/)
    assert.equal(await Item.query().count(), 0)
  })

  it('saving → false cancels the create too', async () => {
    const Item = makeItem()
    Item.on('saving', () => false)
    await assert.rejects(() => Item.create({ name: 'x' }), /Create cancelled by saving observer on Item/)
  })

  it('updating → false cancels the update and leaves the row untouched', async () => {
    const Item = makeItem()
    const row = await Item.create({ name: 'before' })
    Item.on('updating', () => false)
    await assert.rejects(() => Item.update(row.id, { name: 'after' }), /Update cancelled by observer on Item/)
    assert.equal((await Item.find(row.id))?.name, 'before')
  })

  it('saving → false cancels the update too', async () => {
    const Item = makeItem()
    const row = await Item.create({ name: 'before' })
    Item.on('saving', () => false)
    await assert.rejects(() => Item.update(row.id, { name: 'after' }), /Update cancelled by saving observer on Item/)
  })

  it('deleting → false cancels the delete', async () => {
    const Item = makeItem()
    const row = await Item.create({ name: 'keep' })
    Item.on('deleting', () => false)
    await assert.rejects(() => row.delete(), /Delete cancelled by observer on Item/)
    assert.equal(await Item.query().count(), 1)
  })

  it('restoring → false cancels the restore (soft-delete model)', async () => {
    class SoftItem extends Model {
      static override table = 'items'
      static override softDeletes = true
      id!: number
      name!: string
    }
    const row = await SoftItem.create({ name: 'gone' })
    await row.delete() // soft
    SoftItem.on('restoring', () => false)
    await assert.rejects(() => row.restore(), /Restore cancelled by observer on SoftItem/)
  })
})

describe('deferred-connection QB self-diagnosing throws', () => {
  afterEach(() => { ConnectionManager.__reset() })

  it('a queued chainable missing on the materialized QB throws naming the method', async () => {
    // Adapter QB with where() but no orderBy(): the recorder queues blindly,
    // materialization surfaces the gap with the method name.
    const qb = { where: () => qb, get: async () => [] }
    ConnectionManager.register('limited', async () => ({ query: () => qb }) as unknown as OrmAdapter)
    const Item = makeItem()
    await assert.rejects(
      () => Item.on('limited').orderBy('id').get(),
      /orderBy\(\) was queued against a deferred connection, but .* does not implement it/,
    )
  })

  it('an optional terminal the adapter omits throws a clear pointer', async () => {
    const qb = { get: async () => [] }
    ConnectionManager.register('limited', async () => ({ query: () => qb }) as unknown as OrmAdapter)
    const Item = makeItem()
    await assert.rejects(
      () => (Item.on('limited') as unknown as { upsert(rows: unknown[], by: string): Promise<number> }).upsert([{ name: 'a' }], 'name'),
      /upsert\(\) is not implemented by this connection's adapter/,
    )
  })
})
