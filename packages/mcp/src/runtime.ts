import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import type { McpServer } from './McpServer.js'
import type { McpTool, McpToolResult, McpToolReturn, McpToolProgress } from './McpTool.js'
import type { McpResource } from './McpResource.js'
import type { McpPrompt } from './McpPrompt.js'
import { zodToJsonSchema } from './zod-to-json-schema.js'
import { getInjectTokens, getToolAnnotations, getResourceAnnotations, type InjectToken } from './decorators.js'
import type { McpObserverRegistry } from './observers.js'
import { matchUriTemplate } from './uri-template.js'

// Lazy accessor — avoids importing the registry eagerly so the global
// singleton is always the one on `globalThis`, even across SSR re-eval.
let _mcpObs: McpObserverRegistry | null | undefined
function getMcpObservers(): McpObserverRegistry | null {
  if (_mcpObs === undefined) {
    _mcpObs = (globalThis as Record<string, unknown>)['__rudderjs_mcp_observers__'] as McpObserverRegistry | undefined ?? null
  }
  return _mcpObs
}

// @internal — to be replaced by McpServer._tools()/_resources()/_prompts() accessors in PR C of the mcp-quality-audit arc.
function getProtected<T>(server: McpServer, key: string, fallback: T): T {
  return ((server as unknown as Record<string, T>)[key]) ?? fallback
}

/** SDK request handler `extra` shape — minimal; we only use sendNotification. */
type SdkRequestExtra = {
  sendNotification?: (notification: { method: string; params: Record<string, unknown> }) => Promise<void> | void
}

/**
 * Run a tool's `handle()` return value to completion.
 *
 * - Plain `Promise<McpToolResult>` → just await it.
 * - `AsyncGenerator<McpToolProgress, McpToolResult>` → iterate, forwarding each
 *   yield as a `notifications/progress` message to the client (only when the
 *   request supplied a `progressToken` in `_meta`), and resolve to the final
 *   value the generator returns.
 *
 * Errors propagate normally so the outer try/catch handles them.
 */
export async function consumeToolReturn(
  ret: McpToolReturn,
  extra: SdkRequestExtra | undefined,
  meta: Record<string, unknown> | undefined,
): Promise<McpToolResult> {
  // Detect an async generator. Plain Promises don't have Symbol.asyncIterator.
  const maybeIter = ret as unknown as { [Symbol.asyncIterator]?: unknown; next?: unknown }
  const isGenerator = maybeIter
    && typeof maybeIter.next === 'function'
    && typeof maybeIter[Symbol.asyncIterator] === 'function'

  if (!isGenerator) return await (ret as Promise<McpToolResult>)

  const iter = ret as AsyncGenerator<McpToolProgress, McpToolResult, unknown>
  const progressToken = meta?.['progressToken']
  const sendNotification = extra?.sendNotification

  while (true) {
    const next = await iter.next()
    if (next.done) return next.value
    if (progressToken !== undefined && sendNotification) {
      await sendNotification({
        method: 'notifications/progress',
        params: { progressToken, ...next.value },
      })
    }
  }
}

type Ctor<T = unknown> = new (...args: any[]) => T
type RudderContainer = {
  make?: <U>(target: Ctor<U> | string | symbol) => U
}

function getContainer(): RudderContainer | undefined {
  const g = globalThis as Record<string, unknown>
  // `__rudderjs_app__` is the Application singleton (exposes `.make()`).
  // `__rudderjs_instance__` is the RudderJS wrapper (does not).
  return (g['__rudderjs_app__'] as RudderContainer | undefined)
      ?? (g['__rudderjs_instance__'] as RudderContainer | undefined)
}

/**
 * Try to resolve a class via the framework's DI container (auto-injects
 * constructor dependencies). Falls back to plain `new T()` if the container
 * is not available or resolution fails.
 */
function resolveOrConstruct<T>(Ctor: Ctor<T>): T {
  try {
    const container = getContainer()
    if (container?.make) {
      return container.make(Ctor)
    }
  } catch {
    // DI resolution failed — fall back to plain constructor
  }
  return new Ctor()
}

/**
 * Read `design:paramtypes` for the given method and resolve all parameters
 * beyond index 0 from the DI container. Index 0 is reserved for the tool
 * input (or resource params / prompt arguments).
 *
 * Returns an empty array if:
 *   - the method wasn't decorated (no metadata emitted by TS)
 *   - the framework container isn't available
 *   - no extra parameters were declared
 */
export function resolveHandleDeps(instance: object, propertyKey: string): unknown[] {
  // 1) Preferred: explicit tokens from @Handle(Type1, Type2, …). Always works,
  //    no reliance on emitDecoratorMetadata.
  const explicit = getInjectTokens(instance, propertyKey)
  const container = getContainer()

  if (explicit && explicit.length > 0) {
    if (!container?.make) return []
    return explicit.map((token) => {
      try {
        return container.make!(token as Ctor)
      } catch {
        return undefined
      }
    })
  }

  // 2) Fallback: design:paramtypes (requires tsc or a bundler that emits
  //    decorator metadata — notably esbuild/Vite do not).
  const paramTypes = Reflect.getMetadata('design:paramtypes', instance, propertyKey) as
    Ctor[] | undefined
  if (!paramTypes || paramTypes.length <= 1) return []
  if (!container?.make) return []

  const extras: unknown[] = []
  for (let i = 1; i < paramTypes.length; i++) {
    const Type = paramTypes[i]
    if (!Type) { extras.push(undefined); continue }
    try {
      extras.push(container.make(Type))
    } catch {
      extras.push(undefined)
    }
  }
  return extras
}

/**
 * Resolve `shouldRegister?()` for a primitive. Items without the hook are
 * always registered. Awaits async hooks.
 */
export async function isRegistered(item: { shouldRegister?(): boolean | Promise<boolean> }): Promise<boolean> {
  if (!item.shouldRegister) return true
  return Boolean(await item.shouldRegister())
}

export async function filterRegistered<T extends { shouldRegister?(): boolean | Promise<boolean> }>(
  items: T[],
): Promise<T[]> {
  const out: T[] = []
  for (const item of items) {
    if (await isRegistered(item)) out.push(item)
  }
  return out
}

export function createSdkServer(server: McpServer): Server {
  const meta = server.metadata()
  const sdk = new Server(
    { name: meta.name, version: meta.version },
    { capabilities: { tools: {}, resources: {}, prompts: {} } },
  )

  const toolClasses = getProtected<(new (...args: any[]) => McpTool)[]>(server, 'tools', [])
  const resourceClasses = getProtected<(new (...args: any[]) => McpResource)[]>(server, 'resources', [])
  const promptClasses = getProtected<(new (...args: any[]) => McpPrompt)[]>(server, 'prompts', [])

  const tools: McpTool[] = toolClasses.map((T) => resolveOrConstruct(T))
  const resources: McpResource[] = resourceClasses.map((R) => resolveOrConstruct(R))
  const prompts: McpPrompt[] = promptClasses.map((P) => resolveOrConstruct(P))

  // ── Tools ────────────────────────────────────────────────
  sdk.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: (await filterRegistered(tools)).map((t) => {
      const def: Record<string, unknown> = {
        name: t.name(),
        description: t.description(),
        inputSchema: zodToJsonSchema(t.schema()),
      }
      if (t.outputSchema) {
        def['outputSchema'] = zodToJsonSchema(t.outputSchema())
      }
      const annotations = getToolAnnotations(t.constructor)
      if (annotations) {
        def['annotations'] = annotations
      }
      return def
    }),
  }))

  sdk.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const tool = tools.find((t) => t.name() === request.params.name)
    if (!tool || !(await isRegistered(tool))) {
      return { content: [{ type: 'text' as const, text: `Unknown tool: ${request.params.name}` }], isError: true }
    }
    const input = (request.params.arguments ?? {}) as Record<string, unknown>
    const start = performance.now()
    try {
      const extras = resolveHandleDeps(tool, 'handle')
      const ret = tool.handle(input, ...extras as [])
      const result = await consumeToolReturn(ret, extra, request.params._meta)
      getMcpObservers()?.emit({
        kind: 'tool.called', serverName: meta.name, name: tool.name(),
        input, output: result, duration: performance.now() - start,
      })
      return { ...result }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      getMcpObservers()?.emit({
        kind: 'tool.failed', serverName: meta.name, name: tool.name(),
        input, output: null, duration: performance.now() - start, error: msg,
      })
      return { content: [{ type: 'text' as const, text: `Error: ${msg}` }], isError: true }
    }
  })

  // ── Resources ────────────────────────────────────────────
  const staticResources = resources.filter((r) => !r.isTemplate())
  const templateResources = resources.filter((r) => r.isTemplate())

  function decorateResource(r: McpResource): Record<string, unknown> {
    const def: Record<string, unknown> = {
      uri: r.uri(),
      name: r.uri(),
      description: r.description(),
      mimeType: r.mimeType(),
    }
    const annotations = getResourceAnnotations(r.constructor)
    if (annotations) {
      def['annotations'] = annotations
    }
    return def
  }

  sdk.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: (await filterRegistered(staticResources)).map(decorateResource),
  }))

  if (templateResources.length > 0) {
    sdk.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
      resourceTemplates: (await filterRegistered(templateResources)).map((r) => {
        const def: Record<string, unknown> = {
          uriTemplate: r.uri(),
          name: r.uri(),
          description: r.description(),
          mimeType: r.mimeType(),
        }
        const annotations = getResourceAnnotations(r.constructor)
        if (annotations) {
          def['annotations'] = annotations
        }
        return def
      }),
    }))
  }

  sdk.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const uri = request.params.uri

    // Try exact match first (static resources)
    let resource = staticResources.find((r) => r.uri() === uri)
    let params: Record<string, string> | undefined

    // Try template match
    if (!resource) {
      for (const tmpl of templateResources) {
        const extracted = matchUriTemplate(tmpl.uri(), uri)
        if (extracted) {
          resource = tmpl
          params = extracted
          break
        }
      }
    }

    if (!resource || !(await isRegistered(resource))) {
      throw new Error(`Unknown resource: ${uri}`)
    }
    const start = performance.now()
    try {
      const extras = resolveHandleDeps(resource, 'handle')
      const text = await resource.handle(params, ...extras as [])
      getMcpObservers()?.emit({
        kind: 'resource.read', serverName: meta.name, name: resource.uri(),
        input: params ?? { uri }, output: text, duration: performance.now() - start,
      })
      return {
        contents: [{ uri, text, mimeType: resource.mimeType() }],
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      getMcpObservers()?.emit({
        kind: 'resource.failed', serverName: meta.name, name: resource.uri(),
        input: params ?? { uri }, output: null, duration: performance.now() - start, error: msg,
      })
      throw err
    }
  })

  // ── Prompts ──────────────────────────────────────────────
  sdk.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: (await filterRegistered(prompts)).map((p) => ({
      name: p.name(),
      description: p.description(),
      ...(p.arguments ? { arguments: Object.keys(p.arguments().shape as Record<string, unknown>).map((k) => ({ name: k, required: true })) } : {}),
    })),
  }))

  sdk.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const prompt = prompts.find((p) => p.name() === request.params.name)
    if (!prompt || !(await isRegistered(prompt))) {
      throw new Error(`Unknown prompt: ${request.params.name}`)
    }
    const args = (request.params.arguments ?? {}) as Record<string, unknown>
    const start = performance.now()
    try {
      const extras = resolveHandleDeps(prompt, 'handle')
      const messages = await prompt.handle(args, ...extras as [])
      getMcpObservers()?.emit({
        kind: 'prompt.rendered', serverName: meta.name, name: prompt.name(),
        input: args, output: messages, duration: performance.now() - start,
      })
      return { messages }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      getMcpObservers()?.emit({
        kind: 'prompt.failed', serverName: meta.name, name: prompt.name(),
        input: args, output: null, duration: performance.now() - start, error: msg,
      })
      throw err
    }
  })

  return sdk
}

/** Start a server with stdio transport */
export async function startStdio(server: McpServer): Promise<void> {
  const sdk = createSdkServer(server)
  const transport = new StdioServerTransport()
  await sdk.connect(transport)
  // Stdio is process-lifetime — no detach needed; the SDK lives until exit.
  server.attachSdk(sdk)
}

// ─── HTTP Transport ─────────────────────────────────────

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
