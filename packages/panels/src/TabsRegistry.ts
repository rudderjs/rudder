import type { Tabs } from './Tabs.js'

/**
 * @internal — runtime registry of model-backed / lazy / poll Tabs instances.
 * Populated by resolveSchema() on first SSR request.
 * Looked up by the tabs data API endpoint for lazy/poll.
 */
export class TabsRegistry {
  private static entries = new Map<string, Tabs>()

  static register(panelName: string, tabsId: string, tabs: Tabs): void {
    TabsRegistry.entries.set(`${panelName}:${tabsId}`, tabs)
  }

  static get(panelName: string, tabsId: string): Tabs | undefined {
    return TabsRegistry.entries.get(`${panelName}:${tabsId}`)
  }

  /** @internal — for testing */
  static reset(): void {
    TabsRegistry.entries.clear()
  }
}
