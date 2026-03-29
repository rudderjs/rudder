import type { Dashboard } from '../schema/Dashboard.js'
import { createRegistry } from './BaseRegistry.js'

const _registry = createRegistry<Dashboard>()

export const DashboardRegistry = {
  register(panelName: string, dashboard: Dashboard): void {
    _registry.register(panelName, dashboard.getId(), dashboard)
  },
  get:          _registry.get,
  has:          _registry.has,
  allForPanel:  _registry.allForPanel,
  all:          _registry.all,
  reset:        _registry.reset,
}
