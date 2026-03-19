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
