import type { PanelContext } from './types.js'

/**
 * A data source can be:
 * - A static array of records
 * - An async function that returns records (receives PanelContext for auth/params)
 */
export type DataSource<T = Record<string, unknown>> = T[] | ((ctx: PanelContext) => Promise<T[]>)

/**
 * Resolve a data source to an array of records.
 * If the source is an async function, it's called with the context.
 * If it's a static array, it's returned directly.
 */
export async function resolveDataSource<T>(
  source: DataSource<T>,
  ctx: PanelContext,
): Promise<T[]> {
  if (typeof source === 'function') {
    return source(ctx)
  }
  return source
}
