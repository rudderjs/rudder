import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import * as Y from 'yjs'

import {
  ROW_DATA_MAP,
  ROW_ORDER_MAP,
  addRow,
  moveRow,
  newRowId,
  observeRows,
  readRow,
  readRows,
  removeRow,
  seedRows,
  setRowField,
  updateRow,
} from './rows.js'

const ids = (doc: Y.Doc, name = 'rows') => readRows(doc, name).map((r) => r.id)
/** The raw per-row data map for `rows`, typed for direct inspection in tests. */
const rawData = (doc: Y.Doc, name = 'rows') =>
  doc.getMap(ROW_DATA_MAP).get(name) as Y.Map<Y.Map<unknown>>

describe('newRowId', () => {
  it('returns a unique uuid each call', () => {
    const a = newRowId()
    const b = newRowId()
    assert.match(a, /^[0-9a-f-]{36}$/)
    assert.notEqual(a, b)
  })
})

describe('readRows', () => {
  it('is empty for an unseeded array', () => {
    assert.deepEqual(readRows(new Y.Doc(), 'rows'), [])
  })

  it('projects rows in order with their stable id', () => {
    const doc = new Y.Doc()
    const a = addRow(doc, 'rows', { name: 'a' })
    const b = addRow(doc, 'rows', { name: 'b' })
    assert.deepEqual(readRows(doc, 'rows'), [
      { id: a, name: 'a' },
      { id: b, name: 'b' },
    ])
  })

  it('reserves the id key over a field literally named id', () => {
    const doc = new Y.Doc()
    const rowId = addRow(doc, 'rows', { id: 'field-id-should-lose', name: 'x' })
    const [row] = readRows(doc, 'rows')
    assert.equal(row!.id, rowId)
  })

  it('skips an order entry whose data map is gone (dangling id)', () => {
    const doc = new Y.Doc()
    const a = addRow(doc, 'rows', { name: 'a' })
    const b = addRow(doc, 'rows', { name: 'b' })
    // Delete only the data map, leaving a dangling order entry.
    rawData(doc).delete(a)
    assert.deepEqual(readRows(doc, 'rows'), [{ id: b, name: 'b' }])
  })
})

describe('readRow', () => {
  it('reads a single row or undefined', () => {
    const doc = new Y.Doc()
    const id = addRow(doc, 'rows', { name: 'a' })
    assert.deepEqual(readRow(doc, 'rows', id), { id, name: 'a' })
    assert.equal(readRow(doc, 'rows', 'nope'), undefined)
  })
})

describe('addRow', () => {
  it('appends by default and returns a generated id', () => {
    const doc = new Y.Doc()
    const a = addRow(doc, 'rows', { name: 'a' })
    const b = addRow(doc, 'rows', { name: 'b' })
    assert.deepEqual(ids(doc), [a, b])
  })

  it('inserts at a clamped index', () => {
    const doc = new Y.Doc()
    const a = addRow(doc, 'rows', { name: 'a' })
    const b = addRow(doc, 'rows', { name: 'b' })
    const c = addRow(doc, 'rows', { name: 'c' }, { index: 1 })
    assert.deepEqual(ids(doc), [a, c, b])
    const d = addRow(doc, 'rows', { name: 'd' }, { index: 999 })
    assert.deepEqual(ids(doc), [a, c, b, d])
    const e = addRow(doc, 'rows', { name: 'e' }, { index: -5 })
    assert.deepEqual(ids(doc), [e, a, c, b, d])
  })

  it('honors a supplied id', () => {
    const doc = new Y.Doc()
    const id = addRow(doc, 'rows', { name: 'a' }, { id: 'pk-42' })
    assert.equal(id, 'pk-42')
    assert.deepEqual(readRow(doc, 'rows', 'pk-42'), { id: 'pk-42', name: 'a' })
  })

  it('re-adding a known id merges fields without duplicating the order entry', () => {
    const doc = new Y.Doc()
    addRow(doc, 'rows', { name: 'a' }, { id: 'pk-1' })
    addRow(doc, 'rows', { extra: true }, { id: 'pk-1' })
    assert.deepEqual(ids(doc), ['pk-1'])
    assert.deepEqual(readRow(doc, 'rows', 'pk-1'), { id: 'pk-1', name: 'a', extra: true })
  })
})

describe('removeRow', () => {
  it('removes order entry and data, returns whether it removed', () => {
    const doc = new Y.Doc()
    const a = addRow(doc, 'rows', { name: 'a' })
    const b = addRow(doc, 'rows', { name: 'b' })
    assert.equal(removeRow(doc, 'rows', a), true)
    assert.deepEqual(ids(doc), [b])
    assert.equal(rawData(doc).has(a), false)
    assert.equal(removeRow(doc, 'rows', 'nope'), false)
  })
})

describe('moveRow', () => {
  it('reorders to a clamped final index', () => {
    const doc = new Y.Doc()
    const a = addRow(doc, 'rows', { name: 'a' })
    const b = addRow(doc, 'rows', { name: 'b' })
    const c = addRow(doc, 'rows', { name: 'c' })
    assert.equal(moveRow(doc, 'rows', a, 2), true)
    assert.deepEqual(ids(doc), [b, c, a])
    moveRow(doc, 'rows', a, 0)
    assert.deepEqual(ids(doc), [a, b, c])
    moveRow(doc, 'rows', a, 999)
    assert.deepEqual(ids(doc), [b, c, a])
  })

  it('is a no-op for an unknown id or same index', () => {
    const doc = new Y.Doc()
    const a = addRow(doc, 'rows', { name: 'a' })
    assert.equal(moveRow(doc, 'rows', 'nope', 0), false)
    assert.equal(moveRow(doc, 'rows', a, 0), false)
  })

  it('leaves the row data map untouched (move is order-only)', () => {
    const doc = new Y.Doc()
    const a = addRow(doc, 'rows', { name: 'a' })
    const b = addRow(doc, 'rows', { name: 'b' })
    const before = rawData(doc).get(a)
    moveRow(doc, 'rows', a, 1)
    assert.equal(rawData(doc).get(a), before)
    assert.deepEqual(readRow(doc, 'rows', a), { id: a, name: 'a' })
    void b
  })
})

describe('setRowField / updateRow', () => {
  it('sets a single field with LWW, normalizing undefined to null', () => {
    const doc = new Y.Doc()
    const a = addRow(doc, 'rows', { name: 'a' })
    assert.equal(setRowField(doc, 'rows', a, 'name', 'A'), true)
    assert.equal(readRow(doc, 'rows', a)!.name, 'A')
    setRowField(doc, 'rows', a, 'cleared', undefined)
    assert.equal(readRow(doc, 'rows', a)!.cleared, null)
    assert.equal(setRowField(doc, 'rows', 'nope', 'name', 'x'), false)
  })

  it('merges a patch, leaving absent keys untouched', () => {
    const doc = new Y.Doc()
    const a = addRow(doc, 'rows', { name: 'a', keep: 1 })
    assert.equal(updateRow(doc, 'rows', a, { name: 'A', added: true }), true)
    assert.deepEqual(readRow(doc, 'rows', a), { id: a, name: 'A', keep: 1, added: true })
    assert.equal(updateRow(doc, 'rows', 'nope', { x: 1 }), false)
  })
})

describe('seedRows', () => {
  it('seeds rows once, idempotently', () => {
    const doc = new Y.Doc()
    const seeded = seedRows(doc, 'rows', [{ name: 'a' }, { id: 'pk-2', name: 'b' }])
    assert.equal(seeded.length, 2)
    assert.equal(seeded[1], 'pk-2')
    assert.deepEqual(
      readRows(doc, 'rows').map((r) => r.name),
      ['a', 'b'],
    )
    // Second seed is a no-op (order array already populated).
    const again = seedRows(doc, 'rows', [{ name: 'c' }])
    assert.deepEqual(again, [])
    assert.equal(readRows(doc, 'rows').length, 2)
  })

  it('no-ops on an empty list', () => {
    assert.deepEqual(seedRows(new Y.Doc(), 'rows', []), [])
  })
})

describe('observeRows', () => {
  it('fires on add, field edit, move, and remove; unsubscribe stops it', () => {
    const doc = new Y.Doc()
    const calls: number[] = []
    const stop = observeRows(doc, 'rows', (rows) => calls.push(rows.length))

    const a = addRow(doc, 'rows', { name: 'a' })
    const b = addRow(doc, 'rows', { name: 'b' })
    setRowField(doc, 'rows', a, 'name', 'A')
    moveRow(doc, 'rows', a, 1)
    removeRow(doc, 'rows', b)
    const fired = calls.length
    assert.ok(fired >= 5, `expected ≥5 notifications, got ${fired}`)

    stop()
    addRow(doc, 'rows', { name: 'c' })
    assert.equal(calls.length, fired)
  })

  it('fires when the array is created lazily by a later add', () => {
    const doc = new Y.Doc()
    let last = -1
    const stop = observeRows(doc, 'late', (rows) => (last = rows.length))
    addRow(doc, 'late', { name: 'x' })
    assert.equal(last, 1)
    stop()
  })
})

describe('CRDT identity across reorder (the core invariant)', () => {
  it('a concurrent field edit survives a remote move (lossless reorder)', () => {
    // Two peers share one array of three rows.
    const docA = new Y.Doc()
    const a1 = addRow(docA, 'rows', { name: 'one' })
    addRow(docA, 'rows', { name: 'two' })
    addRow(docA, 'rows', { name: 'three' })

    const docB = new Y.Doc()
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA))

    // Concurrently: peer A moves row 1 to the end; peer B edits row 1's field.
    moveRow(docA, 'rows', a1, 2)
    setRowField(docB, 'rows', a1, 'name', 'ONE')

    // Exchange updates both ways.
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA))
    Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB))

    // Both converge: the moved row kept its identity, so B's edit landed on it.
    const rowsA = readRows(docA, 'rows')
    const rowsB = readRows(docB, 'rows')
    assert.deepEqual(rowsA, rowsB)
    assert.equal(rowsA[rowsA.length - 1]!.id, a1)
    assert.equal(rowsA[rowsA.length - 1]!.name, 'ONE')
  })

  it('persists alongside the fields map under distinct top-level roots', () => {
    const doc = new Y.Doc()
    doc.getMap('fields').set('title', 'hi')
    addRow(doc, 'rows', { name: 'a' })
    // Field bindings and row arrays live under separate roots — no collision.
    assert.equal(doc.getMap('fields').get('title'), 'hi')
    assert.ok(doc.getMap(ROW_ORDER_MAP).has('rows'))
    assert.ok(doc.getMap(ROW_DATA_MAP).has('rows'))
  })
})
