/**
 * @internal — debug logger for panels package.
 * Only logs in development mode (process.env.NODE_ENV !== 'production').
 * Used in catch blocks that would otherwise silently swallow errors.
 */
const isDev = typeof process !== 'undefined' && process.env?.['NODE_ENV'] !== 'production'

export function debugWarn(context: string, error: unknown): void {
  if (!isDev) return
  const msg = error instanceof Error ? error.message : String(error)
  console.warn(`[panels:${context}]`, msg)
}
