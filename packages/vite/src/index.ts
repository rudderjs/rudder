import path from 'node:path'
import { existsSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import type { EnvironmentModuleNode, Plugin, ViteDevServer } from 'vite'
import { viewsScannerPlugin } from './views-scanner.js'
import { routesScannerPlugin } from './routes-scanner.js'
import { resetPageContextEnhancers } from './page-context-enhancers.js'

/** Options for the {@link rudderjs} Vite plugin. */
export interface RudderjsOptions {
  /**
   * Extra packages (or absolute directories) to watch for dev HMR. Use this to
   * hot-reload a linked/workspace package that registers routes, views, or
   * config in a service provider's `boot()` (e.g. `@pilotiq/pilotiq`) — editing
   * its source then re-bootstraps the app like an `app/` edit, with no restart.
   *
   * Package-name entries are also added to `ssr.noExternal` **in dev only**, so
   * Vite owns them in the SSR module graph and re-evaluates them on change
   * (Node's ESM import cache can't be evicted, so an externalized package would
   * otherwise re-read its stale source). A package with native deps that can't
   * be transformed by Vite SSR can't be watched this way — pass an absolute
   * source dir instead and keep it externalized.
   */
  watch?: string[]
}

// ─── Startup banner ────────────────────────────────────────

/**
 * Resolve the framework version to show on the dev banner — `@rudderjs/core`'s
 * installed version (the canonical number `rudder about` reports), resolved
 * from the app's `node_modules`. Falls back to this package's own version, then
 * `null` (banner segment is skipped). Best-effort; never throws.
 */
function resolveRudderVersion(): string | null {
  const req = createRequire(path.join(process.cwd(), 'package.json'))
  for (const name of ['@rudderjs/core', '@rudderjs/vite']) {
    try {
      const meta = req(`${name}/package.json`) as { version?: string }
      if (typeof meta.version === 'string') return meta.version
    } catch { /* try next */ }
  }
  return null
}

/**
 * Splice `· Rudder vX.Y.Z` into Vike's startup banner
 * (`Vike vA · Vite vB · ready in N ms`), inserting it before the `· ready in`
 * segment and reusing Vike's dim `·` separator. Returns `null` when the line
 * isn't the banner (so the caller leaves it untouched). Vike composes the
 * banner in a pure function and prints it via `console.log` with no hook to
 * extend it (vikejs/vike#1438 is unshipped), so string-rewriting the line is
 * the only seam — matched defensively, with a standalone-line fallback at the
 * call site if Vike ever changes the format.
 */
export function spliceRudderVersion(line: string, version: string): string | null {
  // Build ANSI patterns via new RegExp from a runtime ESC const so the source
  // stays ASCII (no literal ESC byte to mangle on Windows) and eslint's
  // no-control-regex rule has no static control char to flag.
  const ESC  = '\x1b'
  const SGR  = `(?:${ESC}\\[[0-9;]*m)*` // any run of SGR color codes
  const ANSI = new RegExp(`${ESC}\\[[0-9;]*m`, 'g')
  if (!/Vike v.*·.*Vite v.*·.*ready in/.test(line.replace(ANSI, ''))) return null
  // Match the styled `·` separator + space that precedes the styled `ready in`,
  // tolerating any surrounding color codes. Insert our colored segment + a fresh
  // dim separator after it.
  const tail = new RegExp(`(${SGR}·${SGR}\\s+)(${SGR}ready in)`)
  if (!tail.test(line)) return null
  // 256-color orange (208) — Rudder's brand color, distinct from Vike's and
  // Vite's banner colors (and from Vike's yellow version number). Name bold,
  // version normal weight — matches how Vike/Vite render `Vike v…`/`Vite v…`.
  const rudder = `${ESC}[38;5;208m${ESC}[1mRudder${ESC}[22m v${version}${ESC}[39m`
  const sep    = `${ESC}[2m·${ESC}[22m`
  return line.replace(tail, `$1${rudder} ${sep} $2`)
}

/** Minimal structural slice of `server.httpServer` used by {@link installBannerSplice}. */
interface BannerHttpServer {
  listening: boolean
  once(event: 'listening' | 'close', listener: () => void): unknown
}

/**
 * Wrap `console.log` so the next Vike startup banner gets the Rudder version
 * spliced in, then restore. Exported for tests.
 *
 * The standalone-line fallback (printed when the banner never matches — i.e.
 * Vike changed its format) is armed from the http server's `listening` event,
 * NOT from install time: pre-bundling/codegen between `configureServer` and
 * `listen()` can take arbitrarily long (a heavy `optimizeDeps.include` set is
 * 3s+), and a fixed window from install time would fire early, restore
 * `console.log`, and the real banner would print un-spliced. The banner prints
 * on the tick after `listening`, so 2s from there is generous regardless of
 * startup cost. Middleware mode (no http server) keeps the immediate arm. If
 * the server closes before the banner ever matched, restore silently — the
 * wrapper never outlives the server.
 */
export function installBannerSplice(version: string, httpServer?: BannerHttpServer | null): void {
  const original = console.log
  let done = false
  const finish = (): void => { if (!done) { done = true; console.log = original } }
  console.log = (...args: unknown[]): void => {
    if (!done && typeof args[0] === 'string') {
      const spliced = spliceRudderVersion(args[0], version)
      if (spliced !== null) {
        finish()
        original(spliced, ...args.slice(1))
        return
      }
    }
    original(...(args as []))
  }
  const arm = (): void => {
    setTimeout(() => {
      if (done) return
      finish()
      original(`  \x1b[32m➜\x1b[39m  \x1b[38;5;208m\x1b[1mRudder\x1b[22m v${version}\x1b[39m`)
    }, 2_000).unref?.()
  }
  if (httpServer) {
    if (httpServer.listening) arm()
    else httpServer.once('listening', arm)
    httpServer.once('close', finish)
  } else {
    arm()
  }
}

// ─── SSR / build externals ─────────────────────────────────

const SSR_EXTERNALS = [
  // @rudderjs/view — linked package, Vite's SSR module runner can't resolve
  // it via its internal fetchModule path in non-workspace consumers (fresh
  // scaffolded app + pnpm link). Loading it through Node's native ESM
  // (which handles the symlink correctly) sidesteps the issue.
  '@rudderjs/view',
  // CLI-only — uses node:process stdin/readline
  '@clack/core',
  '@clack/prompts',
  // Queue adapters — server-only
  '@rudderjs/queue-inngest',
  '@rudderjs/queue-bullmq',
  // ORM adapters — server-only
  '@rudderjs/orm-drizzle',
  '@rudderjs/orm-prisma',
  // Database drivers — Node.js-only, must not be bundled into the client
  'pg',
  'mysql2',
  'better-sqlite3',
  '@prisma/adapter-pg',
  '@prisma/adapter-mysql2',
  '@prisma/adapter-better-sqlite3',
  '@prisma/adapter-libsql',
  '@libsql/client',
  // Redis — server-only
  'ioredis',
  // Storage — server-only (uses node:fs, node:path)
  '@rudderjs/storage',
  // Image — uses sharp (native binary)
  '@rudderjs/image',
  // Optional icon adapters — may not be installed
  '@tabler/icons-react',
  '@phosphor-icons/react',
  '@remixicon/react',
]

// ─── SSR no-externals ──────────────────────────────────────
const SSR_NO_EXTERNALS = [
  '@rudderjs/server-hono',
]

// ─── Scoped SSR invalidation (dev HMR) ─────────────────────

/**
 * Invalidate only the changed file's SSR module + its transitive importers
 * (the import chain up to `bootstrap/app.ts` and the Vike server entry), instead
 * of the whole SSR graph. The reload wall-clock is dominated by Vike's runner
 * re-fetching invalidated modules (~900ms with `invalidateAll()`); scoping the
 * set to the edited subtree keeps framework packages and unrelated app modules
 * warm so far less is re-fetched. Run `RUDDER_HMR_TRACE=1` to see the win.
 *
 * The re-boot itself only happens when `bootstrap/app.ts` re-evaluates (its
 * top-level `create()` rebuilds the cleared singletons), so we explicitly
 * invalidate the bootstrap entry as a safety net in case a non-analyzable
 * dynamic import means the importer walk doesn't reach it.
 *
 * Returns false when the changed file isn't in the SSR graph at all
 * (externalized package, or never-yet-imported) — the caller falls back to
 * `invalidateAll()` so behaviour is never worse than before.
 */
export function invalidateBackendSubtree(server: ViteDevServer, file: string, cwd: string): boolean {
  const mg = server.environments.ssr.moduleGraph
  const changed = mg.getModulesByFile(file)
  if (!changed || changed.size === 0) return false

  const walked = new Set<EnvironmentModuleNode>()
  const walk = (mod: EnvironmentModuleNode): void => {
    if (walked.has(mod)) return
    walked.add(mod)
    mg.invalidateModule(mod)
    for (const importer of mod.importers) walk(importer)
  }
  for (const mod of changed) walk(mod)

  // Safety net: guarantee the bootstrap entry re-evaluates even if the importer
  // chain didn't reach it (e.g. a route loader's dynamic import wasn't linked).
  for (const entry of ['bootstrap/app.ts', '+server.ts']) {
    const mods = mg.getModulesByFile(path.resolve(cwd, entry))
    if (mods) for (const mod of mods) walk(mod)
  }

  // Always re-evaluate the route loader modules. The dev re-boot calls
  // router.reset() then re-runs the loaders (which re-import routes/*.ts); a
  // cached route module won't re-run its registration side-effects, so its
  // routes would be cleared and never re-added (404 on every route). The
  // changed file's subtree only covers route files in *its* import chain, so an
  // edit elsewhere (bootstrap/, config/, an unrelated app file, or a watched
  // package) would otherwise drop all loader-registered routes. There are only
  // a handful of route files, so re-evaluating them on every re-boot is cheap.
  const routesPrefix = path.resolve(cwd, 'routes') + path.sep
  for (const [file, mods] of mg.fileToModulesMap) {
    if (file.startsWith(routesPrefix)) for (const mod of mods) walk(mod)
  }
  return true
}

/**
 * Re-bootstrap the dev SSR app after a watched file change: clear the two
 * top-level singletons (so a fresh `RudderJS` + `Application` pair is built on
 * the next request), invalidate the changed files' SSR subtrees, and tell the
 * browser to do a full reload.
 *
 * Extracted from the watcher handler so the {@link rudderjs} `rudderjs:routes`
 * plugin can run it once per *coalesced burst* of change events rather than
 * once per raw event — see the debounce in `configureServer`. Coalescing is the
 * primary guard against the "half-booted response" race: an atomic-write /
 * format-on-save fires two `change` events ms apart, and firing this twice spun
 * up two concurrent re-boots that stomped each other's shared state (router
 * routes, ORM adapter registry), so a request landing in the window rendered
 * empty data. One burst = one re-boot.
 *
 * @param files - absolute paths of every file changed during the burst.
 */
export function performReboot(server: ViteDevServer, files: string[], cwd: string): void {
  if (files.length === 0) return

  // RUDDER_HMR_TRACE=1 — segment the reload wall-clock. t0 is stashed on
  // globalThis so @rudderjs/core's _bootstrapProviders() can measure the
  // watcher→reimport gap (Vite/Vike re-fetch) and reboot→ready. t0 is taken at
  // re-boot time (after the debounce settles), so the debounce delay is not
  // attributed to Vite's re-import.
  const trace = process.env['RUDDER_HMR_TRACE'] === '1'
  const t0 = trace ? performance.now() : 0

  // Clear the two top-level singletons so a new RudderJS + Application pair is
  // created when the module re-executes. App files (models, resources,
  // controllers) are captured in closures during bootstrap so they also need a
  // full re-bootstrap to pick up changes.
  const g = globalThis as Record<string, unknown>
  if (trace) g['__rudderjs_hmr_t0__'] = t0
  delete g['__rudderjs_instance__']
  delete g['__rudderjs_app__']
  // Reset the page-context-enhancer registry too: providers (auth/localization/
  // session) push an enhancer in boot() and the registry is a persistent
  // globalThis append-only list, so without this each re-boot accumulates a
  // duplicate enhancer. The re-bootstrap re-runs those boot()s and re-registers.
  resetPageContextEnhancers()
  const tCleared = trace ? performance.now() : 0

  // Invalidate each changed file's import subtree (up to the bootstrap entry)
  // so Vike re-executes bootstrap/app.ts and the edited modules on the next
  // request, while framework packages and unrelated app modules stay warm.
  // Falls back to invalidating the whole graph when any file isn't tracked in
  // the SSR graph. Lighter than server.restart() and safe while requests are in
  // flight.
  let allScoped = true
  for (const file of files) {
    if (!invalidateBackendSubtree(server, file, cwd)) allScoped = false
  }
  if (!allScoped) server.environments.ssr.moduleGraph.invalidateAll()
  const tInvalidated = trace ? performance.now() : 0

  // Tell the browser to do a full page reload so it picks up the changes via a
  // fresh SSR request.
  server.hot.send({ type: 'full-reload' })
  if (trace) {
    console.log(`[hmr] clear-globals ${(tCleared - t0).toFixed(1)}ms · invalidate ${(tInvalidated - tCleared).toFixed(1)}ms (${allScoped ? 'scoped' : 'all'})`)
  }
  const rel = files.map(f => path.relative(cwd, f) || f).join(', ')
  // Mirror Vite's HMR line (`<dim time> [vite] hmr update <dim files>`): dim
  // timestamp, a bold orange [Rudder] tag, the action, then the dim file(s).
  const d    = new Date()
  const time = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
  const dim  = (s: string): string => `\x1b[2m${s}\x1b[22m`
  const tag  = `\x1b[1m\x1b[38;5;208m[Rudder]\x1b[39m\x1b[22m`
  console.log(`${dim(time)} ${tag} \x1b[32mchange detected\x1b[39m ${dim(rel)}`)
}

/**
 * Resolve a `watch` entry — a package name or an absolute directory — to a
 * directory to add to the dev file watcher. Package names resolve to the
 * package's `src/` when present (the dev source you edit), else the package
 * root. Returns null when the entry can't be resolved (caller warns + skips).
 */
export function resolveWatchDir(entry: string, cwd: string): string | null {
  if (path.isAbsolute(entry)) return existsSync(entry) ? entry : null
  try {
    // Find the package's directory WITHOUT triggering Node's "exports"
    // restrictions: require.resolve(name) throws ERR_PACKAGE_PATH_NOT_EXPORTED
    // for ESM-only packages (every @rudderjs/* package, and the linked packages
    // this option targets). Walk the node_modules search paths instead and read
    // the directory directly. realpathSync resolves the pnpm/workspace symlink
    // so the watched path matches the realpath Vite keys its module graph by.
    const require = createRequire(path.join(cwd, 'package.json'))
    for (const base of require.resolve.paths(entry) ?? []) {
      const pkgDir = path.join(base, entry)
      if (existsSync(path.join(pkgDir, 'package.json'))) {
        const real = realpathSync(pkgDir)
        const src  = path.join(real, 'src')
        return existsSync(src) ? src : real
      }
    }
    return null
  } catch {
    return null
  }
}

// ─── Main plugin ───────────────────────────────────────────

/**
 * RudderJS Vite plugin.
 *
 * Sets the @/ and App/ path aliases, externalises RudderJS optional-peer
 * packages from the SSR bundle, wires the views-scanner, and patches Vite's
 * HTTP server with the WebSocket upgrade handler used by `@rudderjs/broadcast`
 * and `@rudderjs/sync`.
 *
 * **You must register `vike()` yourself.** Vike was previously bundled into
 * this factory, but that wrapped Vike's plugin IIFE inside our own async
 * factory and tripped a microtask race against Vike's internal
 * `isOnlyResolvingUserConfig` flag — see vikejs/vike#3258. The supported
 * pattern is to call `vike()` synchronously in your own `vite.config.ts`.
 *
 * **Plugin order matters.** Put `rudderjs()` **before** `vike()`. The views
 * scanner writes auto-generated stubs to `pages/__view/` during plugin
 * construction, and Vike scans `pages/` during its own construction — so the
 * stubs must exist on disk before `vike()` is called.
 *
 * @example
 * // vite.config.ts
 * import { defineConfig } from 'vite'
 * import vike from 'vike/plugin'
 * import rudderjs from '@rudderjs/vite'
 * import tailwindcss from '@tailwindcss/vite'
 * import react from '@vitejs/plugin-react'
 *
 * export default defineConfig({
 *   plugins: [rudderjs(), vike(), tailwindcss(), react()],
 * })
 */
export function rudderjs(opts: RudderjsOptions = {}): Plugin[] {
  const watchEntries = opts.watch ?? []
  // Package-name entries (not absolute dirs) are pulled into the SSR graph in
  // dev so Vite re-evaluates them on change — see RudderjsOptions.watch.
  const watchPackages = watchEntries.filter(e => !path.isAbsolute(e))
  return [
    viewsScannerPlugin(),
    routesScannerPlugin(),
    {
      // Append `· Rudder vX.Y.Z` to Vike's `Vike v… · Vite v… · ready in N ms`
      // startup banner so the framework version shows alongside Vike's and
      // Vite's. Vike prints the banner via console.log just after `listen()`
      // with no hook to extend it, so we wrap console.log here (installed in
      // configureServer, before the banner prints), rewrite the one banner
      // line, then restore. Fallback: if the banner never matches (Vike changed
      // its format), print our own line so the version is never silently lost —
      // armed from `listening`, not from here (see installBannerSplice).
      name: 'rudderjs:banner',
      apply: 'serve',
      configureServer(server) {
        const version = resolveRudderVersion()
        if (!version) return
        installBannerSplice(version, server.httpServer)
      },
    },
    {
      // Inject x-real-ip header from the Node socket so downstream Hono
      // middleware can read the client IP. Vike's universal-middleware
      // converts the Express request to a Web Request which loses socket info.
      name: 'rudderjs:ip',
      configureServer(server) {
        server.middlewares.use((req, _res, next) => {
          if (!req.headers['x-real-ip'] && !req.headers['x-forwarded-for']) {
            const ip = req.socket?.remoteAddress
            if (ip) (req.headers as Record<string, string>)['x-real-ip'] = ip
          }
          next()
        })
      },
    },
    {
      name: 'rudderjs:ws',
      configureServer(server) {
        // Attach the WebSocket upgrade handler to Vite's own HTTP server.
        //
        // GlobalThis contract for cross-package WS wiring:
        //   __rudderjs_ws_upgrade__         — handler function. Written by
        //                                     @rudderjs/broadcast and
        //                                     @rudderjs/sync provider boot.
        //                                     Read here in dev and by
        //                                     @rudderjs/server-hono in prod.
        //   __rudderjs_http_upgrade_patched__ — sentinel set by whichever
        //                                     plugin/runtime claims the
        //                                     `upgrade` event first. Both
        //                                     this plugin AND server-hono's
        //                                     module-load patch attach
        //                                     upgrade listeners; without the
        //                                     sentinel, handleUpgrade()
        //                                     would fire twice per socket
        //                                     (duplicate WS connection + the
        //                                     classic "already destroyed"
        //                                     error from `ws`).
        //
        // The sentinel slot is shared with @rudderjs/server-hono; renaming
        // it requires a coordinated change in both packages.
        const _G = globalThis as Record<string, unknown>
        if (_G['__rudderjs_http_upgrade_patched__']) return
        _G['__rudderjs_http_upgrade_patched__'] = true

        // Buffer early upgrade requests that arrive before providers have
        // registered __rudderjs_ws_upgrade__ (the page SSR can trigger a
        // browser WS connect before provider boot finishes).
        let pending: Array<[unknown, unknown, unknown]> | null = []

        const flush = () => {
          if (!pending) return
          const handler = _G['__rudderjs_ws_upgrade__'] as
            | ((req: unknown, socket: unknown, head: unknown) => void)
            | undefined
          if (!handler) return
          const queued = pending
          pending = null
          for (const [r, s, h] of queued) handler(r, s, h)
        }

        // Poll briefly for the handler to appear (providers boot async)
        const interval = setInterval(() => {
          if (_G['__rudderjs_ws_upgrade__']) { flush(); clearInterval(interval) }
        }, 50)
        setTimeout(() => {
          clearInterval(interval)
          if (pending) {
            for (const [, socket] of pending) (socket as { destroy(): void }).destroy()
            pending = null
          }
        }, 10_000)

        server.httpServer?.on('upgrade', (req, socket, head) => {
          // Skip Vite's own HMR WebSocket (handled by Vite internally)
          if (req.headers['sec-websocket-protocol'] === 'vite-hmr') return
          if (req.headers['sec-websocket-protocol'] === 'vite-ping') return
          const handler = _G['__rudderjs_ws_upgrade__'] as
            | ((req: unknown, socket: unknown, head: unknown) => void)
            | undefined
          if (handler) {
            handler(req, socket, head)
          } else if (pending) {
            pending.push([req, socket, head])
          }
        })
      },
    },
    {
      name: 'rudderjs:routes',
      configureServer(server) {
        // Dev-only: expose Vite's sourcemap-based stack rewriter on globalThis so
        // @rudderjs/server-hono's Ignition error page can remap eval'd SSR
        // module-runner frames to real source positions. The module runner reports
        // transformed-coordinate line numbers (a route's throw at source line 235
        // surfaces as ~140), which the page's text heuristic can't recover when the
        // wrong line lands on unrelated real code. `ssrFixStacktrace` mutates
        // `err.stack` in place using the SSR module graph's sourcemaps. Never
        // registered in production — `configureServer` only runs under `vite dev`.
        const g = globalThis as Record<string, unknown>
        g['__rudderjs_fix_stacktrace__'] = (err: Error): void => {
          try { server.ssrFixStacktrace(err) } catch { /* best-effort — keep original stack */ }
        }

        // Watch route, bootstrap, and app files for SSR changes. These files
        // are dynamically imported during bootstrap or within route handlers
        // so Vite doesn't track them in its SSR module graph — changes go
        // unnoticed without an explicit watcher.
        const cwd = process.cwd()
        const watchDirs = [
          path.resolve(cwd, 'routes'),
          path.resolve(cwd, 'bootstrap'),
          path.resolve(cwd, 'app'),
        ]
        // View files (app/Views/**) are loaded lazily by Vike when a page
        // renders — they aren't captured in provider boot closures. Vike's
        // component HMR handles them in ~50ms; full re-bootstrap pushes the
        // first request after an edit to ~600ms cold SSR. Skip them here.
        const viewsRoot = path.resolve(cwd, 'app', 'Views')

        // Opt-in extra dirs (the `watch` option) — a linked package that
        // registers routes/views/config in a provider boot(). Edits there
        // re-bootstrap the app exactly like an app/ edit.
        const extraDirs: string[] = []
        for (const entry of watchEntries) {
          const dir = resolveWatchDir(entry, cwd)
          if (dir) { extraDirs.push(dir); console.log(`[RudderJS] watching package source: ${path.relative(cwd, dir) || dir}`) }
          else console.warn(`[RudderJS] watch: could not resolve "${entry}" — skipped.`)
        }
        const allWatchDirs = [...watchDirs, ...extraDirs]

        for (const dir of allWatchDirs) server.watcher.add(dir)

        // Coalesce a burst of change events into a single re-boot. An editor's
        // atomic-write / format-on-save emits two `change` events for the same
        // file ms apart; before the debounce each fired its own clear-globals +
        // invalidate + full-reload, so two re-boots ran concurrently and stomped
        // each other's shared state (router routes, ORM adapter registry) — a
        // request landing in the window rendered empty data. With the debounce,
        // one save = one re-boot. (Re-boots that still overlap — e.g. writes
        // spaced wider than the window, or an in-flight request straddling the
        // re-boot — are made safe by @rudderjs/core's single-flight boot + the
        // handleRequest boot gate; this only removes the common trigger.)
        const DEBOUNCE_MS = 100
        const pending = new Set<string>()
        let timer: ReturnType<typeof setTimeout> | undefined
        server.watcher.on('change', (file) => {
          if (!allWatchDirs.some(d => file.startsWith(d))) return
          if (file.startsWith(viewsRoot)) return
          // The routes scanner's own emit (routes/__registry.d.ts) — a type
          // augmentation, never imported at runtime; re-bootstrapping on its
          // write would chain a second reboot after every route edit.
          if (file.endsWith(`${path.sep}__registry.d.ts`)) return

          pending.add(file)
          if (timer) clearTimeout(timer)
          timer = setTimeout(() => {
            timer = undefined
            const files = [...pending]
            pending.clear()
            performReboot(server, files, cwd)
          }, DEBOUNCE_MS)
          // Don't keep the dev process alive solely for a pending reload.
          timer.unref?.()
        })
      },
    },
    {
      name: 'rudderjs:config',
      configResolved(config) {
        // Suppress benign sourcemap warnings for our own @rudderjs/* packages.
        // Vite emits these via logger.warnOnce() because each package ships a
        // dist/*.js.map whose `sources` point at ../src/*.ts; the pnpm workspace
        // symlink (node_modules/@rudderjs/x → packages/x) makes Vite resolve that
        // to the real packages/x/src path, which it considers "outside" the
        // node_modules package dir. The maps are correct (they power accurate
        // dev-error stack remapping) — this is just startup noise. Two wordings:
        //   - "missing source files"                       (older Vite)
        //   - "points to a source file outside its package" (Vite 8)
        const filter = (msg: string) =>
          msg.includes('Sourcemap') &&
          (msg.includes('missing source files') ||
            msg.includes('points to a source file outside its package')) &&
          msg.includes('@rudderjs')
        const origWarn     = config.logger.warn.bind(config.logger)
        const origWarnOnce = config.logger.warnOnce.bind(config.logger)
        config.logger.warn     = (msg, opts) => { if (!filter(msg)) origWarn(msg, opts) }
        config.logger.warnOnce = (msg, opts) => { if (!filter(msg)) origWarnOnce(msg, opts) }
      },
      config(_config, env) {
        // Watched packages join ssr.noExternal in DEV only, so Vite owns them
        // in the SSR module graph and re-evaluates them on change. In build we
        // leave externalization untouched.
        const noExternal = env.command === 'serve'
          ? [...SSR_NO_EXTERNALS, ...watchPackages]
          : SSR_NO_EXTERNALS
        return {
          resolve: {
            alias: [
              { find: '@',        replacement: path.resolve(process.cwd(), 'src') },
              { find: /^App\//,   replacement: path.resolve(process.cwd(), 'app') + '/' },
            ],
          },
          // `@rudderjs/view` is imported from routes/web.ts during SSR. Vite's
          // first-run dep pre-bundler can't resolve it when the package is
          // linked via pnpm overrides in a non-workspace project (e.g. a
          // fresh scaffolded app pointing at a local rudderjs checkout) —
          // the second `vike dev` invocation succeeds because Vite's cache
          // is warm, but the first cold boot fails with a cryptic
          // "Cannot find module '@rudderjs/view'" error. Excluding it from
          // dep optimization lets Vite resolve it via normal Node ESM and
          // skips the flaky scan.
          optimizeDeps: {
            exclude: ['@rudderjs/view'],
          },
          ssr: {
            external: SSR_EXTERNALS,
            noExternal,
          },
          build: {
            rollupOptions: {
              external: (id: string, importer: string | undefined, isResolved: boolean) => {
                // Externalize known server-only packages
                if (SSR_EXTERNALS.some(e => id === e || id.startsWith(e + '/'))) return true
                // Externalize node: built-ins that leak through @rudderjs/* packages
                if (id.startsWith('node:')) return true
                return false
              },
              onwarn(warning, warn) {
                // Suppress "externalized for browser compatibility" for server-only
                // packages — node:crypto (middleware), node:module (support), ioredis.
                if (
                  warning.message.includes('has been externalized for browser compatibility') &&
                  (warning.message.includes('/packages/middleware/') ||
                    warning.message.includes('/packages/support/') ||
                    warning.message.includes('/packages/storage/') ||
                    warning.message.includes('ioredis'))
                ) return
                // Suppress sourcemap errors from vendor:publish copies (tsx without maps).
                if (warning.message.includes('Error when using sourcemap')) return
                warn(warning)
              },
            },
          },
        }
      },
    },
  ]
}

export default rudderjs
