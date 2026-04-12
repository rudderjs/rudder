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

/**
 * Try to resolve a class via the framework's DI container (auto-injects
 * constructor dependencies). Falls back to plain `new T()` if the container
 * is not available or resolution fails.
 */
function resolveOrConstruct<T>(Ctor: new (...args: any[]) => T): T {
  try {
    const container = (globalThis as Record<string, unknown>)['__rudderjs_instance__'] as
      { make?: <U>(target: new (...args: any[]) => U) => U } | undefined
    if (container?.make) {
      return container.make(Ctor)
    }
  } catch {
    // DI resolution failed — fall back to plain constructor
  }
  return new Ctor()
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
      const result = await tool.handle((request.params.arguments ?? {}) as Record<string, unknown>)
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
    return {
      contents: [{
        uri,
        text: await resource.handle(params),
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
    return { messages: await prompt.handle((request.params.arguments ?? {}) as Record<string, unknown>) }
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

  // Import the router at runtime (same pattern as Telescope).
  // Dynamic import avoids a hard dependency on @rudderjs/router.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const routerMod = await import(/* webpackIgnore: true */ '@rudderjs/router' as any) as {
    router: {
      all: (path: string, handler: (req: unknown, res: unknown) => unknown, middleware?: unknown[]) => unknown
    }
  }
  const { router } = routerMod

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
