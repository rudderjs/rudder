import type { Stats } from './schema/Stats.js'

/**
 * @internal — runtime registry of Stats instances with data functions.
 * Populated by resolveSchema() on first SSR request.
 * Looked up by the stats data API endpoint for lazy/poll.
 */
export class StatsRegistry {
  private static entries = new Map<string, Stats>()

  static register(panelName: string, statsId: string, stats: Stats): void {
    StatsRegistry.entries.set(`${panelName}:${statsId}`, stats)
  }

  static get(panelName: string, statsId: string): Stats | undefined {
    return StatsRegistry.entries.get(`${panelName}:${statsId}`)
  }

  /** @internal — for testing */
  static reset(): void {
    StatsRegistry.entries.clear()
  }
}
