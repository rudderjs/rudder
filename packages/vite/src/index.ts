import path from 'node:path'
import { createRequire } from 'node:module'
import type { Plugin } from 'vite'

// ─── SSR / build externals ─────────────────────────────────

const SSR_EXTERNALS = [
  // CLI-only — uses node:process stdin/readline
  '@clack/core',
  '@clack/prompts',
  // Queue adapters — server-only
  '@rudderjs/queue-inngest',
  '@rudderjs/queue-bullmq',
  // ORM adapters — server-only
  '@rudderjs/orm-drizzle',
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

// ─── Helpers ───────────────────────────────────────────────

// Resolve from the app root so we pick up the user's installed packages,
// not a copy inside packages/vite/node_modules.
const _require = createRequire(process.cwd() + '/package.json')

// ─── Main plugin ───────────────────────────────────────────

/**
 * RudderJS Vite plugin.
 *
 * Registers Vike, sets the @/ path alias, and externalises RudderJS
 * optional-peer packages from the SSR bundle.
 *
 * Add your UI framework plugin (react, vue, solid…) separately.
 *
 * @example
 * // vite.config.ts
 * import { defineConfig } from 'vite'
 * import rudderjs from '@rudderjs/vite'
 * import tailwindcss from '@tailwindcss/vite'
 * import react from '@vitejs/plugin-react'
 *
 * export default defineConfig({
 *   plugins: [rudderjs(), tailwindcss(), react()],
 * })
 */
export function rudderjs(): Promise<Plugin[]> {
  // Build plugins asynchronously — we need a dynamic import to guarantee we
  // load vike from the *app root* (not packages/vite/node_modules).
  const promise = (async (): Promise<Plugin[]> => {
    let vikePlugins: Plugin[] = []
    try {
      const vikePath = _require.resolve('vike/plugin')
      const vikeMod = await import(vikePath) as { default: () => Promise<Plugin[]> }
      vikePlugins = await vikeMod.default()
    } catch {
      console.warn('[RudderJS] vike not found — install vike to enable SSR support.')
    }

    return [
      ...vikePlugins,
      {
        name: 'rudderjs:ws',
        configureServer(server) {
          // Attach the WebSocket upgrade handler to Vite's own HTTP server.
          // @rudderjs/broadcast and @rudderjs/live register their handlers on
          // globalThis['__rudderjs_ws_upgrade__'] during provider boot. We listen
          // for 'upgrade' events and forward them to that handler.
          //
          // Set a sentinel flag so @rudderjs/server-hono's module-load patch knows
          // to skip — otherwise both would attach upgrade listeners and
          // handleUpgrade() would be called twice for the same socket.
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
          setTimeout(() => clearInterval(interval), 10_000)

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
  })()

  // Attach _vikeVitePluginOptions to the Promise itself.
  // Vike's self-detection scans the *raw* (unresolved) plugins array for this
  // property — finding it here prevents the deprecation warning and the
  // "added 2 times" double-registration error.
  Object.assign(promise, { _vikeVitePluginOptions: {} })

  return promise
}

export default rudderjs
