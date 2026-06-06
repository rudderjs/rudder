// Structural view of @rudderjs/database's globalThis driver cache (frozen key
// `__rudderjs_native_client__` — see packages/database/src/native/adapter.ts).
// Read structurally so the CLI never imports the node-only driver modules and
// works regardless of which package version populated the cache.

interface Closable {
  close?: () => Promise<void>
}

interface NativeClientCacheEntry {
  driver?:      Closable
  /** Read-replica drivers (read/write split) — absent without `readUrls`. */
  readDrivers?: Closable[]
}

const NATIVE_CLIENT_CACHE_KEY = '__rudderjs_native_client__'

/**
 * Close every pooled native driver the command opened, so a one-shot command's
 * process can exit naturally once the event loop drains.
 *
 * better-sqlite3 is synchronous (no open handles), but the pg (`postgres`) and
 * mysql (`mysql2`) drivers hold pooled sockets that keep the event loop alive
 * after the command's handler resolves — without this, `rudder migrate` (and
 * any command that boots an app whose default connection is native pg/mysql)
 * hangs until killed. Long-running commands (queue:work, schedule:work) are
 * unaffected: their handlers only resolve on shutdown, which is exactly when
 * the drivers should close anyway.
 *
 * Best-effort by design — a close failure on the exit path must never change a
 * command's outcome or exit code.
 */
export async function disposeNativeDriverCache(): Promise<void> {
  const g = globalThis as Record<string, unknown>
  const cache = g[NATIVE_CLIENT_CACHE_KEY]
  // Map = current per-connection shape; bare object = the legacy single-entry
  // shape an older bundle may have left behind (same fallback the adapter does).
  const entries: NativeClientCacheEntry[] =
    cache instanceof Map ? [...cache.values()] as NativeClientCacheEntry[]
    : cache && typeof cache === 'object' ? [cache as NativeClientCacheEntry]
    : []
  for (const entry of entries) {
    for (const driver of [entry.driver, ...(entry.readDrivers ?? [])]) {
      try {
        await driver?.close?.()
      } catch {
        // exit path — best-effort
      }
    }
  }
  // Evict closed drivers so nothing can reuse them (mirrors adapter.disconnect()).
  if (cache instanceof Map) cache.clear()
  else if (entries.length > 0) delete g[NATIVE_CLIENT_CACHE_KEY]
}
