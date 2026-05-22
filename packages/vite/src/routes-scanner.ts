/**
 * routes/* scanner — extracts `.name('foo')` chains from `routes/*.ts` and
 * emits a `RouteRegistry` augmentation so `route('foo', ...)` calls type-check.
 *
 * The scanner is regex-based on purpose: routes/*.ts files are small, predictable
 * shapes, and pulling in a TS AST parser for this would dwarf the win. Three
 * patterns are recognised:
 *
 *   Route.get('/users/:id', handler).name('users.show')
 *   router.post('/posts', handler).name('posts.store')
 *   router.get('/users/:id', handler, middleware).name('users.show')
 *
 * Multi-line chains are tolerated via `[\s\S]*?` between the verb call and the
 * `.name(...)`. The scanner reads each file, applies the regex, and dedups
 * across files — first-write-wins, which mirrors `Router.registerNamed()`'s
 * runtime behaviour (registering a name twice would throw at boot).
 *
 * Limitations (intentional, documented):
 * - Variable paths (`router.get(loginPath, ...).name('login')`) are skipped.
 *   The scanner sees no literal string and falls through silently.
 * - Variable names (`.name(LOGIN_ROUTE_NAME)`) are skipped, same reason.
 * - Routes registered inside helper functions (e.g. `registerAuthRoutes(router)`)
 *   are NOT visible to the scanner — those live under each package's src
 *   tree and run at boot time. Apps that need them in `RouteRegistry` hand-augment
 *   the interface; the scanner's emit MERGES with manual augmentations via
 *   declaration merging.
 *
 * Output: `pages/__view/routes.d.ts` (sibling to the existing views `registry.d.ts`).
 * The single shared `pages/__view/` directory keeps both registries together —
 * conceptually they're both "type augmentations the scanner emits for app code".
 */

import fs from 'node:fs'
import path from 'node:path'
import type { Plugin } from 'vite'

// ─── Regex ─────────────────────────────────────────────────

/**
 * Match `(Route|router).<verb>('path', ...).name('foo')` chains.
 *
 * Captures:
 *   [1] verb           — get / post / put / patch / delete / all / head / options
 *   [2] path           — first literal-string arg to the verb call
 *   [3] name           — literal-string arg to .name()
 *
 * Multi-line tolerant — the `[\s\S]` body between the verb's open string
 * and `.name(...)` is laundered through a negative lookahead that bails the
 * moment ANOTHER `Route.<verb>(` or `router.<verb>(` appears. Without that,
 * a non-`.name()`'d chain followed later in the file by a different chain
 * that DOES `.name()` would silently bridge — the path from chain A would
 * end up paired with the name from chain B.
 */
const ROUTE_NAME_RE = /\b(?:Route|router)\s*\.\s*(get|post|put|patch|delete|all|head|options)\s*\(\s*['"`]([^'"`]+)['"`](?:(?!\b(?:Route|router)\s*\.\s*(?:get|post|put|patch|delete|all|head|options)\s*\()[\s\S])*?\.name\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g

export interface DiscoveredNamedRoute {
  /** Named route id, e.g. `'users.show'` */
  name: string
  /** URL pattern with `:params`, e.g. `'/users/:id'` */
  path: string
  /** HTTP verb in lowercase, e.g. `'get'`. Surfaces in diagnostics only. */
  verb: string
  /** Source file (relative to cwd) — surfaces in conflict warnings only. */
  source: string
}

// ─── File discovery + scan ─────────────────────────────────

function readFileSafe(absPath: string): string | null {
  try {
    return fs.readFileSync(absPath, 'utf8')
  } catch {
    return null
  }
}

function walkRouteFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...walkRouteFiles(full))
    } else if (/\.(?:ts|mts|tsx|js|mjs)$/.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

/**
 * Strip JS/TS comments before scanning so commented-out chains like
 * `// Route.get('/admin', h).name('admin')` aren't picked up as live routes.
 *
 * Tracks string-literal state (single/double quotes + template literals) so
 * the stripper doesn't accidentally truncate URLs that contain `//` inside
 * strings (e.g. `Route.get('https://example.com/api', …)`). Returns the
 * input with comment regions replaced by whitespace of the same length,
 * which preserves line numbers + offsets if the result is ever mapped back
 * to source — and lets the existing regex run unchanged.
 *
 * Not a full JS lexer (doesn't understand regex literals or `${}` template
 * interpolation as code, which is fine for the scanner — the regex only
 * matches literal-quoted paths anyway, so anything inside a template
 * interpolation can't match the chain).
 */
export function stripJsComments(src: string): string {
  let out = ''
  let i   = 0
  const n = src.length
  while (i < n) {
    const c = src[i]
    // String literal — copy through unchanged, honoring backslash escapes.
    if (c === '\'' || c === '"' || c === '`') {
      const quote = c
      out += c
      i++
      while (i < n) {
        const k = src.charAt(i)
        if (k === '\\' && i + 1 < n) {
          out += k + src.charAt(i + 1)
          i += 2
          continue
        }
        out += k
        i++
        if (k === quote) break
      }
      continue
    }
    // Line comment — replace with spaces until newline, keep the newline.
    if (c === '/' && src[i + 1] === '/') {
      while (i < n && src[i] !== '\n') { out += ' '; i++ }
      continue
    }
    // Block comment — replace with whitespace of equal length, preserving newlines.
    if (c === '/' && src[i + 1] === '*') {
      out += '  '
      i   += 2
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
        out += src[i] === '\n' ? '\n' : ' '
        i++
      }
      if (i < n) { out += '  '; i += 2 }  // closing `*/`
      continue
    }
    out += c
    i++
  }
  return out
}

export function scanRouteFiles(routesDir: string): DiscoveredNamedRoute[] {
  const seen   = new Map<string, DiscoveredNamedRoute>()
  const files  = walkRouteFiles(routesDir).sort()  // sort for stable output
  const cwd    = process.cwd()
  for (const abs of files) {
    const rawSource = readFileSafe(abs)
    if (rawSource === null) continue
    // Strip comments so `// Route.get('/x', h).name('x')` doesn't pollute the
    // RouteRegistry with a name that has no runtime registration backing it
    // — that augmentation would let `route('x')` type-check but throw at
    // runtime. URLs containing `//` inside strings stay intact (see stripJsComments).
    const source = stripJsComments(rawSource)
    const relSource = path.relative(cwd, abs).replace(/\\/g, '/')
    let match: RegExpExecArray | null
    ROUTE_NAME_RE.lastIndex = 0
    while ((match = ROUTE_NAME_RE.exec(source)) !== null) {
      const [, verb, pathPattern, name] = match
      if (!verb || !pathPattern || !name) continue
      const existing = seen.get(name)
      if (existing && existing.path !== pathPattern) {
        // Conflicting registration — warn but keep first-write (matches the
        // runtime's first-write-wins behaviour: the second .name() call would
        // currently overwrite; we follow runtime semantics by keeping the
        // first occurrence in the scan order).
        console.warn(
          `[RudderJS] Named route "${name}" registered with conflicting paths: ` +
          `"${existing.path}" (${existing.source}) vs "${pathPattern}" (${relSource}). ` +
          `Keeping the first; rename one of them to fix.`,
        )
        continue
      }
      seen.set(name, { name, path: pathPattern, verb: verb.toLowerCase(), source: relSource })
    }
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name))
}

// ─── Emission ──────────────────────────────────────────────

export function routesRegistrySource(routes: DiscoveredNamedRoute[]): string {
  // Quoting strategy: name and path are scanned from literal string args, so
  // they're guaranteed to contain only the chars the source had between quotes.
  // We emit them with single quotes; if a path contains a single quote that
  // would already be a syntax error in the source file, so the regex couldn't
  // have matched it.
  const entries = routes
    .map(r => `    '${r.name}': '${r.path}'`)
    .join('\n')
  const body = entries ? `\n${entries}\n  ` : '\n  '

  return `// AUTO-GENERATED by @rudderjs/vite — do not edit.
// Maps named-route ids → URL patterns for typed route() calls.
// Re-generated on every scan; only routes with a literal path AND literal name
// at the call site are picked up. Hand-augment RouteRegistry yourself for
// runtime-registered routes (e.g. registerAuthRoutes from @rudderjs/auth).
declare module '@rudderjs/router' {
  interface RouteRegistry {${body}}
}
export {}
`
}

function writeIfChanged(file: string, contents: string): boolean {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  if (fs.existsSync(file)) {
    if (fs.readFileSync(file, 'utf8') === contents) return false
  }
  fs.writeFileSync(file, contents)
  return true
}

// ─── Plugin ────────────────────────────────────────────────

const DEFAULT_ROUTES_DIR = 'routes'
const DEFAULT_OUT_FILE   = path.join('pages', '__view', 'routes.d.ts')

// ─── One-shot sync (CLI surface) ──────────────────────────

export interface RoutesSyncResult {
  routesDirExists: boolean
  routeCount:      number
}

/**
 * One-shot scan + emit, runnable outside of Vite (CLI tooling, CI scripts
 * that need the augmentation file on disk before tsc runs). Idempotent —
 * read-compare-then-write via `writeIfChanged`.
 */
export function syncRoutesFromDisk(cwd: string = process.cwd()): RoutesSyncResult {
  const routesDir = path.join(cwd, DEFAULT_ROUTES_DIR)
  const outFile   = path.join(cwd, DEFAULT_OUT_FILE)
  if (!fs.existsSync(routesDir)) {
    return { routesDirExists: false, routeCount: 0 }
  }
  const routes = scanRouteFiles(routesDir)
  writeIfChanged(outFile, routesRegistrySource(routes))
  return { routesDirExists: true, routeCount: routes.length }
}

export interface RoutesScannerOptions {
  /**
   * App-relative directory to scan for named-route declarations. Defaults to
   * `routes/`. Files matched: `*.ts`, `*.mts`, `*.tsx`, `*.js`, `*.mjs`.
   */
  routesDir?: string
  /**
   * App-relative output path for the augmentation `.d.ts`. Defaults to
   * `pages/__view/routes.d.ts` — same parent dir as the views registry.
   */
  outFile?:   string
}

export function routesScannerPlugin(opts: RoutesScannerOptions = {}): Plugin {
  const cwd        = process.cwd()
  const routesDir  = path.resolve(cwd, opts.routesDir ?? DEFAULT_ROUTES_DIR)
  const outFile    = path.resolve(cwd, opts.outFile   ?? DEFAULT_OUT_FILE)

  function sync(): void {
    const routes = scanRouteFiles(routesDir)
    writeIfChanged(outFile, routesRegistrySource(routes))
  }

  // Eager sync at plugin construction so tests + first dev start get the
  // augmentation without waiting for buildStart. Mirrors views-scanner pattern.
  sync()

  return {
    name: 'rudderjs:routes-scanner',
    buildStart() { sync() },
    configureServer(server) {
      // Watch routes/ for adds/changes/renames and rescan.
      server.watcher.add(routesDir)
      const onChange = (file: string): void => {
        if (file.startsWith(routesDir)) sync()
      }
      server.watcher.on('add',    onChange)
      server.watcher.on('change', onChange)
      server.watcher.on('unlink', onChange)
    },
  }
}
