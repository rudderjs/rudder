/**
 * `@rudderjs/sync/lexical` — Lexical editor adapter for the Rudder
 * sync engine.
 *
 * Lexical's `@lexical/yjs` binding represents the editor state as a
 * `Y.XmlText` tree (paragraph `Y.XmlText` children of a root `Y.XmlText`,
 * with embedded `Y.XmlElement` DecoratorNodes). The functions here operate
 * directly on that tree shape — they do NOT depend on `lexical` itself,
 * only on the resulting Yjs structure, so the adapter has zero peer deps
 * beyond `yjs` (already a dep of the core surface).
 *
 * @example
 * import { sync } from '@rudderjs/sync'
 * import { insertBlock, editText } from '@rudderjs/sync/lexical'
 *
 * const doc = sync.document('panel:articles:42:richcontent:body')
 * insertBlock(doc, 'callToAction', { title: 'Subscribe' })
 * editText(doc, { type: 'replace', search: 'hello', replace: 'hi' })
 */

export { editBlock, insertBlock, removeBlock }                  from './blocks.js'
export { editText, rewriteText, editTextBatch, readText }       from './text.js'
export { setAiAwareness, clearAiAwareness }                     from './awareness.js'
export type { InnerDeltaItem, LexicalAiCursor, LexicalTextOperation } from './types.js'
