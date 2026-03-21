// ─── Column — display column for Table.make() ───────────────
//
// Distinct from Field:
//   Field — input, user edits, validates, persists (form context)
//   Column — display, sortable/filterable/searchable (table context)

export interface ColumnMeta {
  name:       string
  label:      string
  sortable:   boolean
  searchable: boolean
  type:       'string' | 'number' | 'boolean' | 'date' | 'badge' | 'image'
  format?:    string
  href?:      string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ComputeFn = (record: Record<string, any>) => unknown
type DisplayFn = (value: unknown, record?: Record<string, unknown>) => unknown

export class Column {
  private _name:       string
  private _label:      string
  private _sortable:   boolean = false
  private _searchable: boolean = false
  private _type:       ColumnMeta['type'] = 'string'
  private _format?:    string
  private _href?:      string
  private _computeFn?: ComputeFn
  private _displayFn?: DisplayFn

  private constructor(name: string) {
    this._name  = name
    this._label = name.replace(/([A-Z])/g, ' $1').trim()
      .replace(/^./, s => s.toUpperCase())
  }

  static make(name: string): Column {
    return new Column(name)
  }

  label(text: string): this         { this._label      = text;  return this }
  sortable(val = true): this        { this._sortable   = val;   return this }
  searchable(val = true): this      { this._searchable = val;   return this }
  numeric(): this                   { this._type       = 'number';  return this }
  boolean(): this                   { this._type       = 'boolean'; return this }
  date(format?: string): this       { this._type = 'date'; if (format) this._format = format; return this }
  badge(): this                     { this._type       = 'badge';  return this }
  image(): this                     { this._type       = 'image';  return this }

  /** Make column values clickable links. Use ':value' as a placeholder for the cell value. */
  href(pattern: string): this       { this._href       = pattern; return this }

  /**
   * Compute a derived value from the full record. Runs server-side (SSR + API).
   * The computed value replaces the column's value in the record before rendering.
   *
   * @example
   * Column.make('wordCount')
   *   .compute((record) => record.content?.split(/\s+/).length ?? 0)
   */
  compute(fn: ComputeFn): this {
    this._computeFn = fn
    return this
  }

  /**
   * Format the column value for display. Runs server-side (SSR + API).
   *
   * @example
   * Column.make('price').display((v) => `$${((v as number) / 100).toFixed(2)}`)
   * Column.make('wordCount').compute(r => r.body?.split(/\s+/).length).display(v => `${v} words`)
   */
  display(fn: DisplayFn): this {
    this._displayFn = fn
    return this
  }

  getName(): string  { return this._name }
  getComputeFn(): ComputeFn | undefined { return this._computeFn }
  getDisplayFn(): DisplayFn | undefined { return this._displayFn }

  toMeta(): ColumnMeta {
    const meta: ColumnMeta = {
      name:       this._name,
      label:      this._label,
      sortable:   this._sortable,
      searchable: this._searchable,
      type:       this._type,
    }
    if (this._format !== undefined) meta.format = this._format
    if (this._href   !== undefined) meta.href   = this._href
    return meta
  }
}
