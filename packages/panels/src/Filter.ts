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
    return { ...query, [col]: value }
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
