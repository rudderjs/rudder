/**
 * Browser-side registry of live Lexical editor instances, keyed by the field
 * name they render. Used by the `update_form_state` client tool handler so the
 * agent can dispatch ops to the same editor the user is currently typing into.
 *
 * Each `LexicalEditor` mount registers its instance via a small plugin and
 * unregisters on unmount. The registry holds at most one editor per field
 * name; navigating between resources or unmounting a field cleans it up.
 */

import type { LexicalEditor } from 'lexical'

const editors = new Map<string, LexicalEditor>()

/**
 * Register a live Lexical editor instance under the given field name. Returns
 * an unregister function to call from `useEffect` cleanup.
 *
 * If a different editor is already registered under the same name (e.g. a
 * stale entry from a botched unmount), it is replaced and a dev-mode warning
 * is logged so leaks surface during Phase 0 verification.
 */
export function registerLexicalEditor(fieldName: string, editor: LexicalEditor): () => void {
  const existing = editors.get(fieldName)
  if (existing && existing !== editor && typeof console !== 'undefined') {
    console.warn(
      `[lexicalRegistry] replacing stale editor for field "${fieldName}" — ` +
      `previous instance was not unregistered before remount`,
    )
  }
  editors.set(fieldName, editor)
  return () => {
    if (editors.get(fieldName) === editor) editors.delete(fieldName)
  }
}

/** Look up the currently-mounted Lexical editor for a field, if any. */
export function getLexicalEditor(fieldName: string): LexicalEditor | undefined {
  return editors.get(fieldName)
}

/** Snapshot of every registered field name — for diagnostics. */
export function listLexicalEditors(): string[] {
  return [...editors.keys()]
}

// ── Phase 0 dev hooks ───────────────────────────────────────
// Temporary devtools accessors used to verify the registry survives HMR and
// cleans up on navigation. Safe to delete once Phase 0 is signed off.
if (typeof window !== 'undefined') {
  const w = window as unknown as {
    __getLexicalEditor?: (fieldName: string) => LexicalEditor | undefined
    __listLexicalEditors?: () => string[]
  }
  w.__getLexicalEditor = getLexicalEditor
  w.__listLexicalEditors = listLexicalEditors
}
