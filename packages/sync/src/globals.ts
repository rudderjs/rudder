/**
 * Centralized globalThis keys for `@rudderjs/sync`.
 *
 * State that must survive Vite SSR module re-evaluation (HMR) lives on
 * `globalThis`. The old keys mixed two naming schemes — some used the
 * `__rudderjs_live_*` prefix from the package's pre-rename name (`live`),
 * others used `__rudderjs_sync_*`. Two consequences worth fixing:
 *
 * 1. **Drift risk.** `index.ts` declared `KEY = '__rudderjs_live__'` for the
 *    rooms map; `lexical/awareness.ts` redeclared the same string literal
 *    independently. Rename either side without the other and AI cursors
 *    silently break — the lexical adapter would look up an empty rooms map
 *    forever.
 * 2. **Stale name.** Package was renamed `live` → `sync`; the keys still say
 *    `live`. New keys should match the package name.
 *
 * Adding new sync-process state? Add an entry here, import via `syncGlobal`,
 * never reach into `globalThis` directly.
 */
export const SYNC_KEYS = {
  rooms:            '__rudderjs_sync_rooms__',
  persistence:      '__rudderjs_sync_persistence__',
  firstConnect:     '__rudderjs_sync_first_connect__',
  observers:        '__rudderjs_sync_observers__',
  aiAwarenessClock: '__rudderjs_sync_ai_clock__',
} as const

export type SyncKey = keyof typeof SYNC_KEYS

const g = globalThis as Record<string, unknown>

/**
 * Get-or-create a value at one of the named `SYNC_KEYS` slots. The factory
 * runs at most once per process — repeat callers see the cached value.
 */
export function syncGlobal<T>(key: SyncKey, init: () => T): T {
  const slot = SYNC_KEYS[key]
  const existing = g[slot] as T | undefined
  if (existing !== undefined) return existing
  const created = init()
  g[slot] = created
  return created
}

/** Read a sync global without auto-initializing. */
export function readSyncGlobal<T>(key: SyncKey): T | undefined {
  return g[SYNC_KEYS[key]] as T | undefined
}

/** Replace the value at a sync global slot. */
export function setSyncGlobal<T>(key: SyncKey, value: T): void {
  g[SYNC_KEYS[key]] = value
}
