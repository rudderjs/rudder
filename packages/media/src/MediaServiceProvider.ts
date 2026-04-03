import { ServiceProvider } from '@rudderjs/core'
import type { MiddlewareHandler, AppRequest, AppResponse } from '@rudderjs/core'
import { mountMediaRoutes } from './handlers/mediaRoutes.js'
import { resolveMedia } from './resolveMedia.js'
import { registerLibrary, type MediaLibrary } from './registry.js'

/**
 * @deprecated Use `media()` as a PanelPlugin with `Panel.use(media())` instead.
 */
export class MediaServiceProvider extends ServiceProvider {
  register(): void {
    const schemaDir = new URL(/* @vite-ignore */ '../schema', import.meta.url).pathname
    this.publishes([
      { from: `${schemaDir}/media.prisma`, to: 'prisma/schema', tag: 'media-schema', orm: 'prisma' as const },
    ])
  }

  async boot(): Promise<void> {
    this.publishes({
      from: new URL(/* @vite-ignore */ '../pages', import.meta.url).pathname,
      to: 'pages/(panels)',
      tag: 'media-pages',
    })

    type RouteHandler = (req: AppRequest, res: AppResponse) => unknown
    interface RouterShape {
      get(path: string, handler: RouteHandler, mw?: MiddlewareHandler[]): void
      post(path: string, handler: RouteHandler, mw?: MiddlewareHandler[]): void
      put(path: string, handler: RouteHandler, mw?: MiddlewareHandler[]): void
      delete(path: string, handler: RouteHandler, mw?: MiddlewareHandler[]): void
    }
    const { router } = await import(/* @vite-ignore */ '@rudderjs/router') as { router: RouterShape }
    const { PanelRegistry } = await import(/* @vite-ignore */ '@rudderjs/panels')
    for (const panel of PanelRegistry.all()) {
      const mw: MiddlewareHandler[] = []
      const guard = panel.getGuard()
      if (guard) mw.push(guard as unknown as MiddlewareHandler)
      mountMediaRoutes(router, panel.getApiBase(), mw)
    }
  }
}

// ─── PanelPlugin factory ────────────────────────────────────

import type { Application, ProviderClass } from '@rudderjs/core'
import type { PanelPlugin } from '@rudderjs/panels'

const schemaDir = new URL(/* @vite-ignore */ '../schema', import.meta.url).pathname
const pagesDir  = new URL(/* @vite-ignore */ '../pages', import.meta.url).pathname

/**
 * Media plugin config.
 *
 * **Simple** (single default library):
 * ```ts
 * media({ disk: 'public', directory: 'media', conversions: [...] })
 * ```
 *
 * **Named libraries**:
 * ```ts
 * media({
 *   libraries: {
 *     photos:    { disk: 'public', directory: 'photos', accept: ['image/*'], conversions: [...] },
 *     documents: { disk: 'public', directory: 'docs',   accept: ['application/pdf'] },
 *   },
 * })
 * ```
 *
 * **No config** (default library: disk='public', directory='media'):
 * ```ts
 * media()
 * ```
 */
export interface MediaPluginConfig {
  /** Named media libraries. */
  libraries?: Record<string, MediaLibrary>
  /** Shorthand: single default library config. */
  disk?: string
  directory?: string
  accept?: string[]
  maxUploadSize?: number
  conversions?: MediaLibrary['conversions']
}

export function media(config?: MediaPluginConfig): PanelPlugin {
  return {
    schemas: [
      { from: `${schemaDir}/media.prisma`, to: 'prisma/schema', tag: 'media-schema', orm: 'prisma' as const },
    ],
    pages: pagesDir,
    resolvers: { media: resolveMedia },

    register() {
      // Register libraries in globalThis-backed registry (available at SSR time)
      if (config?.libraries) {
        for (const [name, lib] of Object.entries(config.libraries)) {
          registerLibrary(name, lib)
        }
      }

      // Shorthand config → register as 'default' library
      if (config?.disk || config?.directory || config?.conversions) {
        const lib: MediaLibrary = {
          disk:      config.disk ?? 'public',
          directory: config.directory ?? 'media',
        }
        if (config.accept) lib.accept = config.accept
        if (config.maxUploadSize !== undefined) lib.maxUploadSize = config.maxUploadSize
        if (config.conversions) lib.conversions = config.conversions
        registerLibrary('default', lib)
      }

      // Always ensure a 'default' library exists
      if (!config?.libraries?.['default'] && !config?.disk) {
        registerLibrary('default', { disk: 'public', directory: 'media' })
      }
    },

    async boot(panel) {
      type RouteHandler = (req: AppRequest, res: AppResponse) => unknown
      interface RouterShape {
        get(path: string, handler: RouteHandler, mw?: MiddlewareHandler[]): void
        post(path: string, handler: RouteHandler, mw?: MiddlewareHandler[]): void
        put(path: string, handler: RouteHandler, mw?: MiddlewareHandler[]): void
        delete(path: string, handler: RouteHandler, mw?: MiddlewareHandler[]): void
      }
      const { router } = await import(/* @vite-ignore */ '@rudderjs/router') as { router: RouterShape }

      const mw: MiddlewareHandler[] = []
      const guard = panel.getGuard()
      if (guard) mw.push(guard as unknown as MiddlewareHandler)

      mountMediaRoutes(router, panel.getApiBase(), mw)
    },
  }
}

/**
 * @deprecated Use `media()` directly with `Panel.use(media())`.
 */
export function mediaExtension(): ProviderClass {
  return MediaServiceProvider
}
