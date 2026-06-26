import type { McpServer } from '@gemstack/mcp'
import { createWebRequestHandler } from '@gemstack/mcp/runtime'

export interface HttpTransportOptions {
  /** Middleware to apply before MCP request handling. */
  middleware?: unknown[]
  /** Session-id generator. Pass `undefined` explicitly for stateless mode. */
  sessionIdGenerator?: (() => string) | undefined
}

/**
 * Mount an MCP server on the Rudder router at the given path.
 *
 * The core's framework-neutral `createWebRequestHandler` produces a
 * `(request: Request) => Promise<Response>`; this wraps it onto the Rudder
 * router (Hono adapter), extracting the Web Standard `Request` from the Hono
 * context and writing the `Response` back. The transport handles POST (JSON-RPC),
 * GET (SSE notifications), and DELETE (session termination).
 *
 * `@rudderjs/core` and `@rudderjs/router` are imported dynamically and declared
 * optional peers, so `@rudderjs/mcp` stays consumable in non-server contexts
 * (tests, CLI tooling, the inspector).
 */
export async function mountHttpTransport(
  server: McpServer,
  path: string,
  options?: HttpTransportOptions,
): Promise<void> {
  const handle = createWebRequestHandler(
    server,
    options && 'sessionIdGenerator' in options
      ? { sessionIdGenerator: options.sessionIdGenerator }
      : undefined,
  )

  const { resolveOptionalPeer } = await import('@rudderjs/core')
  const { router } = await resolveOptionalPeer<{
    router: {
      all: (path: string, handler: (req: unknown, res: unknown) => unknown, middleware?: unknown[]) => unknown
    }
  }>('@rudderjs/router')

  const middleware = options?.middleware as
    ((req: unknown, res: unknown, next: () => Promise<void>) => void | Promise<void>)[] | undefined

  router.all(path, async (req: unknown) => {
    // The Rudder (Hono) request exposes the raw Hono context at `.raw`, whose
    // `.req.raw` is the Web Standard Request. Hand it to the core handler and
    // write the returned Response straight back onto the Hono context.
    const honoCtx = (req as { raw: { req: { raw: Request }; res: Response } }).raw
    const response = await handle(honoCtx.req.raw)
    honoCtx.res = response
    return honoCtx.res
  }, middleware)
}
