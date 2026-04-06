import { Filter } from '../Filter.js'

/**
 * Query filter — renders as a simple toggle with a label.
 * No user input — just an on/off toggle that applies a custom query.
 *
 * @example
 * QueryFilter.make('recent')
 *   .label('Last 7 days')
 *   .query((q) => q.where('createdAt', '>=', sevenDaysAgo))
 */
export class QueryFilter extends Filter {
  static make(name: string): QueryFilter {
    return new QueryFilter(name)
  }

  getType(): string { return 'query' }

  apply(_query: Record<string, unknown>, _value: unknown): Record<string, unknown> {
    // Query filters apply through .query() callback only
    return _query
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  applyToQuery(q: any, value: unknown): any {
    // Only apply when toggled on
    if (value === true || value === 'true' || value === '1') {
      if (this._queryFn) return this._queryFn(q, value)
    }
    return q
  }
}
