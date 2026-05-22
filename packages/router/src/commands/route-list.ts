import path from 'node:path'
import fs from 'node:fs/promises'

// ─── Types ────────────────────────────────────────────────

type RouteGroup = 'web' | 'api'

interface ApiRoute {
  method:     string
  path:       string
  middleware: unknown[]
  group?:     RouteGroup
}

interface VikeRoute {
  route: string
  dir:   string
}

interface MiddlewareSnapshot {
  global: unknown[]
  groups: Record<RouteGroup, unknown[]>
}

// ─── Route Collection ─────────────────────────────────────

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

// Pulls the resolved middleware snapshot off the RudderJS instance via the
// shared globalThis slot. Duck-typed cast avoids a hard `@rudderjs/core`
// import — router is a peer of core, and the dynamic-import path here keeps
// the bundle graph clean.
function loadMiddlewareSnapshot(): MiddlewareSnapshot | null {
  const instance = (globalThis as Record<string, unknown>)['__rudderjs_instance__']
  const snapshotFn = (instance as { middlewareSnapshot?: () => MiddlewareSnapshot } | undefined)?.middlewareSnapshot
  if (typeof snapshotFn !== 'function') return null
  try {
    return snapshotFn.call(instance)
  } catch {
    return null
  }
}

// ─── Formatting ───────────────────────────────────────────

function methodColor(method: string): string {
  const colors: Record<string, string> = {
    GET: '\x1b[32m', POST: '\x1b[33m', PUT: '\x1b[34m',
    PATCH: '\x1b[35m', DELETE: '\x1b[31m', ALL: '\x1b[36m',
  }
  return `${colors[method] ?? '\x1b[37m'}${method.padEnd(7)}\x1b[0m`
}

function fnName(fn: unknown): string {
  if (typeof fn === 'function' && fn.name) return fn.name
  return '<anonymous>'
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

function printVerbose(
  apiRoutes: ApiRoute[],
  vikeRoutes: VikeRoute[],
  snapshot: MiddlewareSnapshot | null,
): void {
  if (apiRoutes.length === 0 && vikeRoutes.length === 0) {
    console.log('No routes registered.')
    return
  }

  if (snapshot === null) {
    console.log('  \x1b[33m[warning]\x1b[0m middleware snapshot unavailable — falling back to summary view.')
    printRoutes(apiRoutes, vikeRoutes)
    return
  }

  if (apiRoutes.length > 0) {
    console.log('\n  \x1b[1mAPI Routes\x1b[0m  \x1b[2m(resolved middleware stack, runs in this order)\x1b[0m\n')
    for (const route of apiRoutes) {
      console.log(`  ${methodColor(route.method)}  ${route.path}`)
      const globalLayer = snapshot.global
      if (globalLayer.length > 0) {
        console.log(`           \x1b[2m[global]\x1b[0m   ${globalLayer.map(fnName).join(', ')}`)
      }
      if (route.group) {
        const groupLayer = snapshot.groups[route.group] ?? []
        if (groupLayer.length > 0) {
          console.log(`           \x1b[2m[${route.group}]\x1b[0m      ${groupLayer.map(fnName).join(', ')}`)
        }
      }
      if (route.middleware.length > 0) {
        console.log(`           \x1b[2m[route]\x1b[0m    ${route.middleware.map(fnName).join(', ')}`)
      }
      if (
        globalLayer.length === 0 &&
        (!route.group || (snapshot.groups[route.group] ?? []).length === 0) &&
        route.middleware.length === 0
      ) {
        console.log(`           \x1b[2m(no middleware)\x1b[0m`)
      }
      console.log()
    }
  }

  if (vikeRoutes.length > 0) {
    console.log('  \x1b[1mPage Routes\x1b[0m  \x1b[2m(Vike filesystem routing — handled by the page renderer, not the router)\x1b[0m')
    const pathWidth = Math.min(Math.max(...vikeRoutes.map(r => r.route.length), 4), 60)
    for (const { route, dir } of vikeRoutes) {
      console.log(`  \x1b[32mGET    \x1b[0m  ${route.padEnd(pathWidth)}  pages/${dir}`)
    }
    console.log()
  }
}

// ─── Command Registration ─────────────────────────────────

/**
 * Register the route:list command with the rudder CLI.
 *
 * Default output: pretty per-route summary with per-route middleware names.
 * `--verbose`: expand the resolved [global → group → route] middleware stack
 * matching the request-time composition order.
 * `--json`: machine-readable. `--verbose --json` includes the resolved layers
 * inline on each api route.
 */
export function registerRouteListCommand(
  rudder: { command(name: string, handler: (args: string[]) => void | Promise<void>): { description(text: string): unknown } },
): void {
  rudder.command('route:list', async (args: string[]) => {
    const jsonFlag    = args.includes('--json')
    const verboseFlag = args.includes('--verbose') || args.includes('-v')
    const [apiRoutes, vikeRoutes] = await Promise.all([loadApiRoutes(), scanVikeRoutes()])
    const snapshot = verboseFlag ? loadMiddlewareSnapshot() : null

    if (jsonFlag) {
      const output = {
        api: apiRoutes.map(r => {
          const base = {
            method:     r.method,
            path:       r.path,
            middleware: r.middleware.map(fnName),
            ...(r.group ? { group: r.group } : {}),
          }
          if (!verboseFlag || snapshot === null) return base
          const groupLayer = r.group ? (snapshot.groups[r.group] ?? []) : []
          return {
            ...base,
            resolved: {
              global: snapshot.global.map(fnName),
              group:  groupLayer.map(fnName),
              route:  r.middleware.map(fnName),
            },
          }
        }),
        pages: vikeRoutes.map(r => ({
          method: 'GET',
          path: r.route,
          source: `pages/${r.dir}`,
        })),
      }
      console.log(JSON.stringify(output, null, 2))
      return
    }

    if (verboseFlag) {
      printVerbose(apiRoutes, vikeRoutes, snapshot)
      return
    }

    printRoutes(apiRoutes, vikeRoutes)
  }).description('List all registered routes (--verbose for resolved middleware stack)')
}
