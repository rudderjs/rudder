import type { Panel } from '../Panel.js'

// ─── Panel Registry (global singleton) ─────────────────────

class PanelRegistryImpl {
  private _panels: Map<string, Panel> = new Map()

  register(panel: Panel): void {
    if (this._panels.has(panel.getName())) {
      throw new Error(`[BoostKit Panels] A panel named "${panel.getName()}" is already registered.`)
    }
    this._panels.set(panel.getName(), panel)
  }

  get(name: string): Panel | undefined {
    return this._panels.get(name)
  }

  all(): Panel[] {
    return [...this._panels.values()]
  }

  has(name: string): boolean {
    return this._panels.has(name)
  }

  /** @internal — used in dev hot-reload and tests */
  reset(): void {
    this._panels.clear()
  }
}

const g = globalThis as Record<string, unknown>

if (!g['__boostkit_panel_registry__']) {
  g['__boostkit_panel_registry__'] = new PanelRegistryImpl()
}

export const PanelRegistry = g['__boostkit_panel_registry__'] as PanelRegistryImpl
