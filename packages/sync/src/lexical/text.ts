/**
 * Lexical text operations on the root `Y.XmlText` tree.
 *
 * `editText` / `editTextBatch` — surgical search/replace edits.
 * `rewriteText` — full-text replacement preserving paragraph structure.
 * `readText` — concatenate all text runs as plain text, with inline
 * `[BLOCK: <type> | <fields>]` markers for DecoratorNodes.
 */

import * as Y from 'yjs'
import { findTextInXmlTree, SERVER_ORIGIN } from './internal.js'
import { setAiAwareness } from './awareness.js'
import type { InnerDeltaItem, LexicalAiCursor, LexicalTextOperation } from './types.js'

/**
 * Read the plain text content of a Lexical Y.Doc.
 * Walks the root Y.XmlText tree and concatenates all text runs.
 *
 * Returns empty string if the doc has no content. Embedded blocks are
 * surfaced as inline `[BLOCK: <type> | <fields>]` markers so an LLM
 * sees them in context.
 */
export function readText(doc: Y.Doc): string {
  const root = doc.get('root', Y.XmlText)
  if (root.length === 0) return ''

  const parts: string[]   = []
  const rootDelta         = root.toDelta() as InnerDeltaItem[]

  for (const entry of rootDelta) {
    if (!(entry.insert instanceof Y.XmlText)) continue
    const child       = entry.insert
    const innerDelta  = child.toDelta() as InnerDeltaItem[]
    const lineParts: string[] = []

    for (const item of innerDelta) {
      if (typeof item.insert === 'string') {
        lineParts.push(item.insert)
      } else if (item.insert instanceof Y.XmlElement) {
        // Block (DecoratorNode) — include as inline marker so AI can see it
        const elem      = item.insert
        const blockType = elem.getAttribute('__blockType')
        if (blockType) {
          const blockData = elem.getAttribute('__blockData')
          const fields = blockData && typeof blockData === 'object'
            ? Object.entries(blockData as Record<string, unknown>)
                .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
                .join(', ')
            : ''
          lineParts.push(`[BLOCK: ${blockType}${fields ? ` | ${fields}` : ''}]`)
        }
      }
    }

    if (lineParts.length > 0) parts.push(lineParts.join(''))
  }

  return parts.join('\n')
}

/**
 * Surgically edit text in a Lexical Y.Doc.
 *
 * Walks the root Y.XmlText → child Y.XmlText (paragraphs, headings, etc.)
 * → finds the search string → applies delete/insert at the character level.
 *
 * Changes broadcast to all connected WebSocket clients via SERVER_ORIGIN.
 * The Lexical-Yjs binding observes the Y.Doc changes and updates editors automatically.
 *
 * @returns true if the edit was applied, false if search text not found.
 *
 * @example
 * editText(doc, { type: 'replace', search: 'hello', replace: 'world' })
 */
export function editText(
  doc:       Y.Doc,
  operation: LexicalTextOperation,
  /** Optional AI identity — when provided, sets a visible cursor at the edit location. */
  aiCursor?: LexicalAiCursor,
): boolean {
  const root = doc.get('root', Y.XmlText)

  const match = findTextInXmlTree(root, operation.search)
  if (!match) return false

  // Set AI selection highlighting the text being edited
  if (aiCursor) {
    setAiAwareness(doc, aiCursor, {
      ...match,
      length: operation.search.length,
    })
  }

  doc.transact(() => {
    const { target, offset } = match
    switch (operation.type) {
      case 'replace':
        target.delete(offset, operation.search.length)
        target.insert(offset, operation.replace)
        break
      case 'insert_after':
        target.insert(offset + operation.search.length, operation.text)
        break
      case 'delete':
        target.delete(offset, operation.search.length)
        break
    }
  }, SERVER_ORIGIN)

  return true
}

/**
 * Replace the entire text content of a Lexical Y.Doc.
 * Reads existing paragraphs, replaces their text, removes extras or adds new ones.
 *
 * @example
 * rewriteText(doc, 'New paragraph one.\n\nSecond paragraph.')
 */
export function rewriteText(
  doc:       Y.Doc,
  newText:   string,
  aiCursor?: LexicalAiCursor,
): boolean {
  const root = doc.get('root', Y.XmlText)

  const newParagraphs = newText.split('\n').filter(p => p.trim())

  doc.transact(() => {
    // Collect existing paragraph nodes + their root-relative offsets in a
    // single pass — pairs `{ node, offset }` so the truncation loop below
    // doesn't need a parallel offsets array (and the index-bounded reads
    // that come with it).
    const rootDelta = root.toDelta() as InnerDeltaItem[]
    const existing: Array<{ node: Y.XmlText; offset: number }> = []
    {
      let walked = 0
      for (const entry of rootDelta) {
        if (entry.insert instanceof Y.XmlText) {
          existing.push({ node: entry.insert, offset: walked })
        }
        walked += 1
      }
    }

    // Helper: replace ONLY the text content of a paragraph node,
    // preserving Y.Map metadata entries (Lexical TextNode attrs).
    function replaceNodeText(node: Y.XmlText, newContent: string) {
      const delta = node.toDelta() as InnerDeltaItem[]
      // Find all text runs and their offsets (skip Y.Map/Y.XmlElement entries)
      let offset    = 0
      let textStart = -1
      let textLen   = 0
      for (const item of delta) {
        if (typeof item.insert === 'string') {
          if (textStart === -1) textStart = offset
          textLen += item.insert.length
          offset  += item.insert.length
        } else {
          // Y.Map (TextNode metadata) or Y.XmlElement (block) — skip, count as 1
          offset += 1
        }
      }
      if (textStart >= 0 && textLen > 0) {
        node.delete(textStart, textLen)
        node.insert(textStart, newContent)
      } else {
        // No existing text — insert at position 0 (after any Y.Map metadata)
        let insertAt = 0
        for (const item of delta) {
          if (typeof item.insert !== 'string') insertAt += 1
          else break
        }
        node.insert(insertAt, newContent)
      }
    }

    // Rewrite existing paragraphs with new text
    const reusableCount = Math.min(existing.length, newParagraphs.length)
    for (let i = 0; i < reusableCount; i++) {
      const item = existing[i]
      const text = newParagraphs[i]
      if (item && text !== undefined) replaceNodeText(item.node, text)
    }

    // Remove extra old paragraphs (from the end to avoid offset shifts).
    // Reverse-iterate the tail slice so we delete the highest offsets first.
    for (const { offset } of existing.slice(newParagraphs.length).reverse()) {
      root.delete(offset, 1)
    }

    // Add new paragraphs if we have more than existed
    for (const text of newParagraphs.slice(existing.length)) {
      const pNode = new Y.XmlText()
      pNode.setAttribute('__type', 'paragraph')
      pNode.insert(0, text)
      root.insertEmbed(root.length, pNode)
    }
  }, SERVER_ORIGIN)

  // Set AI awareness AFTER the rewrite — highlight the new first paragraph text
  if (aiCursor) {
    const postDelta = root.toDelta() as InnerDeltaItem[]
    for (const entry of postDelta) {
      if (entry.insert instanceof Y.XmlText) {
        const node       = entry.insert
        const innerDelta = node.toDelta() as InnerDeltaItem[]
        let textLen = 0
        for (const item of innerDelta) {
          if (typeof item.insert === 'string') textLen += item.insert.length
        }
        if (textLen > 0) {
          setAiAwareness(doc, aiCursor, { target: node, offset: 0, length: textLen })
          break
        }
      }
    }
  }

  return true
}

/**
 * Apply multiple text edit operations in a single Yjs transaction.
 *
 * @returns number of successfully applied operations.
 */
export function editTextBatch(
  doc:        Y.Doc,
  operations: LexicalTextOperation[],
): number {
  const root = doc.get('root', Y.XmlText)
  let applied = 0

  doc.transact(() => {
    for (const op of operations) {
      const match = findTextInXmlTree(root, op.search)
      if (!match) continue
      const { target, offset } = match
      switch (op.type) {
        case 'replace':
          target.delete(offset, op.search.length)
          target.insert(offset, op.replace)
          break
        case 'insert_after':
          target.insert(offset + op.search.length, op.text)
          break
        case 'delete':
          target.delete(offset, op.search.length)
          break
      }
      applied++
    }
  }, SERVER_ORIGIN)

  return applied
}
