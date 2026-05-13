/**
 * Lexical block (DecoratorNode) operations.
 *
 * Blocks are `Y.XmlElement` nodes with `__type="custom-block"` embedded
 * inside paragraph `Y.XmlText` children of the root. The Lexical-Yjs
 * binding (`CollabDecoratorNode.syncPropertiesFromYjs`) watches for
 * attribute changes on these elements and updates `BlockNode.__blockData`,
 * triggering a re-render in the editor.
 */

import * as Y from 'yjs'
import { findBlockInXmlTree, findBlockWithParentInXmlTree, SERVER_ORIGIN } from './internal.js'
import type { InnerDeltaItem } from './types.js'

/**
 * Update a block's data field in a Lexical Y.Doc.
 *
 * @returns true if the block was found and updated.
 *
 * @example
 * editBlock(doc, 'callToAction', 0, 'buttonText', 'Learn More')
 */
export function editBlock(
  doc:        Y.Doc,
  blockType:  string,
  blockIndex: number,
  field:      string,
  value:      unknown,
): boolean {
  const root = doc.get('root', Y.XmlText)

  const elem = findBlockInXmlTree(root, blockType, blockIndex)
  if (!elem) return false

  doc.transact(() => {
    // __blockData is stored as a raw object by the Lexical-Yjs binding
    // (via CollabDecoratorNode.syncPropertiesFromLexical → setAttribute).
    // Yjs's setAttribute is typed `(k, v: string) => void` but the binding
    // passes raw objects through at runtime, so we widen the value param.
    const existing = elem.getAttribute('__blockData')
    const data: Record<string, unknown> = existing && typeof existing === 'object'
      ? { ...(existing as Record<string, unknown>) }
      : {}
    data[field] = value
    ;(elem.setAttribute as (k: string, v: unknown) => void)('__blockData', data)
  }, SERVER_ORIGIN)

  return true
}

/**
 * Insert a new block into a Lexical Y.Doc.
 *
 * Wraps the block in a fresh paragraph `Y.XmlText` and inserts it into the
 * root. With no `position`, appends at the end. With a 0-based `position`,
 * inserts before the paragraph currently at that index. Negative `position`
 * counts from the end (`-1` = before the last paragraph).
 *
 * The block's `__blockData` is stored as a raw JS object — the Lexical-Yjs
 * binding handles serialization itself.
 *
 * Returns false (no-op) if the root XmlText is uninitialized.
 *
 * @example
 * insertBlock(doc, 'callToAction', { title: 'Subscribe', buttonText: 'Join now' })
 */
export function insertBlock(
  doc:       Y.Doc,
  blockType: string,
  blockData: Record<string, unknown>,
  position?: number,
): boolean {
  const root = doc.get('root', Y.XmlText)
  if (root.length === 0) return false

  doc.transact(() => {
    // Build a fresh paragraph node containing only the block.
    // The Lexical-Yjs binding (`@lexical/yjs`) creates DecoratorNodes via
    // `new XmlElement()` (NO nodeName arg — Yjs defaults to 'UNDEFINED'),
    // and writes the Lexical node type as a `__type` attribute, not as the
    // XML nodeName. We must mirror that exactly or `CollabDecoratorNode`
    // will not pick up the element. See `LexicalYjs.dev.mjs:925`.
    const paragraph = new Y.XmlText()
    paragraph.setAttribute('__type', 'paragraph')

    const customBlock = new Y.XmlElement()
    customBlock.setAttribute('__type', 'custom-block')
    customBlock.setAttribute('__blockType', blockType)
    // __blockData is a raw object; widen the value param to bypass Yjs's
    // string-typed setAttribute signature (see editBlock for context).
    ;(customBlock.setAttribute as (k: string, v: unknown) => void)('__blockData', blockData)

    paragraph.insertEmbed(0, customBlock)

    // Compute paragraph offsets in root for positional insertion.
    const rootDelta = root.toDelta() as InnerDeltaItem[]
    const paragraphOffsets: number[] = []
    let offset = 0
    for (const entry of rootDelta) {
      if (entry.insert instanceof Y.XmlText) paragraphOffsets.push(offset)
      offset += 1
    }
    const totalLen        = offset
    const paragraphCount  = paragraphOffsets.length

    let insertOffset: number
    if (position === undefined) {
      insertOffset = totalLen
    } else {
      let pIdx = position < 0 ? paragraphCount + position : position
      if (pIdx < 0) pIdx = 0
      // Fall back to totalLen for OOB pIdx — paragraphOffsets[pIdx] is
      // `number | undefined` under noUncheckedIndexedAccess even though
      // the explicit `>= paragraphCount` check above also covers it.
      insertOffset = paragraphOffsets[pIdx] ?? totalLen
    }

    root.insertEmbed(insertOffset, paragraph)
  }, SERVER_ORIGIN)

  return true
}

/**
 * Remove a block from a Lexical Y.Doc.
 *
 * Identifies the block via `blockType` + 0-based `blockIndex` across all
 * blocks of that type. The parent paragraph `Y.XmlText` is removed in its
 * entirety — any text or other blocks sharing that paragraph are destroyed
 * with it. Blocks are expected to live in their own paragraphs.
 *
 * Returns true if the block was found and removed.
 *
 * @example
 * removeBlock(doc, 'callToAction', 0)
 */
export function removeBlock(
  doc:        Y.Doc,
  blockType:  string,
  blockIndex: number,
): boolean {
  const root = doc.get('root', Y.XmlText)
  if (root.length === 0) return false

  const found = findBlockWithParentInXmlTree(root, blockType, blockIndex)
  if (!found) return false

  doc.transact(() => {
    root.delete(found.parentRootOffset, 1)
  }, SERVER_ORIGIN)

  return true
}
