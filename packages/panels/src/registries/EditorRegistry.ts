import type { ComponentType } from 'react'

/** Props passed to the richcontent editor renderer. */
export interface RichContentEditorProps {
  value:          unknown
  onChange:       (json: unknown) => void
  placeholder?:  string
  disabled?:     boolean
  wsPath?:       string | null
  docName?:      string | null
  fragmentName?: string
  blocks?:       unknown[]
  userName?:     string
  userColor?:    string
}

/** Props passed to the collaborative plain-text renderer. */
export interface CollaborativePlainTextProps {
  value:        string
  onChange:     (value: string) => void
  wsPath:       string
  docName:      string
  fieldName:    string
  userName?:    string
  userColor?:   string
  placeholder?: string
  disabled?:    boolean
  required?:    boolean
  className?:   string
  multiline?:   boolean
}

/**
 * @deprecated — Not a registry. Replaced by `registerField()` for editor components.
 * Kept for backward compatibility only.
 *
 * Previously populated by `@rudderjs/panels-lexical`, now unused.
 * `FieldInput.tsx` uses `ComponentRegistry` instead.
 */
export const editorRegistry: {
  richcontent:            ComponentType<RichContentEditorProps> | null
  collaborativePlainText: ComponentType<CollaborativePlainTextProps> | null
} = {
  richcontent:            null,
  collaborativePlainText: null,
}
