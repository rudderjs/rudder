import type { Tabs } from './Tabs.js'
import { createRegistry } from './BaseRegistry.js'

/**
 * @internal — runtime registry of model-backed / lazy / poll Tabs instances.
 * Populated by resolveSchema() on first SSR request.
 * Looked up by the tabs data API endpoint for lazy/poll.
 */
export const TabsRegistry = createRegistry<Tabs>()
