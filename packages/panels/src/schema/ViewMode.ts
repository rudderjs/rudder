import type { DataField, DataFieldMeta } from './DataField.js'
import type { Column } from './Column.js'

type SchemaElement = { getType(): string }

// ─── ViewMode builder ─────────────────────────────────────
// Configures a view mode for List/Table data-view elements.
// All view types accept DataField[] (or Column[] for table).
//
//   ViewMode.list([DataField.make('name').editable()])
//   ViewMode.grid([DataField.make('coverImage').image()])
//   ViewMode.table([Column.make('title').sortable()])
//   ViewMode.make('cards').render(fn)

export interface ViewModeMeta {
  type:        string
  name:        string
  label:       string
  icon?:       string
  fields?:     DataFieldMeta[]
}

export class ViewMode {
  private _type:      string
  private _name:      string
  private _label:     string
  private _icon?:     string
  private _renderFn?: (record: Record<string, unknown>) => SchemaElement[]
  private _fields?:   DataField[]

  private constructor(name: string) {
    this._type  = 'custom'
    this._name  = name
    this._label = name.charAt(0).toUpperCase() + name.slice(1)
  }

  /** Create a custom named view mode. */
  static make(name: string): ViewMode { return new ViewMode(name) }

  /** Built-in list view preset. Optionally pass DataField[] for custom field layout. */
  static list(fields?: DataField[]): ViewMode {
    const v = new ViewMode('list')
    v._type  = 'list'
    v._label = 'List'
    v._icon  = 'list'
    if (fields) v._fields = fields
    return v
  }

  /** Built-in grid view preset. Optionally pass DataField[] for custom field layout. */
  static grid(fields?: DataField[]): ViewMode {
    const v = new ViewMode('grid')
    v._type  = 'grid'
    v._label = 'Grid'
    v._icon  = 'layout-grid'
    if (fields) v._fields = fields
    return v
  }

  /** Table view preset with column definitions. */
  static table(columns: Column[]): ViewMode {
    const v = new ViewMode('table')
    v._type    = 'table'
    v._label   = 'Table'
    v._icon    = 'table'
    v._fields  = columns
    return v
  }

  /** Tree view preset — hierarchical drag-and-drop. Requires .folder() on the parent List. */
  static tree(fields?: DataField[]): ViewMode {
    const v = new ViewMode('tree')
    v._type  = 'tree'
    v._label = 'Tree'
    v._icon  = 'git-branch'
    if (fields) v._fields = fields
    return v
  }

  /** Display label for the view toggle button. Auto-derives name from label if not explicitly set. */
  label(label: string): this {
    this._label = label
    // Auto-derive name from label (slugified) unless explicitly set via make()
    if (this._name === this._type) {
      this._name = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
    }
    return this
  }

  /** Explicit name override (for remember/persistence key). */
  name(name: string): this {
    this._name = name
    return this
  }

  /** Icon for the view toggle button (lucide icon name). */
  icon(icon: string): this {
    this._icon = icon
    return this
  }

  /** Custom render function — receives a record, returns schema elements. */
  render(fn: (record: Record<string, unknown>) => SchemaElement[]): this {
    this._renderFn = fn
    return this
  }

  // ── Getters ───────────────────────────────────────

  getType(): string { return this._type }
  getName(): string { return this._name }
  getLabel(): string { return this._label }
  getIcon(): string | undefined { return this._icon }
  getRenderFn(): ((record: Record<string, unknown>) => SchemaElement[]) | undefined { return this._renderFn }
  getFields(): DataField[] | undefined { return this._fields }

  /** @deprecated Use getFields() instead. */
  getColumns(): Column[] | undefined { return this._fields as Column[] | undefined }

  /** Serialize for SSR payload. */
  toMeta(): ViewModeMeta {
    const meta: ViewModeMeta = {
      type:  this._type,
      name:  this._name,
      label: this._label,
    }
    if (this._icon) meta.icon = this._icon
    if (this._fields && this._fields.length > 0) {
      meta.fields = this._fields.map(f => f.toMeta())
    }
    return meta
  }
}
