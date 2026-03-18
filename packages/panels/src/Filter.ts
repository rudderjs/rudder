// ─── Filter meta (for UI) ──────────────────────────────────

export interface FilterMeta {
  name:  string
  type:  string
  label: string
  extra: Record<string, unknown>
}

// ─── Filter base class ─────────────────────────────────────

export abstract class Filter {
  protected _name:  string
  protected _label: string | undefined
  protected _extra: Record<string, unknown> = {}

  constructor(name: string) {
    this._name = name
  }

  label(label: string): this {
    this._label = label
    return this
  }

  getName(): string {
    return this._name
  }

  getLabel(): string {
    if (this._label) return this._label
    return this._name
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, (s) => s.toUpperCase())
      .trim()
  }

  abstract getType(): string

  /** @internal — applied to query builder */
  abstract apply(query: Record<string, unknown>, value: unknown): Record<string, unknown>

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected _queryFn?: (q: any, value: unknown) => any

  /**
   * Custom query callback — receives the raw ORM query builder and the filter value.
   * Use this when the default column=value equality isn't enough.
   *
   * @example
   * SelectFilter.make('status')
   *   .options([...])
   *   .query((q, value) => q.where('status', value).where('deletedAt', null))
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query(fn: (q: any, value: unknown) => any): this {
    this._queryFn = fn
    return this
  }

  /** @internal — apply this filter to a query builder */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  applyToQuery(q: any, value: unknown): any {
    if (this._queryFn) return this._queryFn(q, value)
    // Default: translate apply() map → ORM where clauses
    const clauses = this.apply({}, value)
    for (const [col, val] of Object.entries(clauses)) {
      if (col === '_search') {
        const { value: sv, columns } = val as { value: string; columns: string[] }
        if (columns[0]) q = q.where(columns[0], 'LIKE', `%${sv}%`)
        for (let i = 1; i < columns.length; i++) q = q.orWhere(columns[i] ?? '', `%${sv}%`)
      } else {
        q = q.where(col, val)
      }
    }
    return q
  }

  toMeta(): FilterMeta {
    return {
      name:  this._name,
      type:  this.getType(),
      label: this.getLabel(),
      extra: this._extra,
    }
  }
}

// ─── SelectFilter ──────────────────────────────────────────

export interface FilterOption {
  label: string
  value: string | number | boolean
}

export class SelectFilter extends Filter {
  protected _options: FilterOption[] = []
  protected _column?: string

  static make(name: string): SelectFilter {
    return new SelectFilter(name)
  }

  getType(): string { return 'select' }

  /** The model column to filter on (defaults to the filter name). */
  column(col: string): this {
    this._column = col
    return this
  }

  options(opts: string[] | FilterOption[]): this {
    this._options = opts.map((o) =>
      typeof o === 'string' ? { label: o, value: o } : o,
    )
    this._extra['options'] = this._options
    return this
  }

  apply(query: Record<string, unknown>, value: unknown): Record<string, unknown> {
    const col = this._column ?? this._name
    // Coerce the URL string back to the typed option value (boolean, number, etc.)
    const typedValue = this._options.find((o) => String(o.value) === String(value))?.value ?? value
    return { ...query, [col]: typedValue }
  }
}

// ─── SearchFilter ──────────────────────────────────────────

export class SearchFilter extends Filter {
  protected _columns: string[] = []

  static make(name = 'search'): SearchFilter {
    return new SearchFilter(name)
  }

  getType(): string { return 'search' }

  /** Columns to search across (OR). */
  columns(...cols: string[]): this {
    this._columns = cols
    this._extra['columns'] = cols
    return this
  }

  apply(query: Record<string, unknown>, value: unknown): Record<string, unknown> {
    return { ...query, _search: { value, columns: this._columns } }
  }
}
