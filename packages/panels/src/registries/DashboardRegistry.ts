import type { Dashboard } from '../schema/Dashboard.js'

export class DashboardRegistry {
  private static _dashboards: Map<string, Dashboard> = new Map()

  static register(panelName: string, dashboard: Dashboard): void {
    this._dashboards.set(`${panelName}:${dashboard.getId()}`, dashboard)
  }

  static get(panelName: string, dashboardId: string): Dashboard | undefined {
    return this._dashboards.get(`${panelName}:${dashboardId}`)
  }

  static allForPanel(panelName: string): Dashboard[] {
    const result: Dashboard[] = []
    for (const [key, dash] of this._dashboards) {
      if (key.startsWith(`${panelName}:`)) result.push(dash)
    }
    return result
  }

  static all(): Dashboard[] {
    return [...this._dashboards.values()]
  }

  static has(panelName: string, dashboardId: string): boolean {
    return this._dashboards.has(`${panelName}:${dashboardId}`)
  }

  static reset(): void {
    this._dashboards.clear()
  }
}
