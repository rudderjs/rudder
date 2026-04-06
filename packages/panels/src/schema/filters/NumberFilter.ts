import { Filter } from '../Filter.js'

/**
 * Number range filter — renders as min/max number inputs.
 *
 * @example
 * NumberFilter.make('price')
 *   .min(0)
 *   .max(10000)
 *   .step(10)
 */
export class NumberFilter extends Filter {
  protected _column?: string
  protected _min?: number
  protected _max?: number
  protected _step?: number

  static make(name: string): NumberFilter {
    return new NumberFilter(name)
  }

  getType(): string { return 'number' }

  /** The model column to filter on (defaults to the filter name). */
  column(col: string): this {
    this._column = col
    return this
  }

  /** Minimum allowed value (UI hint). */
  min(n: number): this {
    this._min = n
    this._extra['min'] = n
    return this
  }

  /** Maximum allowed value (UI hint). */
  max(n: number): this {
    this._max = n
    this._extra['max'] = n
    return this
  }

  /** Step increment (UI hint). */
  step(n: number): this {
    this._step = n
    this._extra['step'] = n
    return this
  }

  apply(query: Record<string, unknown>, value: unknown): Record<string, unknown> {
    const col = this._column ?? this._name
    const v = value as { min?: number | string; max?: number | string } | number | string | undefined

    if (typeof v === 'number' || typeof v === 'string') {
      return { ...query, [col]: Number(v) }
    }

    if (v && typeof v === 'object') {
      const result = { ...query }
      if (v.min !== undefined && v.min !== '') result[`${col}:gte`] = Number(v.min)
      if (v.max !== undefined && v.max !== '') result[`${col}:lte`] = Number(v.max)
      return result
    }

    return query
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  applyToQuery(q: any, value: unknown): any {
    if (this._queryFn) return this._queryFn(q, value)

    const col = this._column ?? this._name
    const v = value as { min?: number | string; max?: number | string } | number | string | undefined

    if (typeof v === 'number' || typeof v === 'string') {
      return q.where(col, Number(v))
    }

    if (v && typeof v === 'object') {
      if (v.min !== undefined && v.min !== '') q = q.where(col, '>=', Number(v.min))
      if (v.max !== undefined && v.max !== '') q = q.where(col, '<=', Number(v.max))
    }

    return q
  }
}
