/**
 * @internal — generic runtime registry for schema elements.
 * Used by TableRegistry, StatsRegistry, TabsRegistry, FormRegistry, and DashboardRegistry.
 */
export function createRegistry<T>() {
  const entries = new Map<string, T>()

  return {
    register(panelName: string, id: string, item: T): void {
      entries.set(`${panelName}:${id}`, item)
    },

    get(panelName: string, id: string): T | undefined {
      return entries.get(`${panelName}:${id}`)
    },

    has(panelName: string, id: string): boolean {
      return entries.has(`${panelName}:${id}`)
    },

    /** Get all entries for a given panel. */
    allForPanel(panelName: string): T[] {
      const prefix = `${panelName}:`
      const result: T[] = []
      for (const [key, val] of entries) {
        if (key.startsWith(prefix)) result.push(val)
      }
      return result
    },

    /** Get all registered entries. */
    all(): T[] {
      return [...entries.values()]
    },

    /** @internal — for testing */
    reset(): void {
      entries.clear()
    },
  }
}

/**
 * Singleton registry — key → value, with duplicate guard.
 * Uses globalThis to survive Vite SSR module duplication.
 * Used by PanelRegistry.
 */
export function createSingletonRegistry<T>(
  namespace: string,
  opts?: { getKey: (item: T) => string; duplicateError?: (key: string) => string },
) {
  const g = globalThis as Record<string, unknown>
  const storeKey = `__boostkit_${namespace}`
  if (!g[storeKey]) g[storeKey] = new Map<string, T>()
  const map = g[storeKey] as Map<string, T>
  const getKey = opts?.getKey ?? ((item: T) => String(item))

  return {
    register(item: T): void {
      const key = getKey(item)
      if (opts?.duplicateError && map.has(key)) {
        throw new Error(opts.duplicateError(key))
      }
      map.set(key, item)
    },

    get(key: string): T | undefined {
      return map.get(key)
    },

    has(key: string): boolean {
      return map.has(key)
    },

    all(): T[] {
      return [...map.values()]
    },

    /** @internal — for testing and dev hot-reload */
    reset(): void {
      map.clear()
    },
  }
}

/**
 * Simple key → value registry.
 * Uses globalThis to survive Vite SSR module duplication.
 * Used by ComponentRegistry (fields, elements) and ResolverRegistry.
 */
export function createMapRegistry<T>(namespace: string) {
  const g = globalThis as Record<string, unknown>
  const key = `__boostkit_${namespace}`
  if (!g[key]) g[key] = new Map<string, T>()
  const map = g[key] as Map<string, T>
  return {
    register(key: string, value: T): void { map.set(key, value) },
    get(key: string): T | undefined { return map.get(key) },
  }
}
