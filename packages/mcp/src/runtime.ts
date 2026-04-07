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

// TODO: Add createHttpHandler once StreamableHTTPServerTransport / SSEServerTransport
// integration pattern is finalized. The low-level Server class requires manual transport wiring.
