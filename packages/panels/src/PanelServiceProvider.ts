import { ServiceProvider } from '@boostkit/core'
import type { MiddlewareHandler, AppRequest, AppResponse } from '@boostkit/core'
import { PanelRegistry } from './PanelRegistry.js'
import { DashboardRegistry } from './DashboardRegistry.js'
import {
  buildPanelMiddleware,
  mountMetaRoutes,
  mountResourceRoutes,
  mountGlobalRoutes,
  mountDashboardRoutes,
} from './handlers/index.js'

// Re-export for public API
export { buildDefaultLayout } from './handlers/index.js'

// ─── Panel Service Provider ────────────────────────────────

export class PanelServiceProvider extends ServiceProvider {
  register(): void {
    // Panel schema (ORM + driver-specific)
    const schemaDir = new URL(/* @vite-ignore */ '../schema', import.meta.url).pathname
    this.publishes([
      { from: `${schemaDir}/panels.prisma`,            to: 'prisma/schema',   tag: 'panels-schema', orm: 'prisma' as const },
      { from: `${schemaDir}/panels.drizzle.sqlite.ts`, to: 'database/schema', tag: 'panels-schema', orm: 'drizzle' as const, driver: 'sqlite' as const },
      { from: `${schemaDir}/panels.drizzle.pg.ts`,     to: 'database/schema', tag: 'panels-schema', orm: 'drizzle' as const, driver: 'postgresql' as const },
      { from: `${schemaDir}/panels.drizzle.mysql.ts`,  to: 'database/schema', tag: 'panels-schema', orm: 'drizzle' as const, driver: 'mysql' as const },
    ])
  }

  async boot(): Promise<void> {
    this.publishes({
      from: new URL(/* @vite-ignore */ '../pages', import.meta.url).pathname,
      to:   'pages/(panels)',
      tag:  'panels-pages',
    })

    const { router } = await import('@boostkit/router') as {
      router: {
        get(path: string, handler: (req: AppRequest, res: AppResponse) => unknown, mw?: MiddlewareHandler[]): void
        post(path: string, handler: (req: AppRequest, res: AppResponse) => unknown, mw?: MiddlewareHandler[]): void
        put(path: string, handler: (req: AppRequest, res: AppResponse) => unknown, mw?: MiddlewareHandler[]): void
        delete(path: string, handler: (req: AppRequest, res: AppResponse) => unknown, mw?: MiddlewareHandler[]): void
      }
    }

    for (const panel of PanelRegistry.all()) {
      const mw = buildPanelMiddleware(panel)

      mountMetaRoutes(router, panel, mw)

      for (const ResourceClass of panel.getResources()) {
        mountResourceRoutes(router, panel, ResourceClass, mw)
      }

      for (const GlobalClass of panel.getGlobals()) {
        mountGlobalRoutes(router, panel, GlobalClass, mw)
      }

      mountDashboardRoutes(router, panel, mw)
    }
  }
}

// ─── Factory ───────────────────────────────────────────────

import type { Panel as PanelType } from './Panel.js'
import type { Application, ProviderClass } from '@boostkit/core'

/**
 * Register one or more panels and mount their API routes.
 *
 * An optional second argument accepts an array of extension providers
 * (e.g. `panelsLexical()`). These are dynamically registered during boot
 * via `this.app.register()`, keeping all panels-related wiring in one call.
 *
 * @example
 * import { panels } from '@boostkit/panels'
 * import { panelsLexical } from '@boostkit/panels-lexical/server'
 * import { adminPanel } from './panels.js'
 *
 * export default [
 *   panels([adminPanel], [panelsLexical()]),
 * ]
 */
export function panels(
  panelList:   PanelType[],
  extensions?: ProviderClass[],
): new (app: Application) => PanelServiceProvider {
  return class PanelsProvider extends PanelServiceProvider {
    register(): void {
      PanelRegistry.reset()
      DashboardRegistry.reset()
      for (const panel of panelList) {
        PanelRegistry.register(panel)
      }
    }

    override async boot(): Promise<void> {
      // Register extension providers (e.g. panels-lexical, panels-media)
      if (extensions) {
        for (const ext of extensions) {
          await this.app.register(ext)
        }
      }

      await super.boot()
    }
  }
}
