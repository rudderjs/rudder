import type { Field } from './Field.js'
import type { FieldMeta } from './Field.js'

// ─── Section meta (for UI / meta endpoint) ─────────────────

export interface SectionMeta {
  type:         'section'
  title:        string
  description?: string
  collapsible:  boolean
  collapsed:    boolean
  columns:      1 | 2 | 3
  fields:       FieldMeta[]
}

// ─── Section class ─────────────────────────────────────────

export class Section {
  private _title:        string = ''
  private _description?: string
  private _collapsible:  boolean = false
  private _collapsed:    boolean = false
  private _columns:      1 | 2 | 3 = 1
  private _fields:       Field[] = []

  static make(title: string): Section {
    const s = new Section()
    s._title = title
    return s
  }

  description(text: string): this      { this._description = text; return this }
  collapsible(val = true): this        { this._collapsible = val; return this }
  collapsed(val = true): this          { this._collapsed = val; return this }
  columns(n: 1 | 2 | 3): this         { this._columns = n; return this }
  schema(...fields: Field[]): this     { this._fields = fields; return this }

  /** @internal — flat field list for validation / query building */
  getFields(): Field[] { return this._fields }

  /** @internal — serialized for the meta endpoint */
  toMeta(): SectionMeta {
    const meta: SectionMeta = {
      type:        'section',
      title:        this._title,
      collapsible:  this._collapsible,
      collapsed:    this._collapsed,
      columns:      this._columns,
      fields:       this._fields.map((f) => f.toMeta()),
    }
    if (this._description !== undefined) meta.description = this._description
    return meta
  }
}
