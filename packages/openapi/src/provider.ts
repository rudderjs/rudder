import { ServiceProvider, config } from '@rudderjs/core'
import type { OpenApiConfig } from './types.js'

/**
 * Wires `@rudderjs/openapi` into an app. **Deliberately minimal**: it normalizes
 * `config('openapi')` and binds it for retrieval, but does NOT register the
 * Swagger UI / spec routes — exposing the API surface is an explicit opt-in
 * (`registerOpenApiRoutes`), never automatic (security).
 *
 * Auto-discovery is OFF for this package (`rudderjs.autoDiscover: false` in
 * `package.json`), so docs are never served unless the app asks. Add it by hand
 * to `bootstrap/providers.ts` if you want the bound config:
 *
 * @example
 * import { OpenApiProvider } from '@rudderjs/openapi'
 * export default [...(await defaultProviders()), OpenApiProvider]
 */
export class OpenApiProvider extends ServiceProvider {
  register(): void {
    this.app.instance('openapi.config', this.resolveConfig())
  }

  private resolveConfig(): OpenApiConfig {
    let cfg: OpenApiConfig = {}
    try {
      cfg = (config('openapi', {}) as OpenApiConfig) ?? {}
    } catch {
      // No config bag bound — defaults are fine.
    }
    return {
      title:    cfg.title    ?? 'API',
      version:  cfg.version  ?? '1.0.0',
      docsPath: cfg.docsPath ?? '/docs',
      specPath: cfg.specPath ?? '/openapi.json',
      ...(cfg.description !== undefined ? { description: cfg.description } : {}),
      ...(cfg.servers !== undefined ? { servers: cfg.servers } : {}),
    }
  }
}
