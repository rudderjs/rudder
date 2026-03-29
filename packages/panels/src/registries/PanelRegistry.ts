import type { Panel } from '../Panel.js'
import { createSingletonRegistry } from './BaseRegistry.js'

export const PanelRegistry = createSingletonRegistry<Panel>('panel_registry', {
  getKey: (panel) => panel.getName(),
  duplicateError: (name) => `[BoostKit Panels] A panel named "${name}" is already registered.`,
})
