/**
 * @internal — generic runtime registry for schema elements.
 * Used by TableRegistry, StatsRegistry, TabsRegistry, and FormRegistry.
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

    /** @internal — for testing */
    reset(): void {
      entries.clear()
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
