/**
 * Lightweight request-scoped batchId propagation. Uses a simple global
 * variable — works because Prisma's `$on('query')` callback fires
 * synchronously during the query, within the same call stack as the
 * request handler.
 *
 * The RequestCollector sets the batchId before `next()` and clears it
 * after. Any collector that fires during the request (query, cache,
 * model) can read it via `currentBatchId()`.
 */

let _currentBatchId: string | null = null

/** Set the current batchId for the duration of a request. */
export function setBatchId(id: string | null): void {
  _currentBatchId = id
}

/** Returns the current request's batchId, or `null` if not inside a request. */
export function currentBatchId(): string | null {
  return _currentBatchId
}

/** Returns `{ batchId }` if inside a request, or `{}` if not. Safe to spread into createEntry options. */
export function batchOpts(): { batchId?: string } {
  return _currentBatchId ? { batchId: _currentBatchId } : {}
}
