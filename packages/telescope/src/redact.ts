/**
 * Sensitive-data redaction helpers used by collectors before storing
 * entries. Redaction happens at COLLECTION time, not display time, so
 * sensitive values never reach the storage backend (memory, sqlite,
 * future Postgres, etc.) — they can't leak via export, share-link, or
 * a future MCP integration.
 */

const REDACTED = '[REDACTED]'

/**
 * Returns a copy of `headers` with values for any header in `hideList`
 * (case-insensitive) replaced with `[REDACTED]`. Header keys are
 * preserved as written by the runtime so the dashboard still shows
 * "Authorization: [REDACTED]" rather than dropping the row entirely.
 */
export function redactHeaders(
  headers: Record<string, unknown> | undefined,
  hideList: string[],
): Record<string, unknown> | undefined {
  if (!headers || hideList.length === 0) return headers
  const lowerHide = new Set(hideList.map(h => h.toLowerCase()))
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(headers)) {
    out[k] = lowerHide.has(k.toLowerCase()) ? REDACTED : v
  }
  return out
}

/**
 * Walks an arbitrary value and returns a copy with any object key in
 * `hideList` (case-insensitive) replaced with `[REDACTED]`. Recurses
 * into objects and arrays. Primitives, null, undefined are returned
 * unchanged. Dates and other built-ins pass through.
 *
 * Used for request bodies — `{ password: "abc", user: { token: "xyz" }}`
 * becomes `{ password: "[REDACTED]", user: { token: "[REDACTED]" }}`.
 */
export function redactFields(value: unknown, hideList: string[]): unknown {
  if (hideList.length === 0) return value
  const lowerHide = new Set(hideList.map(h => h.toLowerCase()))
  return walk(value, lowerHide)
}

function walk(value: unknown, hide: Set<string>): unknown {
  if (value === null || value === undefined) return value
  if (Array.isArray(value)) return value.map(v => walk(v, hide))
  if (typeof value !== 'object') return value
  if (value instanceof Date) return value

  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = hide.has(k.toLowerCase()) ? REDACTED : walk(v, hide)
  }
  return out
}
