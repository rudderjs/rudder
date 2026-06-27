// _cursorClone() — the structural copy the Model layer's chunkById/lazyById use
// to page by primary key WITHOUT accumulating the cursor bound. Each page clones
// the pristine base and applies a single `WHERE pk > lastId LIMIT size` to the
// COPY, so the base is never mutated and the WHERE can't grow across pages.

import assert from 'node:assert/strict'
import { describe, it, before, after } from 'node:test'
import { NativeAdapter } from './adapter.js'
import type { NativeQueryBuilder } from './query-builder.js'

interface ItemRow { id: number; n: number }

describe('_cursorClone (native sqlite E2E)', () => {
  let adapter: NativeAdapter
  const items = (): NativeQueryBuilder<ItemRow> =>
    adapter.query<ItemRow>('items') as NativeQueryBuilder<ItemRow>

  before(async () => {
    adapter = await NativeAdapter.make({ driver: 'sqlite', url: ':memory:' })
    await adapter.affectingStatement('CREATE TABLE items (id INTEGER PRIMARY KEY AUTOINCREMENT, n INTEGER)', [])
    // 10 rows: id 1..10, n 0..9.
    for (let i = 0; i < 10; i++) await adapter.affectingStatement('INSERT INTO items (n) VALUES (?)', [i])
  })
  after(async () => { await adapter.disconnect() })

  it('clones the base with its filters/order so a page reads correctly', async () => {
    const base = items().where('n', '>=', 4).orderBy('id', 'ASC')
    const page = base._cursorClone()
    page.limit(3)
    const rows = await page.get()
    assert.deepEqual(rows.map(r => r.id), [5, 6, 7]) // n>=4 → id 5..; first 3
  })

  it('mutating a clone never touches the base builder', async () => {
    const base = items().where('n', '>=', 0).orderBy('id', 'ASC')
    // Mutate two independent clones with cursor bounds + limits.
    const p1 = base._cursorClone(); p1.limit(2)
    const p2 = base._cursorClone(); p2.where('id', '>', 2).limit(2)
    assert.deepEqual((await p1.get()).map(r => r.id), [1, 2])
    assert.deepEqual((await p2.get()).map(r => r.id), [3, 4])
    // The base still sees ALL rows — no limit, no cursor leaked from the clones.
    assert.deepEqual((await base.get()).map(r => r.id), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })

  it('a clone is independent of later mutations to its sibling', async () => {
    const base = items().orderBy('id', 'ASC')
    const a = base._cursorClone(); a.limit(3)
    const b = base._cursorClone(); b.where('id', '>', 5).limit(3)
    // Mutating b after a was read must not affect a.
    assert.deepEqual((await a.get()).map(r => r.id), [1, 2, 3])
    assert.deepEqual((await b.get()).map(r => r.id), [6, 7, 8])
  })
})
