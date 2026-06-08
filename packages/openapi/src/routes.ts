import type { AppRequest, AppResponse } from '@rudderjs/contracts'
import { generateOpenApiDocument, type GenerateOptions } from './emitter.js'
import { resolveDocInfo } from './doc-info.js'
import { swaggerUiHtml } from './swagger-ui.js'
import type { RouterLike } from './types.js'

/** The router surface `registerOpenApiRoutes` needs: read the table + add GETs. */
export interface OpenApiRouter extends RouterLike {
  get(path: string, handler: (req: AppRequest, res: AppResponse) => unknown): unknown
}

export interface OpenApiRouteOptions {
  /** Path for the Swagger UI page. Default `/docs`. */
  path?: string
  /** Path the spec JSON is served at. Default `/openapi.json`. */
  specPath?: string
  /** Document info (title/version/servers). When omitted, read from `config('openapi')`. */
  info?: Partial<GenerateOptions>
}

/**
 * Mount two GET routes — the spec JSON and a Swagger UI page that loads it.
 * **Opt-in by design**: the {@link OpenApiProvider} never calls this. Apps mount
 * it explicitly and SHOULD gate it behind auth in production (an open `/docs`
 * exposes your full API surface).
 *
 * @example
 * // routes/api.ts (or behind an auth middleware group)
 * registerOpenApiRoutes(router)
 * registerOpenApiRoutes(router, { path: '/api-docs', specPath: '/api-docs/spec.json' })
 */
export function registerOpenApiRoutes(router: OpenApiRouter, options: OpenApiRouteOptions = {}): void {
  const docsPath = options.path ?? '/docs'
  const specPath = options.specPath ?? '/openapi.json'

  router.get(specPath, async (_req, res) => {
    const info = await resolveDocInfo(options.info)
    // Generate from the live table, minus our own two routes so the docs don't
    // document themselves.
    const doc = generateOpenApiDocument(excludePaths(router, [docsPath, specPath]), info)
    res.json(doc)
  })

  router.get(docsPath, (_req, res) => {
    res.header('Content-Type', 'text/html; charset=utf-8').send(swaggerUiHtml(specPath, options.info?.title ?? 'API Docs'))
  })
}

/** Wrap a router so its `list()` hides the OpenAPI plumbing routes. */
function excludePaths(router: RouterLike, paths: string[]): RouterLike {
  const blocked = new Set(paths)
  return { list: () => router.list().filter(def => !blocked.has(def.path)) }
}
