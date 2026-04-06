import { Filter } from '../Filter.js'

/**
 * Boolean filter — renders as a ternary toggle (Yes / No / All).
 *
 * @example
 * BooleanFilter.make('active')
 *   .trueLabel('Active')
 *   .falseLabel('Inactive')
 */
export class BooleanFilter extends Filter {
  protected _column?: string
  protected _trueLabel  = 'Yes'
  protected _falseLabel = 'No'

  static make(name: string): BooleanFilter {
    return new BooleanFilter(name)
  }

  getType(): string { return 'boolean' }

  /** The model column to filter on (defaults to the filter name). */
  column(col: string): this {
    this._column = col
    return this
  }

  trueLabel(label: string): this {
    this._trueLabel = label
    this._extra['trueLabel'] = label
    return this
  }

  falseLabel(label: string): this {
    this._falseLabel = label
    this._extra['falseLabel'] = label
    return this
  }

  apply(query: Record<string, unknown>, value: unknown): Record<string, unknown> {
    const col = this._column ?? this._name
    // 'true' / 'false' strings from URL query params
    if (value === true || value === 'true' || value === '1')  return { ...query, [col]: true }
    if (value === false || value === 'false' || value === '0') return { ...query, [col]: false }
    return query // null/empty = show all
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  applyToQuery(q: any, value: unknown): any {
    if (this._queryFn) return this._queryFn(q, value)

    const col = this._column ?? this._name
    if (value === true || value === 'true' || value === '1')  return q.where(col, true)
    if (value === false || value === 'false' || value === '0') return q.where(col, false)
    return q
  }
}
