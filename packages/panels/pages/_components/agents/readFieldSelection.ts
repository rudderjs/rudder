'use client'

import { $getSelection, $isRangeSelection } from 'lexical'
import { getLexicalEditor } from './lexicalRegistry.js'

/**
 * Reads the user's currently-selected text from a field, regardless of which
 * input type backs it. Returns the captured selection (a frozen string the
 * caller can hold for the lifetime of a dropdown) or `null` when no text is
 * selected in that field.
 *
 * Three field flavours are supported:
 *
 * 1. **Plain `<input>` / `<textarea>`** — non-collaborative text fields
 *    rendered by `TextInput` / `TextareaInput` when no Yjs path is set. We
 *    locate the element via `document.querySelector('[name="..."]')` and
 *    read `selectionStart` / `selectionEnd` from the live DOM. The browser
 *    preserves these across blur, so the read works even after the user
 *    clicks the field-level `✦` button (which moves focus away).
 *
 * 2. **Collaborative plain text** — `CollaborativePlainText` from
 *    `panels-lexical`. Backed by a Lexical editor that's registered into
 *    `lexicalRegistry` at mount time. We use the registry to look up the
 *    editor and read its current `RangeSelection`'s text content via
 *    `editor.getEditorState().read(...)`.
 *
 * 3. **Lexical rich content** — `RichContentInput` / `LexicalEditor`. Same
 *    mechanism as #2 — both register into `lexicalRegistry` keyed by field
 *    name.
 *
 * **Why two paths instead of one:** plain inputs aren't in the lexical
 * registry (they don't have an editor), so the DOM-querySelector path is the
 * only option. For Lexical-backed fields the registry is the source of
 * truth — querying the DOM would give us the wrong rect because Lexical
 * uses content-editable nodes whose selection model is different from
 * native input fields.
 *
 * **Read order:** registry first, then DOM. If a field name is in the
 * registry it's a Lexical field; ignore the DOM. This handles the case
 * where a `TextInput` is mounted in collab mode (the underlying input
 * element exists in the DOM but the field's actual editor is the
 * registered Lexical instance).
 */
export function readFieldSelection(fieldName: string): { text: string } | null {
  // ── 1. Lexical path (registry) ───────────────────────────
  const editor = getLexicalEditor(fieldName)
  if (editor) {
    let captured: string | null = null
    try {
      editor.getEditorState().read(() => {
        const selection = $getSelection()
        if (!$isRangeSelection(selection) || selection.isCollapsed()) return
        const text = selection.getTextContent()
        if (text.trim()) captured = text
      })
    } catch {
      /* editor unmounted between calls — fall through to null */
    }
    return captured ? { text: captured } : null
  }

  // ── 2. Plain DOM path ────────────────────────────────────
  if (typeof document === 'undefined') return null
  // Field input components render their `<input>` / `<textarea>` with
  // `name={field.name}`, so this is the canonical lookup. CSS.escape guards
  // against unusual characters in field names (uncommon but possible).
  const escaped = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(fieldName) : fieldName
  const el = document.querySelector(`[name="${escaped}"]`) as
    | HTMLInputElement
    | HTMLTextAreaElement
    | null
  if (!el) return null

  // Only `<input>` and `<textarea>` expose selectionStart/End. Other
  // elements (or input types like `email` / `number` / `date` that don't
  // support text selection) return null/undefined here, which we treat as
  // "no selection."
  const start = el.selectionStart ?? null
  const end   = el.selectionEnd   ?? null
  if (start === null || end === null || start === end) return null

  const text = el.value.slice(start, end)
  if (!text.trim()) return null
  return { text }
}
