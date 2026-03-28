import type { PanelContext } from '../types.js'
import type { PersistMode } from '../persist.js'
import { readPersistedState, slugify as slugifyPersist } from '../persist.js'

/**
 * Resolve the SSR active tab index based on persist mode.
 * For 'url' mode reads from ctx.urlSearch, for 'session' mode reads from server session.
 * Returns 0 (first tab) for 'localStorage', false, or when lookup fails.
 */
export async function resolveActiveTabIndex(
  persistMode: PersistMode,
  tabsId: string | undefined,
  tabLabels: string[],
  ctx: PanelContext,
): Promise<number> {
  if (persistMode === 'url' && tabsId) {
    const urlSearch = ctx.urlSearch
    if (urlSearch) {
      const activeSlug = urlSearch[tabsId]
      if (activeSlug) {
        const idx = tabLabels.findIndex(label => slugifyPersist(label) === activeSlug)
        if (idx >= 0) return idx
      }
    }
  } else if (persistMode === 'session' && tabsId) {
    const state = readPersistedState('session', `tabs:${tabsId}`, ctx)
    if (state) {
      const slug = state.value ? String(state.value) : undefined
      if (typeof slug === 'string') {
        const idx = tabLabels.findIndex(label => slugifyPersist(label) === slug)
        if (idx >= 0) return idx
      }
    }
  }
  return 0
}
