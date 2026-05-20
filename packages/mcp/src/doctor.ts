// Doctor checks contributed by @rudderjs/mcp.

import fs from 'node:fs'
import path from 'node:path'
import { registerDoctorCheck, type DoctorResult } from '@rudderjs/console'

function readFileSafe(rel: string): string | null {
  try { return fs.readFileSync(path.join(process.cwd(), rel), 'utf-8') } catch { return null }
}

function hasMcpTools(): boolean {
  // Convention: tools live under app/Mcp/. Any *.ts/*.tsx/*.js file means
  // the user wired at least one tool — we don't need to introspect contents.
  const dirs = ['app/Mcp', 'src/mcp', 'src/Mcp']
  for (const dir of dirs) {
    try {
      const full = path.join(process.cwd(), dir)
      const entries = fs.readdirSync(full, { recursive: true }) as string[]
      if (entries.some(e => /\.(ts|tsx|js|jsx)$/.test(e))) return true
    } catch { /* dir doesn't exist */ }
  }
  return false
}

function mcpRouteMounted(): boolean {
  // Scaffolded apps register the MCP transport route in routes/api.ts via
  // `registerMcpRoutes(...)` or by referencing the MCP module directly.
  for (const rel of ['routes/api.ts', 'routes/web.ts']) {
    const text = readFileSafe(rel)
    if (text && /registerMcpRoutes|@rudderjs\/mcp|McpServer/.test(text)) return true
  }
  return false
}

registerDoctorCheck({
  id:       'mcp:route-mounted',
  category: 'mcp',
  title:    'MCP routes registered',
  run(): DoctorResult {
    if (!hasMcpTools()) {
      return { status: 'ok', message: 'no app/Mcp/ — skip' }
    }
    if (!mcpRouteMounted()) {
      return {
        status:  'warn',
        message: 'app/Mcp/ has tools but no MCP route registered in routes/api.ts',
        fix:     'In routes/api.ts: `import { registerMcpRoutes } from \'@rudderjs/mcp\'; registerMcpRoutes(Route)`',
      }
    }
    return { status: 'ok', message: 'mounted' }
  },
})
