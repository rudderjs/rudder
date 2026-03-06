import path from 'node:path'
import { createRequire } from 'node:module'
import type { Plugin } from 'vite'

// ─── SSR / build externals ─────────────────────────────────

const SSR_EXTERNALS = [
  '@clack/core',
  '@clack/prompts',
  '@boostkit/queue-inngest',
  '@boostkit/queue-bullmq',
  '@boostkit/mail-nodemailer',
  '@boostkit/orm-drizzle',
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
        name: 'boostkit:config',
        onLog(level, log) {
          // Suppress "Sourcemap points to missing source files" for @boostkit/* packages.
          // These warnings fire because published dist/ has sourcemaps referencing the
          // original .ts sources which are not shipped in the npm package.
          if (
            level === 'warn' &&
            log.message.includes('Sourcemap') &&
            log.message.includes('missing source files') &&
            log.message.includes('@boostkit')
          ) {
            return false
          }
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
