// ─── DataField — view-agnostic field display ──────────────────
//
// Base class for displaying a field value in any view mode (list, grid, table).
// Column extends DataField to add table-specific features (sortable, searchable).
//
//   DataField.make('name').editable()
//   DataField.make('price').numeric().display(v => `$${v}`)
//   DataField.make('coverImage').image()
//   DataField.make('status').badge().editable('popover')

import type { FieldMeta } from './Field.js'
import type { PanelContext } from '../types.js'

export type EditMode = 'inline' | 'popover' | 'modal'
export type DataFieldType = 'string' | 'number' | 'boolean' | 'date' | 'badge' | 'image'

type DataFieldSaveHandler = (record: Record<string, unknown>, value: unknown, ctx: PanelContext) => Promise<void> | void

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ComputeFn = (record: Record<string, any>) => unknown
type DisplayFn = (value: unknown, record?: Record<string, unknown>) => unknown

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FieldLike = { getType(): string; toMeta(): any }

const INLINE_TYPES = new Set(['text', 'email', 'number', 'select', 'toggle', 'boolean', 'color', 'date', 'datetime'])
const POPOVER_TYPES = new Set(['textarea', 'tags', 'json', 'slug'])

export interface DataFieldMeta {
  name:       string
  label:      string
  type:       DataFieldType
  format?:    string
  href?:      string
  editable?:  boolean
  editMode?:  EditMode
  editField?: FieldMeta
}

export class DataField {
  protected _name:       string
  protected _label:      string
  protected _type:       DataFieldType = 'string'
  protected _format?:    string
  protected _href?:      string
  protected _computeFn?: ComputeFn
  protected _displayFn?: DisplayFn
  protected _editable        = false
  protected _editMode?:       EditMode
  protected _editField?:      FieldLike
  protected _onSaveFn?:       DataFieldSaveHandler

  protected constructor(name: string) {
    this._name  = name
    this._label = name.replace(/([A-Z])/g, ' $1').trim()
      .replace(/^./, s => s.toUpperCase())
  }

  static make(name: string): DataField {
    return new DataField(name)
  }

  // ── Display type hints ────────────────────────────

  /** Override the auto-derived label. */
  label(text: string): this         { this._label = text;  return this }

  /** Mark as numeric. */
  numeric(): this                   { this._type = 'number';  return this }

  /** Mark as boolean. */
  boolean(): this                   { this._type = 'boolean'; return this }

  /** Mark as date with optional format string. */
  date(format?: string): this       { this._type = 'date'; if (format) this._format = format; return this }

  /** Render as a badge. */
  badge(): this                     { this._type = 'badge';  return this }

  /** Render as an image thumbnail. */
  image(): this                     { this._type = 'image';  return this }

  /** Make values clickable links. Use ':value' as placeholder for the field value. */
  href(pattern: string): this       { this._href = pattern; return this }

  // ── Computed / display ────────────────────────────

  /**
   * Compute a derived value from the full record. Runs server-side (SSR + API).
   *
   * @example
   * DataField.make('wordCount').compute((r) => r.body?.split(/\s+/).length ?? 0)
   */
  compute(fn: ComputeFn): this {
    this._computeFn = fn
    return this
  }

  /**
   * Format the value for display. Runs server-side (SSR + API).
   *
   * @example
   * DataField.make('price').display((v) => `$${((v as number) / 100).toFixed(2)}`)
   */
  display(fn: DisplayFn): this {
    this._displayFn = fn
    return this
  }

  // ── Editable ──────────────────────────────────────

  /**
   * Enable inline editing for this field.
   *
   * Overloads:
   * - `editable()` — enable with auto mode
   * - `editable('popover')` — enable with forced mode
   * - `editable(field)` — enable with custom field, auto mode
   * - `editable(field, 'modal')` — enable with custom field + forced mode
   */
  editable(modeOrField?: EditMode | FieldLike, mode?: EditMode): this {
    this._editable = true
    if (modeOrField !== undefined) {
      if (typeof modeOrField === 'string') {
        this._editMode = modeOrField
      } else if (typeof (modeOrField as FieldLike).getType === 'function') {
        this._editField = modeOrField as FieldLike
        if (mode) this._editMode = mode
      }
    }
    return this
  }

  /** Store a field-level save handler for inline editing. */
  onSave(fn: DataFieldSaveHandler): this {
    this._onSaveFn = fn
    return this
  }

  // ── Getters ───────────────────────────────────────

  getName(): string  { return this._name }
  getLabel(): string { return this._label }
  getComputeFn(): ComputeFn | undefined { return this._computeFn }
  getDisplayFn(): DisplayFn | undefined { return this._displayFn }
  isEditable(): boolean { return this._editable }
  getEditMode(): EditMode | undefined { return this._editMode }
  getEditField(): FieldLike | undefined { return this._editField }
  getOnSaveFn(): DataFieldSaveHandler | undefined { return this._onSaveFn }

  // ── Serialization ─────────────────────────────────

  toMeta(): DataFieldMeta {
    const meta: DataFieldMeta = {
      name:       this._name,
      label:      this._label,
      type:       this._type,
    }
    if (this._format !== undefined) meta.format = this._format
    if (this._href   !== undefined) meta.href   = this._href

    if (this._editable) {
      meta.editable = true

      // Resolve edit mode: explicit > auto-from-field-type > 'inline'
      if (this._editMode) {
        meta.editMode = this._editMode
      } else if (this._editField) {
        const fieldType = this._editField.getType()
        meta.editMode = INLINE_TYPES.has(fieldType) ? 'inline'
          : POPOVER_TYPES.has(fieldType) ? 'popover'
          : 'modal'
      } else {
        meta.editMode = 'inline'
      }

      // Serialize editField — custom or default
      if (this._editField) {
        meta.editField = this._editField.toMeta() as FieldMeta
      } else {
        const defaultType = this._type === 'number' ? 'number'
          : this._type === 'boolean' ? 'toggle'
          : this._type === 'date' ? 'date'
          : 'text'
        meta.editField = { name: this._name, type: defaultType, label: '' }
      }
    }

    return meta
  }
}
