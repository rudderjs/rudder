import type { IncomingMessage, ServerResponse } from 'node:http'
import { Mcp } from '../Mcp.js'
import type { McpServer } from '../McpServer.js'
import type { McpTool } from '../McpTool.js'
import type { McpResource } from '../McpResource.js'
import type { McpPrompt } from '../McpPrompt.js'
import { zodToJsonSchema } from '../zod-to-json-schema.js'
import { resolveHandleDeps } from '../runtime.js'
import { INSPECTOR_HTML } from './inspector-ui.js'

export interface InspectorOptions {
  port?: number
}

export async function startInspector(options: InspectorOptions = {}): Promise<void> {
  const port = options.port ?? 9100
  const { createServer } = await import('node:http')

  const server = createServer(async (req, res) => {
    try {
      await handle(req, res)
    } catch (err) {
      sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) })
    }
  })

  await new Promise<void>((resolve) => {
    server.listen(port, () => {
      console.log(`  MCP Inspector — http://localhost:${port}`)
      console.log('  Ctrl-C to exit.')
      resolve()
    })
  })
}

// ─── request dispatch ────────────────────────────────────

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
  const method = req.method ?? 'GET'
  const path = url.pathname

  if (method === 'GET' && path === '/') {
    res.statusCode = 200
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.end(INSPECTOR_HTML)
    return
  }

  if (method === 'GET' && path === '/api/servers') {
    sendJson(res, 200, listServers())
    return
  }

  const toolMatch = /^\/api\/servers\/([^/]+)\/tools\/([^/]+)$/.exec(path)
  if (method === 'POST' && toolMatch) {
    const [, key, toolName] = toolMatch
    const input = await readJson(req)
    const entry = resolveServer(decodeURIComponent(key!))
    if (!entry) return sendJson(res, 404, { error: `Unknown server "${key}"` })
    const result = await callTool(entry, decodeURIComponent(toolName!), input as Record<string, unknown>)
    sendJson(res, 200, result)
    return
  }

  const readMatch = /^\/api\/servers\/([^/]+)\/resource$/.exec(path)
  if (method === 'GET' && readMatch) {
    const [, key] = readMatch
    const uri = url.searchParams.get('uri')
    if (!uri) return sendJson(res, 400, { error: 'uri query param required' })
    const entry = resolveServer(decodeURIComponent(key!))
    if (!entry) return sendJson(res, 404, { error: `Unknown server "${key}"` })
    const result = await readResource(entry, uri)
    sendJson(res, 200, result)
    return
  }

  const promptMatch = /^\/api\/servers\/([^/]+)\/prompts\/([^/]+)$/.exec(path)
  if (method === 'POST' && promptMatch) {
    const [, key, promptName] = promptMatch
    const args = await readJson(req)
    const entry = resolveServer(decodeURIComponent(key!))
    if (!entry) return sendJson(res, 404, { error: `Unknown server "${key}"` })
    const result = await getPrompt(entry, decodeURIComponent(promptName!), args as Record<string, unknown>)
    sendJson(res, 200, result)
    return
  }

  const detailMatch = /^\/api\/servers\/([^/]+)$/.exec(path)
  if (method === 'GET' && detailMatch) {
    const [, key] = detailMatch
    const entry = resolveServer(decodeURIComponent(key!))
    if (!entry) return sendJson(res, 404, { error: `Unknown server "${key}"` })
    sendJson(res, 200, describeServer(entry))
    return
  }

  sendJson(res, 404, { error: 'Not found' })
}

// ─── registry access ─────────────────────────────────────

type ServerEntry = {
  key:    string
  kind:   'web' | 'local'
  label:  string
  Server: new () => McpServer
}

function listServers(): { web: ServerEntry[]; local: ServerEntry[] } {
  const web: ServerEntry[] = []
  for (const [path, { server }] of Mcp.getWebServers()) {
    web.push({ key: `web:${path}`, kind: 'web', label: `${server.name} (${path})`, Server: server })
  }
  const local: ServerEntry[] = []
  for (const [name, server] of Mcp.getLocalServers()) {
    local.push({ key: `local:${name}`, kind: 'local', label: `${server.name} (${name})`, Server: server })
  }
  return {
    web:   web.map((e) => ({ ...e, Server: undefined as never })),
    local: local.map((e) => ({ ...e, Server: undefined as never })),
  }
}

function resolveServer(key: string): ServerEntry | undefined {
  if (key.startsWith('web:')) {
    const path = key.slice(4)
    const entry = Mcp.getWebServers().get(path)
    if (!entry) return undefined
    return { key, kind: 'web', label: `${entry.server.name} (${path})`, Server: entry.server }
  }
  if (key.startsWith('local:')) {
    const name = key.slice(6)
    const Server = Mcp.getLocalServers().get(name)
    if (!Server) return undefined
    return { key, kind: 'local', label: `${Server.name} (${name})`, Server }
  }
  return undefined
}

function getProtected<T>(server: McpServer, key: string, fallback: T): T {
  return ((server as unknown as Record<string, T>)[key]) ?? fallback
}

function instantiateServer(entry: ServerEntry): {
  server:    McpServer
  tools:     McpTool[]
  resources: McpResource[]
  prompts:   McpPrompt[]
} {
  const server = new entry.Server()
  const tools     = getProtected<(new () => McpTool)[]>(server, 'tools', []).map((T) => new T())
  const resources = getProtected<(new () => McpResource)[]>(server, 'resources', []).map((R) => new R())
  const prompts   = getProtected<(new () => McpPrompt)[]>(server, 'prompts', []).map((P) => new P())
  return { server, tools, resources, prompts }
}

function describeServer(entry: ServerEntry): unknown {
  const { server, tools, resources, prompts } = instantiateServer(entry)
  const meta = server.metadata()
  return {
    key:   entry.key,
    kind:  entry.kind,
    label: entry.label,
    metadata: meta,
    tools: tools.map((t) => ({
      name:         t.name(),
      description:  t.description(),
      inputSchema:  zodToJsonSchema(t.schema()),
      ...(t.outputSchema ? { outputSchema: zodToJsonSchema(t.outputSchema()) } : {}),
    })),
    resources: resources.map((r) => ({
      uri:         r.uri(),
      description: r.description(),
      mimeType:    r.mimeType(),
      template:    r.isTemplate(),
    })),
    prompts: prompts.map((p) => ({
      name:        p.name(),
      description: p.description(),
      ...(p.arguments
        ? { argumentSchema: zodToJsonSchema(p.arguments()) }
        : {}),
    })),
  }
}

async function callTool(entry: ServerEntry, name: string, input: Record<string, unknown>): Promise<unknown> {
  const { tools } = instantiateServer(entry)
  const tool = tools.find((t) => t.name() === name)
  if (!tool) throw new Error(`Tool "${name}" not found on ${entry.label}`)
  const extras = resolveHandleDeps(tool, 'handle')
  return tool.handle(input, ...extras as [])
}

async function readResource(entry: ServerEntry, uri: string): Promise<unknown> {
  const { resources } = instantiateServer(entry)
  const exact = resources.find((r) => !r.isTemplate() && r.uri() === uri)
  if (exact) {
    const extras = resolveHandleDeps(exact, 'handle')
    return { uri, content: await exact.handle(undefined, ...extras as []), mimeType: exact.mimeType() }
  }

  // Try template resources
  for (const tmpl of resources.filter((r) => r.isTemplate())) {
    const params = matchTemplate(tmpl.uri(), uri)
    if (params) {
      const extras = resolveHandleDeps(tmpl, 'handle')
      return { uri, content: await tmpl.handle(params, ...extras as []), mimeType: tmpl.mimeType() }
    }
  }
  throw new Error(`Resource "${uri}" not found`)
}

function matchTemplate(template: string, uri: string): Record<string, string> | null {
  const names: string[] = []
  const regex = template.replace(/\{(\w+)\}/g, (_, name: string) => {
    names.push(name)
    return '([^/]+)'
  })
  const match = uri.match(new RegExp(`^${regex}$`))
  if (!match) return null
  const out: Record<string, string> = {}
  for (let i = 0; i < names.length; i++) out[names[i]!] = decodeURIComponent(match[i + 1]!)
  return out
}

async function getPrompt(entry: ServerEntry, name: string, args: Record<string, unknown>): Promise<unknown> {
  const { prompts } = instantiateServer(entry)
  const prompt = prompts.find((p) => p.name() === name)
  if (!prompt) throw new Error(`Prompt "${name}" not found on ${entry.label}`)
  const extras = resolveHandleDeps(prompt, 'handle')
  return { messages: await prompt.handle(args, ...extras as []) }
}

// ─── http helpers ────────────────────────────────────────

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body, null, 2))
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (!raw) return resolve({})
      try { resolve(JSON.parse(raw)) } catch (e) { reject(e) }
    })
    req.on('error', reject)
  })
}
