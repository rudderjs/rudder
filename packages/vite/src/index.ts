import path from 'node:path'
import type { EnvironmentModuleNode, Plugin, ViteDevServer } from 'vite'
import { viewsScannerPlugin } from './views-scanner.js'
import { routesScannerPlugin } from './routes-scanner.js'

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
  return true
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
export function rudderjs(): Plugin[] {
  return [
    viewsScannerPlugin(),
    routesScannerPlugin(),
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

        for (const dir of watchDirs) server.watcher.add(dir)
        server.watcher.on('change', (file) => {
          if (!watchDirs.some(d => file.startsWith(d))) return
          if (file.startsWith(viewsRoot)) return

          // RUDDER_HMR_TRACE=1 — segment the reload wall-clock. t0 is stashed on
          // globalThis so @rudderjs/core's _bootstrapProviders() can measure the
          // watcher→reimport gap (Vite/Vike re-fetch) and reboot→ready.
          const trace = process.env['RUDDER_HMR_TRACE'] === '1'
          const t0 = trace ? performance.now() : 0

          // Clear the two top-level singletons so a new RudderJS + Application
          // pair is created when the module re-executes. App files (models,
          // resources, controllers) are captured in closures during bootstrap
          // so they also need a full re-bootstrap to pick up changes.
          const g = globalThis as Record<string, unknown>
          if (trace) g['__rudderjs_hmr_t0__'] = t0
          delete g['__rudderjs_instance__']
          delete g['__rudderjs_app__']
          const tCleared = trace ? performance.now() : 0

          // Invalidate only the changed file's import subtree (up to the
          // bootstrap entry) so Vike re-executes bootstrap/app.ts and the edited
          // module on the next request, while framework packages and unrelated
          // app modules stay warm. Falls back to invalidating the whole graph
          // when the file isn't tracked in the SSR graph. Lighter than
          // server.restart() and safe while requests are in flight.
          const scoped = invalidateBackendSubtree(server, file, cwd)
          if (!scoped) server.environments.ssr.moduleGraph.invalidateAll()
          const tInvalidated = trace ? performance.now() : 0

          // Tell the browser to do a full page reload so it picks up the
          // changes via a fresh SSR request.
          server.hot.send({ type: 'full-reload' })
          if (trace) {
            console.log(`[hmr] clear-globals ${(tCleared - t0).toFixed(1)}ms · invalidate ${(tInvalidated - tCleared).toFixed(1)}ms (${scoped ? 'scoped' : 'all'})`)
          }
          console.log(`[RudderJS] change detected — reloading (${path.relative(cwd, file)})`)
        })
      },
    },
    {
      name: 'rudderjs:config',
      configResolved(config) {
        // Suppress "Sourcemap points to missing source files" for @rudderjs/* packages.
        // Vite emits these via logger.warnOnce() when published dist/ has sourcemaps
        // referencing the original .ts sources not shipped in the npm package.
        const filter = (msg: string) =>
          // Suppress sourcemap warnings for published @rudderjs/* packages
          msg.includes('Sourcemap') &&
          msg.includes('missing source files') &&
          msg.includes('@rudderjs')
        const origWarn     = config.logger.warn.bind(config.logger)
        const origWarnOnce = config.logger.warnOnce.bind(config.logger)
        config.logger.warn     = (msg, opts) => { if (!filter(msg)) origWarn(msg, opts) }
        config.logger.warnOnce = (msg, opts) => { if (!filter(msg)) origWarnOnce(msg, opts) }
      },
      config() {
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
            noExternal: SSR_NO_EXTERNALS,
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
