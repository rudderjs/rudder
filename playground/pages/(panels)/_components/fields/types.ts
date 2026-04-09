import type { FieldMeta, PanelI18n } from '@pilotiq/panels'

export interface FieldInputProps {
  field:       FieldMeta
  value:       unknown
  onChange:    (value: unknown) => void
  /** API base URL for the active panel (e.g. '/admin/api'). Required for FileField / ImageField. */
  uploadBase?: string
  i18n:        PanelI18n
  disabled?:   boolean
  /** All current form values — used by slug fields and derived fields. */
  formValues?: Record<string, unknown>
  /** Stable user identity for collaborative cursors (shared across all field types) */
  userName?: string
  userColor?: string
  /** WebSocket path for live collaboration (e.g. '/ws-live') — used by LexicalEditor */
  wsPath?:   string | null
  /** Base document name for live collaboration — used by LexicalEditor */
  docName?:  string | null
  /**
   * Legacy "Ask AI" callback — receives the selected text and routes to chat.
   * Still passed by some surfaces; selection-actions Phase 2 prefers the
   * inline `SelectionActionsMenu` flow which reads selection from the
   * floating-button surfaces directly. Kept here for backwards-compatibility
   * with any consumer that wires it up.
   */
  onAskAi?:  (text: string) => void
}

export const INPUT_CLS = 'w-full rounded-md border border-input px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent disabled:bg-muted disabled:text-muted-foreground'
