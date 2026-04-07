import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { getAppInfo } from './tools/app-info.js'
import { getDbSchema } from './tools/db-schema.js'
import { getConfigValue } from './tools/config-get.js'
import { getRouteList } from './tools/route-list.js'
import { getModelList } from './tools/model-list.js'
import { getLastError } from './tools/last-error.js'
import { executeDbQuery } from './tools/db-query.js'
import { readLogs } from './tools/read-logs.js'
import { readBrowserLogs } from './tools/browser-logs.js'
import { getAbsoluteUrl } from './tools/get-absolute-url.js'

export function createBoostServer(cwd: string): McpServer {
  const server = new McpServer(
    { name: 'rudderjs-boost', version: '0.0.1' },
    { capabilities: { tools: {}, resources: {} } },
  )

  // ── app_info ──────────────────────────────────────────

  server.registerTool('app_info', {
    title: 'Application Info',
    description: 'Get RudderJS application info: installed packages, versions, Node.js version, package manager.',
  }, async () => {
    const info = getAppInfo(cwd)
    return { content: [{ type: 'text' as const, text: JSON.stringify(info, null, 2) }] }
  })

  // ── db_schema ─────────────────────────────────────────

  server.registerTool('db_schema', {
    title: 'Database Schema',
    description: 'Read the Prisma database schema. Returns parsed models with fields and types, plus the raw .prisma content.',
    inputSchema: {
      format: z.enum(['parsed', 'raw']).default('parsed').describe('Output format: "parsed" for structured JSON, "raw" for full .prisma source'),
    },
  }, async ({ format }) => {
    const schema = getDbSchema(cwd)
    const output = format === 'raw' ? (schema.raw ?? 'No schema found') : JSON.stringify(schema.models, null, 2)
    return { content: [{ type: 'text' as const, text: output }] }
  })

  // ── route_list ────────────────────────────────────────

  server.registerTool('route_list', {
    title: 'Route List',
    description: 'List all registered HTTP routes with methods, paths, middleware, and source files.',
  }, async () => {
    const routes = getRouteList(cwd)
    if (routes.length === 0) {
      return { content: [{ type: 'text' as const, text: 'No routes found in routes/api.ts or routes/web.ts' }] }
    }
    const table = routes.map(r =>
      `${r.method.padEnd(7)} ${r.path.padEnd(40)} ${r.middleware.length > 0 ? `[${r.middleware.join(', ')}]` : ''} (${r.file})`
    ).join('\n')
    return { content: [{ type: 'text' as const, text: table }] }
  })

  // ── model_list ────────────────────────────────────────

  server.registerTool('model_list', {
    title: 'Model List',
    description: 'List all ORM models in app/Models/ with table names, fields, and types.',
  }, async () => {
    const models = getModelList(cwd)
    if (models.length === 0) {
      return { content: [{ type: 'text' as const, text: 'No models found in app/Models/' }] }
    }
    return { content: [{ type: 'text' as const, text: JSON.stringify(models, null, 2) }] }
  })

  // ── config_get ────────────────────────────────────────

  server.registerTool('config_get', {
    title: 'Read Config',
    description: 'Read application config files. Pass no key to list available configs, or a key like "app" to read config/app.ts.',
    inputSchema: {
      key: z.string().optional().describe('Config key — e.g. "app", "database", "auth". Omit to list all config files.'),
    },
  }, async ({ key }) => {
    const result = getConfigValue(cwd, key)
    const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2)
    return { content: [{ type: 'text' as const, text }] }
  })

  // ── last_error ────────────────────────────────────────

  server.registerTool('last_error', {
    title: 'Last Error',
    description: 'Read the latest log entries from the application logs.',
    inputSchema: {
      count: z.number().default(10).describe('Number of recent log lines to return'),
    },
  }, async ({ count }) => {
    const lines = getLastError(cwd, count)
    return { content: [{ type: 'text' as const, text: lines.join('\n') }] }
  })

  // ── db_query ──────────────────────────────────────────

  server.registerTool('db_query', {
    title: 'Database Query',
    description: 'Execute a read-only SQL SELECT query against the application database via Prisma.',
    inputSchema: {
      query: z.string().describe('SQL SELECT query to execute'),
    },
  }, async ({ query }) => {
    const result = await executeDbQuery(cwd, query)
    return { content: [{ type: 'text' as const, text: result }] }
  })

  // ── read_logs ─────────────────────────────────────────

  server.registerTool('read_logs', {
    title: 'Read Logs',
    description: 'Read recent log entries from application logs with optional filtering by level and search term.',
    inputSchema: {
      count: z.number().default(20).describe('Number of recent log lines to return'),
      level: z.enum(['all', 'error', 'warning', 'info', 'debug']).default('all').describe('Filter by log level'),
      search: z.string().optional().describe('Filter log lines containing this search term'),
    },
  }, async ({ count, level, search }) => {
    const result = await readLogs(cwd, { count, level, search })
    return { content: [{ type: 'text' as const, text: result }] }
  })

  // ── browser_logs ──────────────────────────────────────

  server.registerTool('browser_logs', {
    title: 'Browser Logs',
    description: 'Read browser console logs from the Vite dev server output.',
    inputSchema: {
      count: z.number().default(50).describe('Number of recent browser log lines to return'),
    },
  }, async ({ count }) => {
    const result = await readBrowserLogs(cwd, count)
    return { content: [{ type: 'text' as const, text: result }] }
  })

  // ── get_absolute_url ──────────────────────────────────

  server.registerTool('get_absolute_url', {
    title: 'Get Absolute URL',
    description: 'Convert a relative URI path to an absolute URL using the APP_URL from .env.',
    inputSchema: {
      path: z.string().describe('Relative path to convert — e.g. "/api/users" or "dashboard"'),
    },
  }, async ({ path }) => {
    const result = await getAbsoluteUrl(cwd, path)
    return { content: [{ type: 'text' as const, text: result }] }
  })

  return server
}

/**
 * Start the MCP server on stdio transport.
 * Called by `rudder boost:mcp`.
 */
export async function startBoostMcp(cwd: string): Promise<void> {
  const server = createBoostServer(cwd)
  const transport = new StdioServerTransport()
  await server.connect(transport)
}
