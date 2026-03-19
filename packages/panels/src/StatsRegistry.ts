import type { Stats } from './schema/Stats.js'
import { createRegistry } from './BaseRegistry.js'

/**
 * @internal — runtime registry of Stats instances with data functions.
 * Populated by resolveSchema() on first SSR request.
 * Looked up by the stats data API endpoint for lazy/poll.
 */
export const StatsRegistry = createRegistry<Stats>()
