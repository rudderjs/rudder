import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  ListResourcesRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import type { McpServer } from './McpServer.js'
import type { McpTool } from './McpTool.js'
import type { McpResource } from './McpResource.js'
import type { McpPrompt } from './McpPrompt.js'
import { zodToJsonSchema } from './zod-to-json-schema.js'

function getProtected<T>(server: McpServer, key: string, fallback: T): T {
  return ((server as unknown as Record<string, T>)[key]) ?? fallback
}

export function createSdkServer(server: McpServer): Server {
  const meta = server.metadata()
  const sdk = new Server(
    { name: meta.name, version: meta.version },
    { capabilities: { tools: {}, resources: {}, prompts: {} } },
  )

  const toolClasses = getProtected<(new () => McpTool)[]>(server, 'tools', [])
  const resourceClasses = getProtected<(new () => McpResource)[]>(server, 'resources', [])
  const promptClasses = getProtected<(new () => McpPrompt)[]>(server, 'prompts', [])

  const tools: McpTool[] = toolClasses.map((T) => new T())
  const resources: McpResource[] = resourceClasses.map((R) => new R())
  const prompts: McpPrompt[] = promptClasses.map((P) => new P())

  // ── Tools ────────────────────────────────────────────────
  sdk.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => ({
      name: t.name(),
      description: t.description(),
      inputSchema: zodToJsonSchema(t.schema()),
    })),
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
  sdk.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: resources.map((r) => ({
      uri: r.uri(),
      name: r.uri(),
      description: r.description(),
      mimeType: r.mimeType(),
    })),
  }))

  sdk.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const resource = resources.find((r) => r.uri() === request.params.uri)
    if (!resource) {
      throw new Error(`Unknown resource: ${request.params.uri}`)
    }
    return {
      contents: [{
        uri: resource.uri(),
        text: await resource.handle(),
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
