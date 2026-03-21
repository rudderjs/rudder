import type { Field } from './Field.js'
import type { FieldMeta } from './Field.js'

// ─── Generic item — any object (fields or schema elements) ──
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface SchemaItem {}

// ─── Section meta (for UI / meta endpoint) ─────────────────

export interface SectionMeta {
  type:         'section'
  title:        string
  description?: string | undefined
  collapsible:  boolean
  collapsed:    boolean
  columns:      1 | 2 | 3
  fields:       FieldMeta[]
  /** Schema elements (used in Panel.schema() sections). Undefined when used with fields. */
  elements?:    unknown[] | undefined
}

// ─── Section class ─────────────────────────────────────────

export class Section {
  private _title:        string = ''
  private _description?: string
  private _collapsible:  boolean = false
  private _collapsed:    boolean = false
  private _columns:      1 | 2 | 3 = 1
  private _items:        SchemaItem[] = []
  private _id?:          string

  static make(title: string): Section {
    const s = new Section()
    s._title = title
    return s
  }

  /** Unique ID for the section. */
  id(id: string): this { this._id = id; return this }

  /** Get the section ID, or undefined if not set. */
  getId(): string | undefined { return this._id }

  description(text: string): this      { this._description = text; return this }
  collapsible(val = true): this        { this._collapsible = val; return this }
  collapsed(val = true): this          { this._collapsed = val; return this }
  columns(n: 1 | 2 | 3): this         { this._columns = n; return this }

  /**
   * Set the section's content. Accepts Field instances (resource forms)
   * or schema elements (panel landing page).
   *
   * @example
   * // Resource fields
   * Section.make('Content').schema(TextField.make('title'), TextareaField.make('body'))
   *
   * // Panel schema elements
   * Section.make('Analytics').schema(Chart.make('Revenue')..., Stats.make([...]))
   */
  schema(...items: SchemaItem[]): this { this._items = items; return this }

  /** @internal — get items as Field[] (for resource field context). */
  getFields(): Field[] {
    return this._items.filter(
      (item): item is Field => typeof (item as Record<string, unknown>)['getType'] === 'function' && typeof (item as Record<string, unknown>)['getName'] === 'function'
    )
  }

  /** @internal — get all raw items. */
  getItems(): SchemaItem[] { return this._items }

  /** @internal — check if items are fields (resource context) or schema elements. */
  hasFields(): boolean {
    return this._items.length > 0 && this.getFields().length === this._items.length
  }

  getType(): 'section' { return 'section' }

  /** @internal — serialized for the meta endpoint */
  toMeta(): SectionMeta {
    const meta: SectionMeta = {
      type:        'section',
      title:        this._title,
      collapsible:  this._collapsible,
      collapsed:    this._collapsed,
      columns:      this._columns,
      fields:       [],
    }
    if (this._description !== undefined) meta.description = this._description

    if (this.hasFields()) {
      meta.fields = this.getFields().map((f) => f.toMeta())
    } else {
      // Schema element context — elements resolved by resolveSchema
      meta.fields = []
      meta.elements = []
    }

    return meta
  }
}
