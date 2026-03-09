import path from 'node:path'
import { createRequire } from 'node:module'
import type { Plugin } from 'vite'

// ─── SSR / build externals ─────────────────────────────────

const SSR_EXTERNALS = [
  '@clack/core',
  '@clack/prompts',
  '@boostkit/queue-inngest',
  '@boostkit/queue-bullmq',
  '@boostkit/orm-drizzle',
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
]

// ─── SSR no-externals ──────────────────────────────────────
// @boostkit/server-hono dynamically imports @photonjs/hono which contains
// virtual module imports (virtual:photon:get-middlewares:*). When loaded
// natively (as an externalized npm package), these virtual imports fail
// with ERR_UNSUPPORTED_ESM_URL_SCHEME. Marking it non-external forces
// Vite's runner to process it, so @photonjs/hono is also processed through
// Vite's plugin system where virtual modules are properly resolved.
const SSR_NO_EXTERNALS = [
  '@boostkit/server-hono',
]

// ─── Helpers ───────────────────────────────────────────────

// Resolve from the app root so we pick up the user's installed packages,
// not a copy inside packages/vite/node_modules.
const _require = createRequire(process.cwd() + '/package.json')

// ─── Main plugin ───────────────────────────────────────────

/**
 * BoostKit Vite plugin.
 *
 * Registers Vike, sets the @/ path alias, and externalises BoostKit
 * optional-peer packages from the SSR bundle.
 *
 * Add your UI framework plugin (react, vue, solid…) separately.
 *
 * @example
 * // vite.config.ts
 * import { defineConfig } from 'vite'
 * import boostkit from '@boostkit/vite'
 * import tailwindcss from '@tailwindcss/vite'
 * import react from '@vitejs/plugin-react'
 *
 * export default defineConfig({
 *   plugins: [boostkit(), tailwindcss(), react()],
 * })
 */
export function boostkit(): Promise<Plugin[]> {
  // Build plugins asynchronously — we need a dynamic import to guarantee we
  // load vike from the *app root* (not packages/vite/node_modules).
  const promise = (async (): Promise<Plugin[]> => {
    let vikePlugins: Plugin[] = []
    try {
      const vikePath = _require.resolve('vike/plugin')
      const vikeMod = await import(vikePath) as { default: () => Promise<Plugin[]> }
      vikePlugins = await vikeMod.default()
    } catch {
      console.warn('[BoostKit] vike not found — install vike to enable SSR support.')
    }

    return [
      ...vikePlugins,
      {
        name: 'boostkit:ws',
        configureServer() {
          // vike-photon patches vite.httpServer with { on: () => {} } (a no-op), so we
          // cannot rely on server.httpServer. Instead, intercept http.createServer so we
          // attach our upgrade handler to whatever Node.js HTTP server gets created next
          // (srvx creates it when initializing the photon dev server entry).
          //
          // We use createRequire to get the mutable CJS http module — ESM named exports
          // are read-only and cannot be reassigned.
          const http = _require('http') as typeof import('http')
          const orig = http.createServer.bind(http) as typeof http.createServer
          http.createServer = ((...args: Parameters<typeof http.createServer>) => {
            const srv = (orig as (...a: unknown[]) => import('node:http').Server)(...args)
            srv.on('upgrade', (req, socket, head) => {
              const handler = (globalThis as Record<string, unknown>)['__boostkit_ws_upgrade__'] as
                | ((req: unknown, socket: unknown, head: unknown) => void)
                | undefined
              handler?.(req, socket, head)
            })
            // Restore immediately so we only intercept the first server (srvx's)
            http.createServer = orig
            return srv
          }) as typeof http.createServer
        },
      },
      {
        name: 'boostkit:config',
        configResolved(config) {
          // Suppress "Sourcemap points to missing source files" for @boostkit/* packages.
          // Vite emits these via logger.warnOnce() when published dist/ has sourcemaps
          // referencing the original .ts sources not shipped in the npm package.
          const filter = (msg: string) =>
            // Suppress sourcemap warnings for published @boostkit/* packages
            msg.includes('Sourcemap') &&
            msg.includes('missing source files') &&
            msg.includes('@boostkit')
          const origWarn     = config.logger.warn.bind(config.logger)
          const origWarnOnce = config.logger.warnOnce.bind(config.logger)
          config.logger.warn     = (msg, opts) => { if (!filter(msg)) origWarn(msg, opts) }
          config.logger.warnOnce = (msg, opts) => { if (!filter(msg)) origWarnOnce(msg, opts) }
        },
        config() {
          return {
            resolve: {
              alias: { '@': path.resolve(process.cwd(), 'src') },
            },
            ssr: {
              external: SSR_EXTERNALS,
              noExternal: SSR_NO_EXTERNALS,
            },
            build: {
              rollupOptions: {
                external: (id: string) =>
                  SSR_EXTERNALS.some(e => id === e || id.startsWith(e + '/')),
                onwarn(warning, warn) {
                  // Suppress "externalized for browser compatibility" for server-only
                  // packages — node:crypto (middleware), node:module (support), ioredis.
                  if (
                    warning.message.includes('has been externalized for browser compatibility') &&
                    (warning.message.includes('/packages/middleware/') ||
                      warning.message.includes('/packages/support/') ||
                      warning.message.includes('ioredis'))
                  ) return
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

export default boostkit
