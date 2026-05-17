import type { McpServer } from './McpServer.js'
import type { OAuth2McpOptions } from './auth/oauth2.js'

type ServerClass = new () => McpServer

export interface McpWebEntry {
  server: ServerClass
  middleware: unknown[]
  /** Set when `.oauth2()` was chained on the builder. */
  oauth2?: OAuth2McpOptions
}

export interface McpWebBuilder {
  /** Add middleware to this web MCP endpoint. */
  middleware(mw: unknown[]): McpWebBuilder
  /**
   * Protect this endpoint with OAuth 2.1 bearer tokens. Registers an RFC 9728
   * Protected Resource Metadata endpoint alongside it.
   *
   * Requires `@rudderjs/passport` to be installed (used as the authorization
   * server and token validator).
   */
  oauth2(options?: OAuth2McpOptions): McpWebBuilder
}

/**
 * Shared singleton store routed through `globalThis` so the registry survives
 * the case where `@rudderjs/mcp` is loaded twice — typical in a Vite-bundled
 * server where the framework bundles `@rudderjs/mcp` inline but
 * `McpProvider.boot()` and any `Mcp.web()` / `Mcp.local()` calls in
 * `routes/console.ts` / `app/Mcp/...` run from a `node_modules` copy resolved
 * via the provider auto-discovery manifest. Without a shared store, servers
 * registered from the externalized copy would never be visible to the route
 * mounter reading the bundled copy — every `/mcp/*` request would 404.
 *
 * Defensive migration per the #499 static-state singleton audit (the
 * `__rudderjs_mcp_observers__` registry was already migrated as part of the
 * observer-registry pattern; this completes the package). Same pattern as
 * PR #498 (`@rudderjs/orm` `ModelRegistry`), #500–#505 (pennant, cache,
 * queue, mail, storage, hash).
 */
interface McpServersStore {
  web: Map<string, McpWebEntry>
  local: Map<string, ServerClass>
}

const _g = globalThis as Record<string, unknown>
if (!_g['__rudderjs_mcp_servers__']) {
  _g['__rudderjs_mcp_servers__'] = {
    web: new Map<string, McpWebEntry>(),
    local: new Map<string, ServerClass>(),
  } satisfies McpServersStore
}
const _store = _g['__rudderjs_mcp_servers__'] as McpServersStore

export class Mcp {
  /** Register an MCP server on an HTTP endpoint (Streamable HTTP transport) */
  static web(path: string, server: ServerClass, middleware: unknown[] = []): McpWebBuilder {
    const entry: McpWebEntry = { server, middleware }
    _store.web.set(path, entry)
    const builder: McpWebBuilder = {
      middleware(mw: unknown[]) {
        entry.middleware.push(...mw)
        return builder
      },
      oauth2(options: OAuth2McpOptions = {}) {
        entry.oauth2 = options
        return builder
      },
    }
    return builder
  }

  /** Register an MCP server as a local CLI command (stdio transport) */
  static local(name: string, server: ServerClass): void {
    _store.local.set(name, server)
  }

  static getWebServers(): Map<string, McpWebEntry> { return _store.web }
  static getLocalServers(): Map<string, ServerClass> { return _store.local }
}
