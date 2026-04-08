import { ServiceProvider } from '@rudderjs/core'
import type { MiddlewareHandler, AppRequest, AppResponse } from '@rudderjs/core'
import { debugWarn } from './debug.js'
import { PanelRegistry } from './registries/PanelRegistry.js'
import { registerResolver } from './registries/ResolverRegistry.js'
import { DashboardRegistry } from './registries/DashboardRegistry.js'
import { BuiltInAiActionRegistry, builtInActions } from './ai-actions/index.js'
import {
  buildPanelMiddleware,
  mountMetaRoutes,
  mountResourceRoutes,
  mountGlobalRoutes,
  mountDashboardRoutes,
  mountPanelChat,
} from './handlers/index.js'
import { mountThemeRoutes, loadThemeOverrides } from './handlers/themeRoutes.js'
import { mountNotificationRoutes } from './handlers/notificationRoutes.js'
import { _clearI18nCache } from './i18n/index.js'

/**
 * Best-effort preload of `lang/<locale>/panels.json` overrides into the
 * `@rudderjs/localization` cache so `getPanelI18n()` can resolve them sync.
 * No-ops if `@rudderjs/localization` isn't installed.
 */
async function preloadPanelTranslations(): Promise<void> {
  try {
    const loc = await import('@rudderjs/localization') as {
      preloadNamespace?: (locale: string, namespace: string) => Promise<void>
      LocalizationRegistry?: { getConfig(): { locale: string; fallback: string } }
    }
    if (!loc.preloadNamespace || !loc.LocalizationRegistry) return
    const { locale, fallback } = loc.LocalizationRegistry.getConfig()
    await loc.preloadNamespace(locale, 'panels')
    if (fallback && fallback !== locale) {
      await loc.preloadNamespace(fallback, 'panels')
    }
    // Drop any merged result computed before the override landed in cache.
    _clearI18nCache()
  } catch {
    // @rudderjs/localization not installed — bundled defaults only.
  }
}

// Re-export for public API
export { buildDefaultLayout } from './handlers/index.js'

// ─── Panel Service Provider ────────────────────────────────

export class PanelServiceProvider extends ServiceProvider {
  register(): void {
    // Built-in AI quick actions — registered in the sync `register()` phase
    // so they're available before any field meta serialises (per Q1 in
    // `docs/plans/standalone-client-tools-plan.md`). App code can override
    // built-ins by registering its own with the same slug from a downstream
    // provider's register() — later wins.
    for (const action of builtInActions) {
      BuiltInAiActionRegistry.register(action)
    }

    // Panel schema (ORM + driver-specific)
    const schemaDir = new URL(/* @vite-ignore */ '../schema', import.meta.url).pathname
    this.publishes([
      { from: `${schemaDir}/panels.prisma`,            to: 'prisma/schema',   tag: 'panels-schema', orm: 'prisma' as const },
      { from: `${schemaDir}/panels.drizzle.sqlite.ts`, to: 'database/schema', tag: 'panels-schema', orm: 'drizzle' as const, driver: 'sqlite' as const },
      { from: `${schemaDir}/panels.drizzle.pg.ts`,     to: 'database/schema', tag: 'panels-schema', orm: 'drizzle' as const, driver: 'postgresql' as const },
      { from: `${schemaDir}/panels.drizzle.mysql.ts`,  to: 'database/schema', tag: 'panels-schema', orm: 'drizzle' as const, driver: 'mysql' as const },
    ])

    // Translation override starter — `lang/en/panels.json` (empty by default).
    // Users edit it to override bundled UI strings; missing keys fall back to
    // bundled defaults. Add a `lang/<locale>/panels.json` to introduce a new
    // locale. See `getPanelI18n()` for the resolution chain.
    const langDir = new URL(/* @vite-ignore */ '../lang/en', import.meta.url).pathname
    this.publishes([
      { from: langDir, to: 'lang/en', tag: 'panels-translations' },
    ])
  }

  async boot(): Promise<void> {
    this.publishes({
      from: new URL(/* @vite-ignore */ '../pages', import.meta.url).pathname,
      to:   'pages/(panels)',
      tag:  'panels-pages',
    })

    // Pre-load panel translation overrides from `lang/<locale>/panels.json`
    // (if `@rudderjs/localization` is installed). `getPanelI18n()` is sync,
    // so the override has to be in the localization cache before any panel
    // request is served. Silently no-ops if localization isn't present.
    await preloadPanelTranslations()

    // Register conversation store if Prisma is available
    try {
      const prisma = this.app.make('prisma')
      if (prisma) {
        const { PrismaConversationStore } = await import('./conversation/PrismaConversationStore.js')
        this.app.instance('ai.conversations', new PrismaConversationStore())
      }
    } catch { /* no prisma — conversation persistence unavailable */ }

    const { router } = await import('@rudderjs/router') as {
      router: {
        get(path: string, handler: (req: AppRequest, res: AppResponse) => unknown, mw?: MiddlewareHandler[]): void
        post(path: string, handler: (req: AppRequest, res: AppResponse) => unknown, mw?: MiddlewareHandler[]): void
        put(path: string, handler: (req: AppRequest, res: AppResponse) => unknown, mw?: MiddlewareHandler[]): void
        delete(path: string, handler: (req: AppRequest, res: AppResponse) => unknown, mw?: MiddlewareHandler[]): void
      }
    }

    // Auto-detect session middleware from DI (bound by @rudderjs/session provider)
    let sessionMw: MiddlewareHandler | undefined
    try {
      sessionMw = this.app.make<MiddlewareHandler>('session.middleware')
    } catch (e) { debugWarn('session.autodetect', e) }

    for (const panel of PanelRegistry.all()) {
      const mw = [
        ...(sessionMw ? [sessionMw] : []),
        ...panel.getMiddleware(),
        ...buildPanelMiddleware(panel),
      ]

      mountMetaRoutes(router, panel, mw)
      mountPanelChat(router, panel, mw)

      // Theme: load saved overrides from DB and mount editor routes
      if (panel.getTheme()) {
        const overrides = await loadThemeOverrides(panel)
        if (overrides) panel.setThemeOverrides(overrides)
        if (panel.hasThemeEditor()) {
          mountThemeRoutes(router, panel, mw)
        }
      }

      // Notifications
      if (panel.hasNotifications()) {
        mountNotificationRoutes(router, panel, mw)
      }

      for (const ResourceClass of panel.getResources()) {
        mountResourceRoutes(router, panel, ResourceClass, mw)
      }

      for (const GlobalClass of panel.getGlobals()) {
        mountGlobalRoutes(router, panel, GlobalClass, mw)
      }

      mountDashboardRoutes(router, panel, mw)

      // Boot panel plugins
      for (const plugin of panel.getPlugins()) {
        if (plugin.resolvers) {
          for (const [type, resolver] of Object.entries(plugin.resolvers)) {
            registerResolver(type, resolver)
          }
        }
        if (plugin.boot) await plugin.boot(panel, this.app)
      }
    }
  }
}

// ─── Factory ───────────────────────────────────────────────

import type { Panel as PanelType } from './Panel.js'
import type { Application, ProviderClass } from '@rudderjs/core'

/**
 * Register one or more panels and mount their API routes.
 *
 * An optional second argument accepts an array of extension providers
 * (e.g. `panelsLexical()`). These are dynamically registered during boot
 * via `this.app.register()`, keeping all panels-related wiring in one call.
 *
 * @example
 * import { panels } from '@rudderjs/panels'
 * import { panelsLexical } from '@rudderjs/panels-lexical/server'
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

      // Built-in AI quick actions — see PanelServiceProvider.register() above
      // for the rationale. The factory overrides register() without calling
      // super, so we register here too. Idempotent (later registrations win).
      for (const action of builtInActions) {
        BuiltInAiActionRegistry.register(action)
      }

      const publishedSchemas = new Set<string>()

      for (const panel of panelList) {
        PanelRegistry.register(panel)

        for (const plugin of panel.getPlugins()) {
          // Publish plugin schemas (deduplicated — same schema published once)
          if (plugin.schemas) {
            for (const schema of plugin.schemas) {
              const key = `${schema.from}:${schema.to}:${schema.tag}`
              if (!publishedSchemas.has(key)) {
                publishedSchemas.add(key)
                this.publishes([schema])
              }
            }
          }

          if (plugin.register) plugin.register(panel, this.app)
        }
      }
    }

    override async boot(): Promise<void> {
      // Publish plugin pages (deduplicated)
      const publishedPages = new Set<string>()
      for (const panel of panelList) {
        for (const plugin of panel.getPlugins()) {
          if (plugin.pages && !publishedPages.has(plugin.pages)) {
            publishedPages.add(plugin.pages)
            this.publishes({ from: plugin.pages, to: 'pages/(panels)', tag: 'plugin-pages' })
          }
        }
      }

      // Legacy: register extension providers (e.g. panels-lexical, panels-media)
      if (extensions) {
        for (const ext of extensions) {
          await this.app.register(ext)
        }
      }

      await super.boot()
    }
  }
}
