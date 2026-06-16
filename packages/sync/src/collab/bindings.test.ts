import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import * as Y from 'yjs'

import {
  bindingFor,
  normalizeBinding,
  observeFieldValue,
  readFieldValue,
  seedBoundFields,
  writeFieldValue,
} from './bindings.js'

describe('normalizeBinding', () => {
  it('expands a shorthand string to object form', () => {
    assert.deepEqual(normalizeBinding('text'), { type: 'text' })
  })

  it('returns an object binding unchanged', () => {
    const v = (x: unknown) => x === 'ok'
    assert.deepEqual(normalizeBinding({ type: 'scalar', validate: v }), { type: 'scalar', validate: v })
  })
})

describe('bindingFor', () => {
  it('defaults an unbound field to scalar', () => {
    assert.deepEqual(bindingFor(undefined, 'x'), { type: 'scalar' })
    assert.deepEqual(bindingFor({ title: 'text' }, 'x'), { type: 'scalar' })
  })

  it('resolves a declared binding (shorthand + object)', () => {
    assert.deepEqual(bindingFor({ title: 'text' }, 'title'), { type: 'text' })
    const b = { type: 'array' as const, validate: () => true }
    assert.equal(bindingFor({ tags: b }, 'tags'), b)
  })

  it('never resolves a prototype key as a binding (own-property only)', () => {
    assert.deepEqual(bindingFor({ title: 'text' }, 'constructor'), { type: 'scalar' })
    assert.deepEqual(bindingFor({ title: 'text' }, '__proto__'), { type: 'scalar' })
  })
})

describe('readFieldValue', () => {
  it('reads each share type, undefined when empty', () => {
    const doc = new Y.Doc()
    assert.equal(readFieldValue(doc, 'title', 'scalar'), undefined)
    assert.equal(readFieldValue(doc, 'body', 'text'), undefined)
    assert.equal(readFieldValue(doc, 'tags', 'array'), undefined)
    assert.equal(readFieldValue(doc, 'meta', 'map'), undefined)

    doc.getMap('fields').set('title', 'Hi')
    doc.getText('body').insert(0, 'hello')
    doc.getArray('tags').push(['a', 'b'])
    doc.getMap('meta').set('k', 1)

    assert.equal(readFieldValue(doc, 'title', 'scalar'), 'Hi')
    assert.equal(readFieldValue(doc, 'body', 'text'), 'hello')
    assert.deepEqual(readFieldValue(doc, 'tags', 'array'), ['a', 'b'])
    assert.deepEqual(readFieldValue(doc, 'meta', 'map'), { k: 1 })
  })

  it('reads scalars from a custom map name', () => {
    const doc = new Y.Doc()
    doc.getMap('meta').set('status', 'draft')
    assert.equal(readFieldValue(doc, 'status', 'scalar', 'meta'), 'draft')
    assert.equal(readFieldValue(doc, 'status', 'scalar', 'fields'), undefined)
  })
})

describe('writeFieldValue', () => {
  it('writes a scalar value', () => {
    const doc = new Y.Doc()
    assert.equal(writeFieldValue(doc, 'title', 'Hello', 'scalar'), true)
    assert.equal(doc.getMap('fields').get('title'), 'Hello')
  })

  it('normalizes undefined scalar to null', () => {
    const doc = new Y.Doc()
    writeFieldValue(doc, 'title', undefined, 'scalar')
    assert.equal(doc.getMap('fields').get('title'), null)
  })

  it('replaces an array value wholesale', () => {
    const doc = new Y.Doc()
    writeFieldValue(doc, 'tags', ['a', 'b'], 'array')
    assert.deepEqual(doc.getArray('tags').toJSON(), ['a', 'b'])
    writeFieldValue(doc, 'tags', ['c'], 'array')
    assert.deepEqual(doc.getArray('tags').toJSON(), ['c'])
  })

  it('replaces a map value wholesale', () => {
    const doc = new Y.Doc()
    writeFieldValue(doc, 'meta', { a: 1, b: 2 }, 'map')
    assert.deepEqual(doc.getMap('meta').toJSON(), { a: 1, b: 2 })
    writeFieldValue(doc, 'meta', { c: 3 }, 'map')
    assert.deepEqual(doc.getMap('meta').toJSON(), { c: 3 })
  })

  it('rejects (does not write) a value the validator fails, returning false', () => {
    const doc = new Y.Doc()
    const binding = { type: 'scalar' as const, validate: (v: unknown) => typeof v === 'string' && v.length <= 3 }
    assert.equal(writeFieldValue(doc, 'code', 'abc', binding), true)
    assert.equal(writeFieldValue(doc, 'code', 'toolong', binding), false)
    assert.equal(doc.getMap('fields').get('code'), 'abc')
  })

  it('tags writes with the configured origin', () => {
    const doc = new Y.Doc()
    const origins: unknown[] = []
    doc.on('afterTransaction', (tr: Y.Transaction) => origins.push(tr.origin))
    writeFieldValue(doc, 'title', 'x', 'scalar', { origin: 'my-origin' })
    assert.ok(origins.includes('my-origin'))
  })

  it('throws on a text binding (collaborative strings bind through an editor)', () => {
    const doc = new Y.Doc()
    assert.throws(() => writeFieldValue(doc, 'body', 'hi', 'text'), /text.*editor/i)
  })
})

describe('observeFieldValue', () => {
  it('fires with the new value when the bound scalar changes', () => {
    const doc = new Y.Doc()
    const seen: unknown[] = []
    const off = observeFieldValue(doc, 'title', 'scalar', (v) => seen.push(v))
    doc.getMap('fields').set('title', 'A')
    doc.getMap('fields').set('title', 'B')
    off()
    doc.getMap('fields').set('title', 'C')
    assert.deepEqual(seen, ['A', 'B'])
  })

  it('does not fire when a different scalar key in the same map changes', () => {
    const doc = new Y.Doc()
    const seen: unknown[] = []
    const off = observeFieldValue(doc, 'title', 'scalar', (v) => seen.push(v))
    doc.getMap('fields').set('body', 'unrelated')
    off()
    assert.deepEqual(seen, [])
  })

  it('fires deeply for array and map shares', () => {
    const doc = new Y.Doc()
    const arr: unknown[] = []
    const map: unknown[] = []
    const offA = observeFieldValue(doc, 'tags', 'array', (v) => arr.push(v))
    const offM = observeFieldValue(doc, 'meta', 'map', (v) => map.push(v))
    doc.getArray('tags').push(['x'])
    doc.getMap('meta').set('k', 1)
    offA()
    offM()
    assert.deepEqual(arr, [['x']])
    assert.deepEqual(map, [{ k: 1 }])
  })
})

describe('seedBoundFields', () => {
  it('routes each field into the share its binding names', () => {
    const doc = new Y.Doc()
    seedBoundFields(
      doc,
      { title: 'Doc title', body: 'Hello world', tags: ['a', 'b'], meta: { k: 1 }, status: 'draft' },
      { bindings: { title: 'text', body: 'text', tags: 'array', meta: 'map' } },
    )
    assert.equal(doc.getText('title').toString(), 'Doc title')
    assert.equal(doc.getText('body').toString(), 'Hello world')
    assert.deepEqual(doc.getArray('tags').toJSON(), ['a', 'b'])
    assert.deepEqual(doc.getMap('meta').toJSON(), { k: 1 })
    // Unbound field falls back to a scalar entry in the shared map.
    assert.equal(doc.getMap('fields').get('status'), 'draft')
  })

  it('seeds scalars as a group, gated on the shared map being empty', () => {
    const doc = new Y.Doc()
    doc.getMap('fields').set('title', 'Existing')
    seedBoundFields(doc, { title: 'New', body: 'New body' }, {})
    // Whole-map gate: the populated map is left entirely untouched.
    assert.equal(doc.getMap('fields').get('title'), 'Existing')
    assert.equal(doc.getMap('fields').has('body'), false)
  })

  it('gates non-scalar shares independently of the scalar map', () => {
    const doc = new Y.Doc()
    doc.getMap('fields').set('status', 'published') // scalar map already populated
    seedBoundFields(
      doc,
      { status: 'draft', body: 'fresh' },
      { bindings: { body: 'text' } },
    )
    assert.equal(doc.getMap('fields').get('status'), 'published') // scalar gate held
    assert.equal(doc.getText('body').toString(), 'fresh') // empty text share seeded
  })

  it('does not re-seed an already-populated text/array/map share', () => {
    const doc = new Y.Doc()
    doc.getText('body').insert(0, 'original')
    seedBoundFields(doc, { body: 'replacement' }, { bindings: { body: 'text' } })
    assert.equal(doc.getText('body').toString(), 'original')
  })

  it('skips a field whose seed value the validator rejects', () => {
    const doc = new Y.Doc()
    seedBoundFields(
      doc,
      { status: 'bogus', ok: 'fine' },
      { bindings: { status: { type: 'scalar', validate: (v) => v === 'draft' || v === 'published' } } },
    )
    assert.equal(doc.getMap('fields').has('status'), false)
    assert.equal(doc.getMap('fields').get('ok'), 'fine')
  })

  it('tags the seed transaction with the configured origin', () => {
    const doc = new Y.Doc()
    const origins: unknown[] = []
    doc.on('afterTransaction', (tr: Y.Transaction) => origins.push(tr.origin))
    seedBoundFields(doc, { title: 'x' }, { origin: 'seed-origin' })
    assert.ok(origins.includes('seed-origin'))
  })

  it('does nothing for empty data', () => {
    const doc = new Y.Doc()
    let fired = false
    doc.on('afterTransaction', () => { fired = true })
    seedBoundFields(doc, {}, {})
    assert.equal(fired, false)
    assert.equal(doc.getMap('fields').size, 0)
  })
})
