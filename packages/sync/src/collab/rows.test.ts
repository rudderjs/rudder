import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import * as Y from 'yjs'

import {
  ROW_DATA_MAP,
  ROW_ORDER_MAP,
  addRow,
  ensureRowArray,
  moveRow,
  newRowId,
  observeRowChanges,
  observeRows,
  readRow,
  readRows,
  removeRow,
  renameRow,
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

describe('ensureRowArray', () => {
  it('pre-allocates both shares without adding any rows', () => {
    const doc = new Y.Doc()
    ensureRowArray(doc, 'items')
    assert.ok(doc.getMap(ROW_ORDER_MAP).has('items'), 'order share created')
    assert.ok(doc.getMap(ROW_DATA_MAP).has('items'), 'data share created')
    assert.deepEqual(readRows(doc, 'items'), [])
  })

  it('is idempotent — calling twice leaves the array empty', () => {
    const doc = new Y.Doc()
    ensureRowArray(doc, 'items')
    ensureRowArray(doc, 'items')
    assert.deepEqual(readRows(doc, 'items'), [])
  })

  it('does not interfere with a subsequent addRow', () => {
    const doc = new Y.Doc()
    ensureRowArray(doc, 'items')
    const id = addRow(doc, 'items', { name: 'x' })
    assert.deepEqual(ids(doc, 'items'), [id])
  })
})

describe('renameRow', () => {
  it('moves the row to a new id at the same position, clearing the old key', () => {
    const doc = new Y.Doc()
    const a = addRow(doc, 'rows', { name: 'a' })
    const b = addRow(doc, 'rows', { name: 'b' })
    assert.equal(renameRow(doc, 'rows', a, 'pk-a'), true)
    assert.deepEqual(ids(doc), ['pk-a', b])
    assert.deepEqual(readRow(doc, 'rows', 'pk-a'), { id: 'pk-a', name: 'a' })
    assert.equal(readRow(doc, 'rows', a), undefined)
    assert.equal(rawData(doc).has(a), false)
  })

  it('no-ops on oldId === newId', () => {
    const doc = new Y.Doc()
    const a = addRow(doc, 'rows', { name: 'a' })
    assert.equal(renameRow(doc, 'rows', a, a), false)
    assert.deepEqual(ids(doc), [a])
  })

  it('no-ops when oldId is unknown', () => {
    const doc = new Y.Doc()
    const a = addRow(doc, 'rows', { name: 'a' })
    assert.equal(renameRow(doc, 'rows', 'nope', 'pk-nope'), false)
    assert.deepEqual(ids(doc), [a])
  })

  it('no-ops (fail-safe) when newId already exists', () => {
    const doc = new Y.Doc()
    const a = addRow(doc, 'rows', { name: 'a' })
    const b = addRow(doc, 'rows', { name: 'b' })
    assert.equal(renameRow(doc, 'rows', a, b), false)
    assert.deepEqual(ids(doc), [a, b])
  })

  it('preserves all field values in the cloned row map', () => {
    const doc = new Y.Doc()
    const a = addRow(doc, 'rows', { x: 1, y: 'two', z: null })
    renameRow(doc, 'rows', a, 'pk-1')
    assert.deepEqual(readRow(doc, 'rows', 'pk-1'), { id: 'pk-1', x: 1, y: 'two', z: null })
  })
})

describe('readRows / readRow with idKey', () => {
  it('projects the stable id under a custom key', () => {
    const doc = new Y.Doc()
    const a = addRow(doc, 'rows', { name: 'a' })
    const rows = readRows<{ name: string }, '__id'>(doc, 'rows', { idKey: '__id' })
    assert.equal(rows[0]!['__id'], a)
    assert.equal(rows[0]!.name, 'a')
    // default key not present
    assert.equal(Object.prototype.hasOwnProperty.call(rows[0], 'id'), false)
  })

  it('readRow with idKey stamps the custom key', () => {
    const doc = new Y.Doc()
    const a = addRow(doc, 'rows', { name: 'a' })
    const row = readRow<{ name: string }, '__id'>(doc, 'rows', a, { idKey: '__id' })
    assert.equal(row!['__id'], a)
  })
})

describe('addRow / seedRows mirrorId', () => {
  it('addRow with mirrorId:true stores the id inside the row map', () => {
    const doc = new Y.Doc()
    const id = addRow(doc, 'rows', { name: 'a' }, { mirrorId: true })
    const raw = rawData(doc).get(id)
    assert.equal(raw!.get('id'), id)
    // readRows also sees it in the values
    assert.equal(readRows(doc, 'rows')[0]!.id, id)
  })

  it('addRow with mirrorId + custom idKey stores under that key', () => {
    const doc = new Y.Doc()
    const id = addRow(doc, 'rows', { name: 'a' }, { mirrorId: true, idKey: '__id' })
    const raw = rawData(doc).get(id)
    assert.equal(raw!.get('__id'), id)
    assert.equal(raw!.has('id'), false)
  })

  it('seedRows with mirrorId:true stores each id in its row map', () => {
    const doc = new Y.Doc()
    const seeded = seedRows(doc, 'rows', [{ id: 'r1', name: 'a' }, { name: 'b' }], { mirrorId: true })
    assert.equal(rawData(doc).get('r1')!.get('id'), 'r1')
    assert.equal(rawData(doc).get(seeded[1]!)!.get('id'), seeded[1])
  })
})

describe('observeRowChanges', () => {
  it('emits add with index and values on addRow', () => {
    const doc = new Y.Doc()
    const events: unknown[] = []
    const stop = observeRowChanges<{ name: string }>(doc, 'rows', (e) => events.push(e))
    const id = addRow(doc, 'rows', { name: 'hello' })
    stop()
    assert.deepEqual(events, [{ kind: 'add', rowId: id, index: 0, values: { name: 'hello' } }])
  })

  it('emits remove with index on removeRow', () => {
    const doc = new Y.Doc()
    const a = addRow(doc, 'rows', { name: 'a' })
    const b = addRow(doc, 'rows', { name: 'b' })
    const events: unknown[] = []
    const stop = observeRowChanges(doc, 'rows', (e) => events.push(e))
    removeRow(doc, 'rows', a)
    stop()
    assert.deepEqual(events, [{ kind: 'remove', rowId: a, index: 0 }])
    void b
  })

  it('coalesces a delete+insert of the same id into a move', () => {
    const doc = new Y.Doc()
    const a = addRow(doc, 'rows', { name: 'a' })
    addRow(doc, 'rows', { name: 'b' })
    addRow(doc, 'rows', { name: 'c' })
    const events: unknown[] = []
    const stop = observeRowChanges(doc, 'rows', (e) => events.push(e))
    moveRow(doc, 'rows', a, 2)
    stop()
    assert.deepEqual(events, [{ kind: 'move', rowId: a, from: 0, to: 2 }])
  })

  it('emits remove (not move) when the data map is also gone', () => {
    const doc = new Y.Doc()
    const a = addRow(doc, 'rows', { name: 'a' })
    addRow(doc, 'rows', { name: 'b' })
    const events: unknown[] = []
    const stop = observeRowChanges(doc, 'rows', (e) => events.push(e))
    removeRow(doc, 'rows', a)
    stop()
    assert.equal((events[0] as { kind: string }).kind, 'remove')
  })

  it('emits add for the lazily-created array (no prior subscription)', () => {
    const doc = new Y.Doc()
    let last: unknown
    const stop = observeRowChanges<{ x: number }>(doc, 'late', (e) => { last = e })
    addRow(doc, 'late', { x: 42 })
    assert.ok(last && (last as { kind: string }).kind === 'add', 'add event emitted')
    assert.equal((last as { values: { x: number } }).values.x, 42)
    stop()
  })

  it('unsubscribe stops further events', () => {
    const doc = new Y.Doc()
    const events: unknown[] = []
    const stop = observeRowChanges(doc, 'rows', (e) => events.push(e))
    addRow(doc, 'rows', { name: 'a' })
    const count = events.length
    stop()
    addRow(doc, 'rows', { name: 'b' })
    assert.equal(events.length, count)
  })

  it('does not fire on field edits (field changes are not row lifecycle events)', () => {
    const doc = new Y.Doc()
    const a = addRow(doc, 'rows', { name: 'a' })
    const events: unknown[] = []
    const stop = observeRowChanges(doc, 'rows', (e) => events.push(e))
    setRowField(doc, 'rows', a, 'name', 'A')
    stop()
    assert.deepEqual(events, [])
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
