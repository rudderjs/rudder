import type { Server } from '@modelcontextprotocol/sdk/server/index.js'
import type { McpServer } from '../McpServer.js'
import { createSdkServer } from './sdk-server.js'

export interface HttpTransportOptions {
  /** Middleware to apply before MCP request handling */
  middleware?: unknown[]
  /** Generate session IDs for stateful mode. Set to undefined for stateless. */
  sessionIdGenerator?: (() => string) | undefined
}

/**
 * Mount an MCP server on the framework's router at the given path.
 *
 * Uses the MCP SDK's `WebStandardStreamableHTTPServerTransport` which
 * accepts Web Standard `Request` objects and returns `Response` — a
 * natural fit for Hono (the framework's server adapter).
 *
 * The transport handles all three HTTP methods:
 * - POST — JSON-RPC messages (initialization + ongoing)
 * - GET  — SSE stream for server-initiated notifications
 * - DELETE — session termination
 *
 * ### Session lifecycle
 *
 * **Stateless mode** (`sessionIdGenerator: undefined`) — one transport + SDK
 * pair is created lazily on the first request and reused for the lifetime of
 * the route. `server.attachSdk(sdk)` is called once and never detached.
 *
 * **Stateful mode** (default — `crypto.randomUUID`) — each new client gets a
 * fresh transport + SDK pair. The pair is stored in `sessions` only after the
 * SDK fires `onsessioninitialized` (i.e., the client's initialize handshake
 * succeeded). On `onsessionclosed`, both the session entry and the SDK's
 * notification attachment are torn down. The `detach` closure exists so the
 * `onsessionclosed` callback can release the attached SDK without holding a
 * stale reference — `let detach = () => {}` reads as a placeholder because we
 * can only obtain the real detacher after `attachSdk` has been called on the
 * already-constructed transport.
 *
 * ### Circular-dep avoidance
 *
 * `@rudderjs/core` and `@rudderjs/router` are imported dynamically. The
 * package's `peerDependenciesMeta` marks both as optional, and the runtime
 * import is what keeps `@rudderjs/mcp` consumable in non-server environments
 * (tests, CLI tooling, the inspector itself).
 */
export async function mountHttpTransport(
  server: McpServer,
  path: string,
  options?: HttpTransportOptions,
): Promise<void> {
  const { WebStandardStreamableHTTPServerTransport } = await import(
    '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
  )

  // Session map: each session gets its own transport + SDK server pair.
  // For stateless mode, a single transport is reused.
  const sessions = new Map<string, { transport: InstanceType<typeof WebStandardStreamableHTTPServerTransport>; sdk: Server }>()

  const sessionIdGen = options?.sessionIdGenerator !== undefined
    ? options.sessionIdGenerator
    : () => crypto.randomUUID()

  const { resolveOptionalPeer } = await import('@rudderjs/core')
  const { router } = await resolveOptionalPeer<{
    router: {
      all: (path: string, handler: (req: unknown, res: unknown) => unknown, middleware?: unknown[]) => unknown
    }
  }>('@rudderjs/router')

  const middleware = options?.middleware as ((req: unknown, res: unknown, next: () => Promise<void>) => void | Promise<void>)[] | undefined

  router.all(`${path}`, async (req: any, res: any) => {
    // Extract the Hono context → Web Standard Request
    const honoCtx = req.raw
    const nativeRequest: Request = honoCtx.req.raw

    // For stateless mode (no session generator)
    if (!sessionIdGen) {
      let entry = sessions.get('__stateless__')
      if (!entry) {
        const transport = new WebStandardStreamableHTTPServerTransport()
        const sdk = createSdkServer(server)
        await sdk.connect(transport)
        // Stateless transport lives for the lifetime of the route — never detaches.
        server.attachSdk(sdk)
        entry = { transport, sdk }
        sessions.set('__stateless__', entry)
      }
      const response = await entry.transport.handleRequest(nativeRequest)
      honoCtx.res = response
      return honoCtx.res
    }

    // Stateful mode: route by session ID header
    const sessionId = nativeRequest.headers.get('mcp-session-id')

    if (sessionId && sessions.has(sessionId)) {
      // Existing session
      const entry = sessions.get(sessionId)!
      const response = await entry.transport.handleRequest(nativeRequest)
      honoCtx.res = response
      return honoCtx.res
    }

    // New session — create transport + server pair. Detach is captured in a
    // closure so onsessionclosed can call it without holding the SDK ref.
    // Initialize to a noop so the first real assignment counts as a
    // reassignment for ESLint's prefer-const rule.
    let detach: () => void = () => {}
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: sessionIdGen,
      onsessioninitialized: (id: string) => {
        sessions.set(id, { transport, sdk })
      },
      onsessionclosed: (id: string) => {
        sessions.delete(id)
        detach()
      },
    })

    const sdk = createSdkServer(server)
    await sdk.connect(transport)
    detach = server.attachSdk(sdk)

    const response = await transport.handleRequest(nativeRequest)
    honoCtx.res = response
    return honoCtx.res
  }, middleware)
}
