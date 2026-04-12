import path from 'node:path'
import fs from 'node:fs/promises'
import type { Command } from 'commander'

interface ApiRoute {
  method:     string
  path:       string
  middleware: unknown[]
}

interface VikeRoute {
  route: string
  dir:   string
}

async function loadApiRoutes(): Promise<ApiRoute[]> {
  try {
    const { router } = await import('@rudderjs/router') as { router: { list(): ApiRoute[] } }
    return router.list()
  } catch {
    return []
  }
}

async function scanVikeRoutes(): Promise<VikeRoute[]> {
  const routes: VikeRoute[] = []
  const pagesDir = path.join(process.cwd(), 'pages')

  const walk = async (dir: string, base = ''): Promise<void> => {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    const hasPage = entries.some(e => e.isFile() && e.name.startsWith('+Page.'))
    if (hasPage) {
      const route  = base === '' ? '/' : base
      const relDir = path.relative(pagesDir, dir)
      routes.push({ route, dir: relDir })
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('_')) continue
      const segment      = entry.name
      const routeSegment = segment.startsWith('@') ? `:${segment.slice(1)}` : segment
      const nextBase     = segment === 'index' ? '' : `${base}/${routeSegment}`
      await walk(path.join(dir, segment), nextBase)
    }
  }

  try { await walk(pagesDir) } catch { /* no pages dir */ }
  return routes
}

function methodColor(method: string): string {
  const colors: Record<string, string> = {
    GET: '\x1b[32m', POST: '\x1b[33m', PUT: '\x1b[34m',
    PATCH: '\x1b[35m', DELETE: '\x1b[31m', ALL: '\x1b[36m',
  }
  return `${colors[method] ?? '\x1b[37m'}${method.padEnd(7)}\x1b[0m`
}

function middlewareLabel(mw: unknown[]): string {
  const names = mw
    .map(fn => (typeof fn === 'function' && fn.name) ? fn.name : null)
    .filter(Boolean) as string[]
  if (names.length > 0)  return names.join(', ')
  if (mw.length > 0)     return `${mw.length}×`
  return '—'
}

function printRoutes(apiRoutes: ApiRoute[], vikeRoutes: VikeRoute[]): void {
  if (apiRoutes.length === 0 && vikeRoutes.length === 0) {
    console.log('No routes registered.')
    return
  }

  const allPaths  = [...apiRoutes.map(r => r.path), ...vikeRoutes.map(r => r.route)]
  const pathWidth = Math.min(Math.max(...allPaths.map(p => p.length), 4), 60)
  const mwWidth   = 12

  if (apiRoutes.length > 0) {
    console.log('\n  \x1b[1mAPI Routes\x1b[0m')
    console.log(`  ${'METHOD'.padEnd(9)}  ${'PATH'.padEnd(pathWidth)}  MIDDLEWARE`)
    console.log(`  ${'─'.repeat(9)}  ${'─'.repeat(pathWidth)}  ${'─'.repeat(mwWidth)}`)
    for (const route of apiRoutes) {
      console.log(`  ${methodColor(route.method)}  ${route.path.padEnd(pathWidth)}  ${middlewareLabel(route.middleware)}`)
    }
  }

  if (vikeRoutes.length > 0) {
    console.log('\n  \x1b[1mPage Routes\x1b[0m  \x1b[2m(Vike filesystem routing)\x1b[0m')
    console.log(`  ${'GET'.padEnd(9)}  ${'PATH'.padEnd(pathWidth)}  SOURCE`)
    console.log(`  ${'─'.repeat(9)}  ${'─'.repeat(pathWidth)}  ${'─'.repeat(mwWidth)}`)
    for (const { route, dir } of vikeRoutes) {
      console.log(`  \x1b[32mGET    \x1b[0m  ${route.padEnd(pathWidth)}  pages/${dir}`)
    }
  }

  console.log()
}

export function routeListCommand(program: Command): void {
  program
    .command('route:list')
    .description('List all registered routes')
    .option('--json', 'Output routes as JSON')
    .action(async (opts: { json?: boolean }) => {
      const [apiRoutes, vikeRoutes] = await Promise.all([loadApiRoutes(), scanVikeRoutes()])

      if (opts.json) {
        const output = {
          api: apiRoutes.map(r => ({
            method: r.method,
            path: r.path,
            middleware: r.middleware.map(fn =>
              (typeof fn === 'function' && fn.name) ? fn.name : String(fn)
            ),
          })),
          pages: vikeRoutes.map(r => ({
            method: 'GET',
            path: r.route,
            source: `pages/${r.dir}`,
          })),
        }
        console.log(JSON.stringify(output, null, 2))
        return
      }

      printRoutes(apiRoutes, vikeRoutes)
    })
}
