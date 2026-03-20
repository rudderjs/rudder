import type { PanelContext } from './types.js'

/** Persist mode for UI state (tabs, tables, etc.) */
export type PersistMode = false | 'localStorage' | 'url' | 'session'

/**
 * Read persisted state from URL search params or server session during SSR.
 * Returns undefined if no state is found or persist mode doesn't support SSR.
 *
 * - `'url'` — reads from ctx.urlSearch using `${prefix}_${key}` params
 * - `'session'` — reads from ctx.sessionGet using `${storeKey}` key
 * - `'localStorage'` / `false` — returns undefined (client-only)
 */
export function readPersistedState(
  mode: PersistMode,
  storeKey: string,
  ctx: PanelContext,
  urlPrefix?: string,
): Record<string, unknown> | undefined {
  if (mode === 'url' && ctx.urlSearch) {
    const prefix = urlPrefix ?? storeKey
    const state: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(ctx.urlSearch)) {
      if (k.startsWith(`${prefix}_`)) {
        state[k.slice(prefix.length + 1)] = v
      }
    }
    return Object.keys(state).length > 0 ? state : undefined
  }

  if (mode === 'session' && ctx.sessionGet) {
    try {
      const stored = ctx.sessionGet(storeKey)
      if (stored && typeof stored === 'object') return stored as Record<string, unknown>
      if (typeof stored === 'string') return { value: stored }
    } catch { /* session not available */ }
  }

  return undefined
}

/** Slugify a string for URL params / storage keys. */
export function slugify(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}
