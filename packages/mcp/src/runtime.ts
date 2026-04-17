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
import type { McpTool } from './McpTool.js'
import type { McpResource } from './McpResource.js'
import type { McpPrompt } from './McpPrompt.js'
import { zodToJsonSchema } from './zod-to-json-schema.js'
import { getInjectTokens, type InjectToken } from './decorators.js'

/**
 * Match a URI against a template pattern like `weather://location/{city}`.
 * Returns extracted params or null if no match.
 */
function matchUriTemplate(template: string, uri: string): Record<string, string> | null {
  // Convert `weather://location/{city}` → regex `^weather://location/(?<city>[^/]+)$`
  const paramNames: string[] = []
  const regexStr = template.replace(/\{(\w+)\}/g, (_, name: string) => {
    paramNames.push(name)
    return '([^/]+)'
  })
  const match = uri.match(new RegExp(`^${regexStr}$`))
  if (!match) return null
  const params: Record<string, string> = {}
  for (let i = 0; i < paramNames.length; i++) {
    params[paramNames[i]!] = decodeURIComponent(match[i + 1]!)
  }
  return params
}

function getProtected<T>(server: McpServer, key: string, fallback: T): T {
  return ((server as unknown as Record<string, T>)[key]) ?? fallback
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
    tools: tools.map((t) => {
      const def: Record<string, unknown> = {
        name: t.name(),
        description: t.description(),
        inputSchema: zodToJsonSchema(t.schema()),
      }
      if (t.outputSchema) {
        def['outputSchema'] = zodToJsonSchema(t.outputSchema())
      }
      return def
    }),
  }))

  sdk.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = tools.find((t) => t.name() === request.params.name)
    if (!tool) {
      return { content: [{ type: 'text' as const, text: `Unknown tool: ${request.params.name}` }], isError: true }
    }
    try {
      const input = (request.params.arguments ?? {}) as Record<string, unknown>
      const extras = resolveHandleDeps(tool, 'handle')
      const result = await tool.handle(input, ...extras as [])
      return { ...result }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { content: [{ type: 'text' as const, text: `Error: ${msg}` }], isError: true }
    }
  })

  // ── Resources ────────────────────────────────────────────
  const staticResources = resources.filter((r) => !r.isTemplate())
  const templateResources = resources.filter((r) => r.isTemplate())

  sdk.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: staticResources.map((r) => ({
      uri: r.uri(),
      name: r.uri(),
      description: r.description(),
      mimeType: r.mimeType(),
    })),
  }))

  if (templateResources.length > 0) {
    sdk.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
      resourceTemplates: templateResources.map((r) => ({
        uriTemplate: r.uri(),
        name: r.uri(),
        description: r.description(),
        mimeType: r.mimeType(),
      })),
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

    if (!resource) {
      throw new Error(`Unknown resource: ${uri}`)
    }
    const extras = resolveHandleDeps(resource, 'handle')
    return {
      contents: [{
        uri,
        text: await resource.handle(params, ...extras as []),
        mimeType: resource.mimeType(),
      }],
    }
  })

  // ── Prompts ──────────────────────────────────────────────
  sdk.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: prompts.map((p) => ({
      name: p.name(),
      description: p.description(),
      ...(p.arguments ? { arguments: Object.keys(p.arguments().shape as Record<string, unknown>).map((k) => ({ name: k, required: true })) } : {}),
    })),
  }))

  sdk.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const prompt = prompts.find((p) => p.name() === request.params.name)
    if (!prompt) {
      throw new Error(`Unknown prompt: ${request.params.name}`)
    }
    const args = (request.params.arguments ?? {}) as Record<string, unknown>
    const extras = resolveHandleDeps(prompt, 'handle')
    return { messages: await prompt.handle(args, ...extras as []) }
  })

  return sdk
}

/** Start a server with stdio transport */
export async function startStdio(server: McpServer): Promise<void> {
  const sdk = createSdkServer(server)
  const transport = new StdioServerTransport()
  await sdk.connect(transport)
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

    // New session — create transport + server pair
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: sessionIdGen,
      onsessioninitialized: (id: string) => {
        sessions.set(id, { transport, sdk })
      },
      onsessionclosed: (id: string) => {
        sessions.delete(id)
      },
    })

    const sdk = createSdkServer(server)
    await sdk.connect(transport)

    const response = await transport.handleRequest(nativeRequest)
    honoCtx.res = response
    return honoCtx.res
  }, middleware)
}
