import { Filter } from '../Filter.js'

/**
 * Date range filter — renders as from/to date pickers.
 *
 * @example
 * DateFilter.make('createdAt')
 *   .label('Created')
 *   .column('createdAt')
 */
export class DateFilter extends Filter {
  protected _column?: string

  static make(name: string): DateFilter {
    return new DateFilter(name)
  }

  getType(): string { return 'date' }

  /** The model column to filter on (defaults to the filter name). */
  column(col: string): this {
    this._column = col
    return this
  }

  apply(query: Record<string, unknown>, value: unknown): Record<string, unknown> {
    const col = this._column ?? this._name
    const v = value as { from?: string; to?: string } | string | undefined

    if (typeof v === 'string') {
      // Single date value
      return { ...query, [col]: v }
    }

    if (v && typeof v === 'object') {
      const result = { ...query }
      if (v.from) result[`${col}:gte`] = v.from
      if (v.to)   result[`${col}:lte`] = v.to
      return result
    }

    return query
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  applyToQuery(q: any, value: unknown): any {
    if (this._queryFn) return this._queryFn(q, value)

    const col = this._column ?? this._name
    const v = value as { from?: string; to?: string } | string | undefined

    if (typeof v === 'string') {
      return q.where(col, v)
    }

    if (v && typeof v === 'object') {
      if (v.from) q = q.where(col, '>=', v.from)
      if (v.to)   q = q.where(col, '<=', v.to)
    }

    return q
  }
}
