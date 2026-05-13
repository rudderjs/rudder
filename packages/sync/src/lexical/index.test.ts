import { describe, it, beforeEach } from 'node:test'
import assert                       from 'node:assert/strict'
import * as Y                       from 'yjs'
import { MemoryPersistence, Sync }  from '../index.js'
import { insertBlock, removeBlock } from './index.js'
import type { InnerDeltaItem }      from './types.js'

// ─── insertBlock / removeBlock ───────────────────────────────
//
// These exercise the Lexical adapter's standalone functions. They reach
// into the same globalThis-backed room map the WS layer uses so the doc
// they edit is the same one `Sync.snapshot()` would observe — no need to
// spin up a WebSocket server. The doc shape mimics what the Lexical-Yjs
// binding produces (paragraph Y.XmlText nodes hanging off a root Y.XmlText)
// so the helpers see something realistic.

const G           = globalThis as Record<string, unknown>
const PERSIST_KEY = '__rudderjs_live_persistence__'
const ROOMS_KEY   = '__rudderjs_live__'

/** Read the rooms map directly out of the globalThis slot the sync runtime
 *  populates. Centralizes the structural cast so individual tests don't
 *  repeat it. Asserts non-empty since every caller has already seeded a room. */
function rooms(): Map<string, { doc: Y.Doc }> {
  return G[ROOMS_KEY] as Map<string, { doc: Y.Doc }>
}

function freshSyncState(): MemoryPersistence {
  const persistence = new MemoryPersistence()
  G[PERSIST_KEY] = persistence
  G[ROOMS_KEY]   = new Map()
  return persistence
}

/** Build a paragraph Y.XmlText with optional embedded blocks + trailing text.
 *  Mirrors the shape produced by Lexical-Yjs's CollabDecoratorNode:
 *  bare `Y.XmlElement()` (no nodeName) with `__type="custom-block"` attribute. */
function buildParagraph(opts: {
  blocks?: Array<{ type: string; data: Record<string, unknown> }>
  text?:   string
}): Y.XmlText {
  const p = new Y.XmlText()
  p.setAttribute('__type', 'paragraph')
  let offset = 0
  for (const b of opts.blocks ?? []) {
    const elem = new Y.XmlElement()
    elem.setAttribute('__type', 'custom-block')
    elem.setAttribute('__blockType', b.type)
    ;(elem.setAttribute as (k: string, v: unknown) => void)('__blockData', b.data)
    p.insertEmbed(offset, elem)
    offset += 1
  }
  if (opts.text) {
    p.insert(offset, opts.text)
  }
  return p
}

/** Seed a Lexical-style root with the provided paragraph nodes. */
function seedLexicalRoot(docName: string, paragraphs: Y.XmlText[]): void {
  // Touch Sync so the room is created via the same getOrCreateRoom path.
  Sync.snapshot(docName)
  const room  = rooms().get(docName)!
  const root  = room.doc.get('root', Y.XmlText)
  room.doc.transact(() => {
    for (const p of paragraphs) root.insertEmbed(root.length, p)
  })
}

/** Walk the root and return blocks in document order with their paragraph index. */
function listBlocks(docName: string): Array<{ pIdx: number; type: string; data: Record<string, unknown> }> {
  const root  = rooms().get(docName)!.doc.get('root', Y.XmlText)
  const out: Array<{ pIdx: number; type: string; data: Record<string, unknown> }> = []
  const delta = root.toDelta() as InnerDeltaItem[]
  let pIdx = 0
  for (const entry of delta) {
    if (!(entry.insert instanceof Y.XmlText)) continue
    const child = entry.insert
    const inner = child.toDelta() as InnerDeltaItem[]
    for (const item of inner) {
      if (!(item.insert instanceof Y.XmlElement)) continue
      const elem = item.insert
      out.push({
        pIdx,
        type: String(elem.getAttribute('__blockType')),
        data: elem.getAttribute('__blockData') as Record<string, unknown>,
      })
    }
    pIdx++
  }
  return out
}

function paragraphCount(docName: string): number {
  const root  = rooms().get(docName)!.doc.get('root', Y.XmlText)
  const delta = root.toDelta() as InnerDeltaItem[]
  let n = 0
  for (const entry of delta) if (entry.insert instanceof Y.XmlText) n++
  return n
}

describe('insertBlock', () => {
  beforeEach(() => freshSyncState())

  it('returns false when the root XmlText is uninitialized', () => {
    const doc = Sync.document('uninit-doc')
    const ok  = insertBlock(doc, 'callToAction', { title: 'Hi' })
    assert.strictEqual(ok, false)
  })

  it('appends a block at the end when no position is given', () => {
    seedLexicalRoot('doc-1', [
      buildParagraph({ text: 'first paragraph' }),
      buildParagraph({ text: 'second paragraph' }),
    ])
    const ok = insertBlock(Sync.document('doc-1'), 'callToAction', { title: 'Subscribe' })
    assert.strictEqual(ok, true)
    assert.strictEqual(paragraphCount('doc-1'), 3)
    const blocks = listBlocks('doc-1')
    assert.strictEqual(blocks.length, 1)
    assert.strictEqual(blocks[0]?.pIdx, 2, 'inserted as the 3rd paragraph')
    assert.strictEqual(blocks[0]?.type, 'callToAction')
    assert.deepStrictEqual(blocks[0]?.data, { title: 'Subscribe' })
  })

  it('inserts at index 0 when position=0', () => {
    seedLexicalRoot('doc-2', [
      buildParagraph({ text: 'existing' }),
    ])
    insertBlock(Sync.document('doc-2'), 'video', { url: 'https://example.com/v1' }, 0)
    const blocks = listBlocks('doc-2')
    assert.strictEqual(blocks.length, 1)
    assert.strictEqual(blocks[0]?.pIdx, 0, 'inserted as the 1st paragraph')
    assert.strictEqual(paragraphCount('doc-2'), 2)
  })

  it('inserts before the last paragraph when position=-1', () => {
    seedLexicalRoot('doc-3', [
      buildParagraph({ text: 'first' }),
      buildParagraph({ text: 'last' }),
    ])
    insertBlock(Sync.document('doc-3'), 'video', { url: 'mid' }, -1)
    const blocks = listBlocks('doc-3')
    assert.strictEqual(blocks[0]?.pIdx, 1, 'inserted between first and last')
    assert.strictEqual(paragraphCount('doc-3'), 3)
  })

  it('clamps positions beyond the end to append', () => {
    seedLexicalRoot('doc-4', [buildParagraph({ text: 'only' })])
    insertBlock(Sync.document('doc-4'), 'video', { url: 'tail' }, 99)
    const blocks = listBlocks('doc-4')
    assert.strictEqual(blocks[0]?.pIdx, 1)
  })

  it('accepts an empty blockData object', () => {
    seedLexicalRoot('doc-5', [buildParagraph({ text: 'x' })])
    const ok = insertBlock(Sync.document('doc-5'), 'spacer', {})
    assert.strictEqual(ok, true)
    const blocks = listBlocks('doc-5')
    assert.deepStrictEqual(blocks[0]?.data, {})
  })

  it('produces a Lexical-compatible block shape (no nodeName, __type attr)', () => {
    // Regression: Lexical-Yjs's CollabDecoratorNode creates `new XmlElement()`
    // with NO nodeName and writes `__type="custom-block"` as an attribute.
    // If we get this wrong, blocks insert into the Y.Doc but the editor never
    // renders them. See LexicalYjs.dev.mjs:925.
    seedLexicalRoot('shape-doc', [buildParagraph({ text: 'x' })])
    insertBlock(Sync.document('shape-doc'), 'callToAction', { title: 'Hi', buttonText: 'Click' })

    const root  = rooms().get('shape-doc')!.doc.get('root', Y.XmlText)
    const delta = root.toDelta() as InnerDeltaItem[]

    let found: Y.XmlElement | null = null
    for (const entry of delta) {
      if (!(entry.insert instanceof Y.XmlText)) continue
      const inner = entry.insert.toDelta() as InnerDeltaItem[]
      for (const item of inner) {
        if (item.insert instanceof Y.XmlElement) { found = item.insert; break }
      }
      if (found) break
    }

    assert.ok(found, 'inserted block must exist as a Y.XmlElement')
    assert.strictEqual(found!.getAttribute('__type'), 'custom-block', '__type attribute must be "custom-block"')
    assert.strictEqual(found!.getAttribute('__blockType'), 'callToAction')
    assert.deepStrictEqual(found!.getAttribute('__blockData'), { title: 'Hi', buttonText: 'Click' })
  })

  it('preserves existing blocks when inserting more', () => {
    seedLexicalRoot('doc-6', [
      buildParagraph({ blocks: [{ type: 'callToAction', data: { title: 'A' } }] }),
      buildParagraph({ text: 'between' }),
    ])
    insertBlock(Sync.document('doc-6'), 'callToAction', { title: 'B' })
    const blocks = listBlocks('doc-6')
    assert.strictEqual(blocks.length, 2)
    assert.deepStrictEqual(blocks[0]?.data, { title: 'A' })
    assert.deepStrictEqual(blocks[1]?.data, { title: 'B' })
  })
})

describe('removeBlock', () => {
  beforeEach(() => freshSyncState())

  it('returns false when the root XmlText is uninitialized', () => {
    assert.strictEqual(removeBlock(Sync.document('nope'), 'callToAction', 0), false)
  })

  it('returns false when the block type does not exist', () => {
    seedLexicalRoot('rm-1', [buildParagraph({ text: 'x' })])
    assert.strictEqual(removeBlock(Sync.document('rm-1'), 'callToAction', 0), false)
  })

  it('returns false when blockIndex is out of range', () => {
    seedLexicalRoot('rm-2', [
      buildParagraph({ blocks: [{ type: 'callToAction', data: { title: 'only' } }] }),
    ])
    assert.strictEqual(removeBlock(Sync.document('rm-2'), 'callToAction', 5), false)
  })

  it('removes the first block of a type and shifts the index', () => {
    seedLexicalRoot('rm-3', [
      buildParagraph({ blocks: [{ type: 'callToAction', data: { title: 'A' } }] }),
      buildParagraph({ text: 'middle' }),
      buildParagraph({ blocks: [{ type: 'callToAction', data: { title: 'B' } }] }),
      buildParagraph({ blocks: [{ type: 'callToAction', data: { title: 'C' } }] }),
    ])
    assert.strictEqual(removeBlock(Sync.document('rm-3'), 'callToAction', 0), true)
    let blocks = listBlocks('rm-3')
    assert.deepStrictEqual(blocks.map(b => b.data['title']), ['B', 'C'])

    // Removing index 0 again should now remove what was originally 'B'
    assert.strictEqual(removeBlock(Sync.document('rm-3'), 'callToAction', 0), true)
    blocks = listBlocks('rm-3')
    assert.deepStrictEqual(blocks.map(b => b.data['title']), ['C'])
  })

  it('removes the last block of a type', () => {
    seedLexicalRoot('rm-4', [
      buildParagraph({ blocks: [{ type: 'video', data: { url: 'one' } }] }),
      buildParagraph({ blocks: [{ type: 'video', data: { url: 'two' } }] }),
    ])
    assert.strictEqual(removeBlock(Sync.document('rm-4'), 'video', 1), true)
    const blocks = listBlocks('rm-4')
    assert.deepStrictEqual(blocks.map(b => b.data['url']), ['one'])
  })

  it('round-trips: insert then remove yields original structure', () => {
    seedLexicalRoot('rm-5', [buildParagraph({ text: 'baseline' })])
    const before = paragraphCount('rm-5')
    insertBlock(Sync.document('rm-5'), 'callToAction', { title: 'tmp' })
    assert.strictEqual(paragraphCount('rm-5'), before + 1)
    removeBlock(Sync.document('rm-5'), 'callToAction', 0)
    assert.strictEqual(paragraphCount('rm-5'), before)
    assert.strictEqual(listBlocks('rm-5').length, 0)
  })
})

describe('Sync.document() accessor', () => {
  beforeEach(() => freshSyncState())

  it('returns the same Y.Doc instance for the same docName', () => {
    const a = Sync.document('shared')
    const b = Sync.document('shared')
    assert.strictEqual(a, b)
    assert.ok(a instanceof Y.Doc)
  })

  it('returns independent docs for different docNames', () => {
    const a = Sync.document('doc-x')
    const b = Sync.document('doc-y')
    assert.notStrictEqual(a, b)
  })

  it('throws when no persistence has been registered', () => {
    delete G[PERSIST_KEY]
    assert.throws(() => Sync.document('orphan'), /Not initialised/)
    G[PERSIST_KEY] = new MemoryPersistence()
  })
})
