// chunk() / lazy() — memory-bounded iteration at the Model layer.
//
// Both are adapter-agnostic (they page the query via the existing LIMIT/OFFSET
// primitives), so a real in-memory native better-sqlite3 adapter is enough to
// prove the paging, early-stop, and streaming behavior end-to-end.

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { Model, ModelRegistry } from './index.js'
import { NativeAdapter } from '@rudderjs/database/native'
import { BetterSqlite3Driver } from '@rudderjs/database/native'
import type { Driver } from '@rudderjs/database/native'

class Item extends Model {
  static override table = 'items'
  id!: number
  n!: number
}

let driver: Driver

beforeEach(async () => {
  driver = await BetterSqlite3Driver.open({ filename: ':memory:' })
  await driver.execute(`CREATE TABLE items (id INTEGER PRIMARY KEY AUTOINCREMENT, n INTEGER)`, [])
  ModelRegistry.reset()
  ModelRegistry.set(await NativeAdapter.make({ driverInstance: driver }))
  // 10 rows: n = 0..9
  for (let i = 0; i < 10; i++) await Item.create({ n: i })
})

afterEach(async () => { await driver.close() })

describe('Model.chunk()', () => {
  it('pages the full set in size-bounded chunks', async () => {
    const pageSizes: number[] = []
    const seen: number[] = []
    const done = await Item.query().orderBy('id').chunk(3, (rows) => {
      pageSizes.push(rows.length)
      for (const r of rows) seen.push(r.n)
    })
    assert.strictEqual(done, true)
    assert.deepEqual(pageSizes, [3, 3, 3, 1]) // 10 rows / size 3
    assert.deepEqual(seen, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
  })

  it('hydrates each page into Model instances', async () => {
    await Item.query().orderBy('id').chunk(5, (rows) => {
      assert.ok(rows.every(r => r instanceof Item))
    })
  })

  it('stops early when the callback returns false', async () => {
    const seen: number[] = []
    const done = await Item.query().orderBy('id').chunk(3, (rows) => {
      for (const r of rows) seen.push(r.n)
      return false // bail after the first page
    })
    assert.strictEqual(done, false)
    assert.deepEqual(seen, [0, 1, 2])
  })

  it('respects chained where filters', async () => {
    const seen: number[] = []
    await Item.query().where('n', '>=', 5).orderBy('id').chunk(2, (rows) => {
      for (const r of rows) seen.push(r.n)
    })
    assert.deepEqual(seen, [5, 6, 7, 8, 9])
  })

  it('runs the callback zero times on an empty result', async () => {
    let calls = 0
    const done = await Item.query().where('n', '>', 999).chunk(3, () => { calls++ })
    assert.strictEqual(done, true)
    assert.strictEqual(calls, 0)
  })

  it('exact multiple of the page size terminates cleanly', async () => {
    const pages: number[] = []
    await Item.query().orderBy('id').chunk(5, (rows) => { pages.push(rows.length) })
    assert.deepEqual(pages, [5, 5]) // 10 / 5 — no trailing empty page
  })

  it('rejects a non-positive size', async () => {
    await assert.rejects(Item.query().chunk(0, () => {}), /positive integer/)
    await assert.rejects(Item.query().chunk(-1, () => {}), /positive integer/)
  })
})

describe('Model.lazy()', () => {
  it('streams every row one at a time', async () => {
    const seen: number[] = []
    for await (const item of Item.query().orderBy('id').lazy(4)) seen.push(item.n)
    assert.deepEqual(seen, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
  })

  it('yields Model instances', async () => {
    for await (const item of Item.query().orderBy('id').lazy(4)) {
      assert.ok(item instanceof Item)
      break
    }
  })

  it('supports early break (no further pages fetched than needed)', async () => {
    const seen: number[] = []
    for await (const item of Item.query().orderBy('id').lazy(3)) {
      seen.push(item.n)
      if (seen.length === 4) break
    }
    assert.deepEqual(seen, [0, 1, 2, 3])
  })

  it('defaults to a 1000-row page size and respects where filters', async () => {
    const seen: number[] = []
    for await (const item of Item.query().where('n', '<', 3).orderBy('id').lazy()) seen.push(item.n)
    assert.deepEqual(seen, [0, 1, 2])
  })

  it('rejects a non-positive size', () => {
    assert.throws(() => Item.query().lazy(0), /positive integer/)
  })
})

describe('Model static entry points', () => {
  it('Model.chunk() forwards to the query builder', async () => {
    let total = 0
    await Item.chunk(4, (rows) => { total += rows.length })
    assert.strictEqual(total, 10)
  })

  it('Model.lazy() forwards to the query builder', async () => {
    let total = 0
    for await (const _ of Item.lazy(4)) total++
    assert.strictEqual(total, 10)
  })
})
