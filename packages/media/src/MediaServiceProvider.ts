import { ServiceProvider } from '@boostkit/core'
import type { MiddlewareHandler, AppRequest, AppResponse } from '@boostkit/core'
import type { MediaConfig } from './types.js'
import { mountMediaRoutes } from './handlers/mediaRoutes.js'
import { resolveMedia } from './resolveMedia.js'

/**
 * @deprecated Use `media()` as a PanelPlugin with `Panel.use(media())` instead.
 * Kept for backward compatibility with the `panels([...], [extensions])` pattern.
 */
export class MediaServiceProvider extends ServiceProvider {
  protected config: MediaConfig = {}

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
    const { router } = await import(/* @vite-ignore */ '@boostkit/router') as { router: RouterShape }
    const { PanelRegistry } = await import(/* @vite-ignore */ '@boostkit/panels')
    for (const panel of PanelRegistry.all()) {
      const mw: MiddlewareHandler[] = []
      const guard = panel.getGuard()
      if (guard) mw.push(guard as unknown as MiddlewareHandler)
      mountMediaRoutes(router, panel.getApiBase(), this.config, mw)
    }
  }
}

// ─── PanelPlugin factory ────────────────────────────────────

import type { Application, ProviderClass } from '@boostkit/core'
import type { PanelPlugin } from '@boostkit/panels'

const schemaDir = new URL(/* @vite-ignore */ '../schema', import.meta.url).pathname
const pagesDir  = new URL(/* @vite-ignore */ '../pages', import.meta.url).pathname

/**
 * Register the media library as a panel plugin.
 *
 * @example
 * ```ts
 * import { media } from '@boostkit/media/server'
 *
 * Panel.make('admin')
 *   .use(media({ conversions: [{ name: 'thumb', width: 200, format: 'webp' }] }))
 * ```
 */
export function media(config?: MediaConfig): PanelPlugin {
  return {
    schemas: [
      { from: `${schemaDir}/media.prisma`, to: 'prisma/schema', tag: 'media-schema', orm: 'prisma' as const },
    ],
    pages: pagesDir,
    resolvers: { media: resolveMedia },

    async boot(panel) {
      type RouteHandler = (req: AppRequest, res: AppResponse) => unknown
      interface RouterShape {
        get(path: string, handler: RouteHandler, mw?: MiddlewareHandler[]): void
        post(path: string, handler: RouteHandler, mw?: MiddlewareHandler[]): void
        put(path: string, handler: RouteHandler, mw?: MiddlewareHandler[]): void
        delete(path: string, handler: RouteHandler, mw?: MiddlewareHandler[]): void
      }
      const { router } = await import(/* @vite-ignore */ '@boostkit/router') as { router: RouterShape }

      const mw: MiddlewareHandler[] = []
      const guard = panel.getGuard()
      if (guard) mw.push(guard as unknown as MiddlewareHandler)

      mountMediaRoutes(router, panel.getApiBase(), config ?? {}, mw)
    },
  }
}

/**
 * @deprecated Use `media()` directly with `Panel.use(media())`.
 * Legacy factory for the `panels([...], [extensions])` pattern.
 */
export function mediaExtension(config?: MediaConfig): ProviderClass {
  return class MediaProvider extends MediaServiceProvider {
    constructor(app: Application) {
      super(app)
      this.config = config ?? {}
    }
  }
}
