import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

interface RouteInfo {
  method: string
  path: string
  middleware: string[]
  file: string
}

export function getRouteList(cwd: string): RouteInfo[] {
  // Try runtime route:list --json first
  const runtimeRoutes = tryRuntimeRouteList(cwd)
  if (runtimeRoutes) return runtimeRoutes

  // Fall back to regex parsing
  return regexParseRoutes(cwd)
}

function tryRuntimeRouteList(cwd: string): RouteInfo[] | null {
  try {
    const { execSync } = require('node:child_process') as typeof import('node:child_process')
    const pm = detectPM(cwd)
    const cmd = `${pm} rudder route:list --json`
    const result = execSync(cmd, { cwd, timeout: 15_000, stdio: ['pipe', 'pipe', 'pipe'] })
    const json = JSON.parse(result.toString()) as {
      api?: { method: string; path: string; middleware?: string[] }[]
      pages?: { method: string; path: string; source?: string }[]
    }

    const routes: RouteInfo[] = []

    for (const r of json.api ?? []) {
      routes.push({
        method: r.method,
        path: r.path,
        middleware: r.middleware ?? [],
        file: 'routes/api.ts',
      })
    }

    for (const r of json.pages ?? []) {
      routes.push({
        method: r.method ?? 'GET',
        path: r.path,
        middleware: [],
        file: (r.source as string | undefined) ?? 'pages/',
      })
    }

    return routes.length > 0 ? routes : null
  } catch {
    return null
  }
}

function detectPM(cwd: string): string {
  const dirs = [cwd, join(cwd, '..')]
  for (const dir of dirs) {
    if (existsSync(join(dir, 'pnpm-lock.yaml')) || existsSync(join(dir, 'pnpm-workspace.yaml'))) return 'pnpm'
    if (existsSync(join(dir, 'yarn.lock'))) return 'yarn'
    if (existsSync(join(dir, 'bun.lockb'))) return 'bun'
  }
  return 'npx'
}

// ─── Regex Fallback ────────────────────────────────────

function regexParseRoutes(cwd: string): RouteInfo[] {
  const routes: RouteInfo[] = []

  const routeFiles = [
    join(cwd, 'routes', 'api.ts'),
    join(cwd, 'routes', 'web.ts'),
  ]

  for (const file of routeFiles) {
    if (!existsSync(file)) continue
    const content = readFileSync(file, 'utf8')
    const fileName = file.includes('api.ts') ? 'routes/api.ts' : 'routes/web.ts'

    const regex = /Route\.(get|post|put|patch|delete|all)\(\s*['"`]([^'"`]+)['"`]/gi
    let match: RegExpExecArray | null
    while ((match = regex.exec(content)) !== null) {
      const method = match[1]!.toUpperCase()
      const path = match[2]!

      const closingParen = findClosingParen(content, match.index + match[0].length - 1)
      const statement = content.slice(match.index, closingParen + 1)
      const mwMatch = statement.match(/\[([^\]]+)\]/)
      const middleware = mwMatch
        ? mwMatch[1]!.split(',').map(m => m.trim().replace(/\(\)/g, '')).filter(Boolean)
        : []

      routes.push({ method, path, middleware, file: fileName })
    }
  }

  return routes
}

function findClosingParen(content: string, start: number): number {
  let depth = 0
  for (let i = start; i < content.length; i++) {
    if (content[i] === '(') depth++
    if (content[i] === ')') {
      depth--
      if (depth <= 0) return i
    }
  }
  return content.length
}
