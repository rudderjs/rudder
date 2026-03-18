import { ServiceProvider } from '@boostkit/core'
import type { MiddlewareHandler, AppRequest, AppResponse } from '@boostkit/core'
import type { MediaConfig } from './types.js'
import { mountMediaRoutes } from './handlers/mediaRoutes.js'

export class MediaServiceProvider extends ServiceProvider {
  protected config: MediaConfig = {}
  protected panelApiBase = ''

  register(): void {
    // Publish Prisma schema
    const schemaDir = new URL(/* @vite-ignore */ '../schema', import.meta.url).pathname
    this.publishes([
      { from: `${schemaDir}/media.prisma`, to: 'prisma/schema', tag: 'media-schema', orm: 'prisma' as const },
    ])
  }

  async boot(): Promise<void> {
    // Publish pages
    this.publishes({
      from: new URL(/* @vite-ignore */ '../pages', import.meta.url).pathname,
      to: 'pages/(panels)',
      tag: 'media-pages',
    })

    // Mount API routes
    type RouteHandler = (req: AppRequest, res: AppResponse) => unknown
    interface RouterShape {
      get(path: string, handler: RouteHandler, mw?: MiddlewareHandler[]): void
      post(path: string, handler: RouteHandler, mw?: MiddlewareHandler[]): void
      put(path: string, handler: RouteHandler, mw?: MiddlewareHandler[]): void
      delete(path: string, handler: RouteHandler, mw?: MiddlewareHandler[]): void
    }
    const routerPkg = '@boostkit/router'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const routerMod = await (import(/* @vite-ignore */ routerPkg) as Promise<any>)
    const router = routerMod.router as RouterShape

    // Mount for each registered panel
    const { PanelRegistry } = await import(/* @vite-ignore */ '@boostkit/panels')
    for (const panel of PanelRegistry.all()) {
      const mw: MiddlewareHandler[] = []
      const guard = panel.getGuard()
      if (guard) mw.push(guard as unknown as MiddlewareHandler)

      mountMediaRoutes(router, panel.getApiBase(), this.config, mw)
    }
  }
}

// ─── Factory ────────────────────────────────────────────────

import type { Application, ProviderClass } from '@boostkit/core'

/**
 * Register the media library as a panels extension.
 *
 * @example
 * ```ts
 * import { panels } from '@boostkit/panels'
 * import { media } from '@boostkit/media/server'
 *
 * panels([adminPanel], [media()])
 * // or:
 * panels([adminPanel], [media({ conversions: [{ name: 'thumb', width: 200, height: 200, format: 'webp' }] })])
 * ```
 */
export function media(config?: MediaConfig): ProviderClass {
  return class MediaProvider extends MediaServiceProvider {
    constructor(app: Application) {
      super(app)
      this.config = config ?? {}
    }
  }
}
