// node:fs and node:path are imported lazily inside `defaultProviders()` so this
// module stays safe to include in browser bundles. Vite externalizes node:* in
// client builds, and a top-level import would crash the browser the moment any
// client code transitively touches @rudderjs/core's barrel export.
import { resolveOptionalPeer, config, Env } from '@rudderjs/support'
import type { Application } from './application.js'
import type { ServiceProvider } from './service-provider.js'
import type { ProviderEntry, ProviderManifest } from './provider-registry.js'
import { BUILTIN_REGISTRY } from './provider-registry.js'
import { sortByStageAndDepends } from './provider-sort.js'

export type ProviderClass = new (app: Application) => ServiceProvider

export interface DefaultProvidersOptions {
  /** Package names to skip even if installed + listed in the manifest. */
  skip?: string[]
}

// Cached on globalThis (not a module-level let) because Vite SSR can isolate the
// writer (bootstrap/providers.ts) and the reader (Application._bootstrapProviders())
// into different module instances — the read would see [] and the boot log would
// silently not print. Same pattern as __rudderjs_app__, __rudderjs_telescope_recording__.
const LAST_LOADED_KEY = '__rudderjs_last_loaded_providers__'
type GlobalWithEntries = typeof globalThis & { [LAST_LOADED_KEY]?: ProviderEntry[] }

/** @internal — read by Application._bootstrapProviders() to print the dev-mode boot log. */
export function getLastLoadedProviderEntries(): ProviderEntry[] {
  return (globalThis as GlobalWithEntries)[LAST_LOADED_KEY] ?? []
}

/**
 * Returns the framework's default provider classes, sorted by stage + depends.
 *
 * Resolution order (self-healing — no manual `providers:discover` needed):
 *   1. `bootstrap/cache/providers.json` manifest, when its fingerprint matches the
 *      current dependency state.
 *   2. Manifest missing or stale → scan node_modules at boot. In development the
 *      manifest is rewritten; in production a stale manifest is still honored
 *      (deterministic boots) with a warning, and a missing one is scanned in
 *      memory with a warning — bake the manifest via `rudder providers:discover`
 *      in your build step for bundled/serverless deploys.
 *   3. Built-in minimal registry as a last resort (no node_modules to scan).
 *
 * Each entry's `package` is dynamically imported via `resolveOptionalPeer`.
 * Missing non-optional packages log a warning and are skipped; missing optional
 * packages are skipped silently. Entries with `autoDiscover: false` are dropped
 * — set this in your `package.json`'s `rudderjs` field to opt out.
 *
 * Multi-driver collisions (e.g. orm-prisma + orm-drizzle) are resolved via
 * `config('database.driver')`; first installed wins if no driver is configured.
 *
 * Async because it calls `import()` under the hood — use top-level await in
 * `bootstrap/providers.ts`. Resolution happens once at module load.
 *
 * @example
 * // bootstrap/providers.ts
 * import { defaultProviders } from '@rudderjs/core'
 * import { AppServiceProvider } from '../app/Providers/AppServiceProvider.js'
 *
 * export default [
 *   ...(await defaultProviders()),
 *   AppServiceProvider,
 * ]
 *
 * @example
 * // Skip a specific framework provider
 * export default [
 *   ...(await defaultProviders({ skip: ['@rudderjs/horizon'] })),
 *   AppServiceProvider,
 * ]
 */
export async function defaultProviders(options: DefaultProvidersOptions = {}): Promise<ProviderClass[]> {
  const skip = new Set(options.skip ?? [])

  // Lazy-load node:* so this module stays browser-safe at the top level.
  const { readFileSync } = await import('node:fs')
  const path             = await import('node:path')

  const cwd = process.cwd()
  // Same env derivation as Application (APP_ENV, defaulting to production —
  // the safe side: production never auto-rewrites the manifest).
  const isProduction = Env.get('APP_ENV', 'production') === 'production'

  // 1. Read the manifest (cached fast path)
  let manifest: ProviderManifest | undefined
  try {
    manifest = JSON.parse(readFileSync(path.join(cwd, 'bootstrap/cache/providers.json'), 'utf-8')) as ProviderManifest
  } catch {
    // missing or unreadable — handled below
  }

  // 2. Self-heal: scan node_modules when the manifest is missing or stale.
  // commands/providers-discover.js has top-level node:* imports, so it is
  // lazy-loaded here to keep this module browser-safe at eval time.
  let entries: ProviderEntry[] | undefined = manifest?.providers

  if (manifest) {
    try {
      const { computeFingerprint, isFingerprintStale, scanProviders, writeProviderManifest } =
        await import('./commands/providers-discover.js')
      if (isFingerprintStale(manifest.fingerprint, computeFingerprint(cwd))) {
        if (isProduction) {
          // Honor the manifest — deterministic boots win in production. Legacy
          // v2 manifests (no fingerprint) are used silently; a genuinely stale
          // v3 fingerprint warns.
          if (manifest.version >= 3) {
            console.warn(
              '[RudderJS] provider manifest is stale (dependencies changed since it was generated). ' +
              'Using it anyway — run `rudder providers:discover` in your build step to refresh.',
            )
          }
        } else {
          const scanned = scanProviders(cwd)
          if (scanned.length > 0) {
            entries = scanned
            try { writeProviderManifest(cwd, scanned) } catch { /* read-only fs — in-memory result still used */ }
            console.log('[RudderJS] provider manifest regenerated (dependencies changed)')
          }
        }
      }
    } catch {
      // Fingerprint check failed — use the manifest as-is.
    }
  } else {
    try {
      const { scanProviders, writeProviderManifest } = await import('./commands/providers-discover.js')
      const scanned = scanProviders(cwd)
      if (scanned.length > 0) {
        entries = scanned
        try { writeProviderManifest(cwd, scanned) } catch { /* read-only fs — in-memory result still used */ }
        if (isProduction) {
          console.warn(
            '[RudderJS] no provider manifest found — scanned node_modules at boot. ' +
            'Run `rudder providers:discover` in your build step to bake bootstrap/cache/providers.json.',
          )
        } else {
          console.log('[RudderJS] provider manifest generated (bootstrap/cache/providers.json)')
        }
      }
    } catch {
      // Scan failed — fall through to the built-in registry.
    }
  }

  // 3. Last resort: built-in minimal registry (no manifest, nothing to scan)
  entries ??= sortByStageAndDepends(BUILTIN_REGISTRY)

  // 4. Drop entries explicitly opted out of auto-discovery
  entries = entries.filter(e => e.autoDiscover !== false)

  // 5. Resolve multi-driver collisions (e.g. orm-prisma vs orm-drizzle)
  entries = resolveMultiDriver(entries, '@rudderjs/orm-', 'database.driver', 'DB_DRIVER')

  // 6. Filter installed + skipped, then resolve each class
  const providers: ProviderClass[] = []
  const loaded:    ProviderEntry[] = []

  for (const entry of entries) {
    if (skip.has(entry.package)) continue

    const importSpecifier = entry.providerSubpath
      ? `${entry.package}/${entry.providerSubpath.replace(/^\.\//, '')}`
      : entry.package

    let mod: Record<string, unknown>
    try {
      mod = await resolveOptionalPeer(importSpecifier)
    } catch {
      if (!entry.optional) {
        console.warn(
          `[RudderJS] ${entry.package} listed in the provider manifest but not installed. ` +
          `Run \`pnpm rudder providers:discover\` after installing or removing packages.`,
        )
      }
      continue
    }

    const ProviderClass = mod[entry.provider]
    if (typeof ProviderClass !== 'function') {
      throw new Error(
        `[RudderJS] ${entry.package} declared provider "${entry.provider}" in package.json ` +
        `but no such class is exported from its main entry.`,
      )
    }

    providers.push(ProviderClass as ProviderClass)
    loaded.push(entry)
  }

  ;(globalThis as GlobalWithEntries)[LAST_LOADED_KEY] = loaded
  return providers
}

/**
 * When multiple packages share a prefix (e.g. `@rudderjs/orm-prisma`,
 * `@rudderjs/orm-drizzle`), pick one driver; the others are filtered out.
 *
 * `defaultProviders()` runs at module-eval time (in `bootstrap/providers.ts`),
 * BEFORE `Application.create()` binds the config repository, so `config(configKey)`
 * reads `undefined` here. The env var IS available at eval time, so it is the
 * primary selector; `config()` is a fallback for callers that run after the repo
 * is bound. Falls back to "first installed wins" when neither is set.
 */
export function resolveMultiDriver(
  entries:   ProviderEntry[],
  prefix:    string,
  configKey: string,
  envKey:    string,
): ProviderEntry[] {
  const drivers = entries.filter(e => e.package.startsWith(prefix))
  if (drivers.length <= 1) return entries

  const chosen = Env.get(envKey, '') || config<string>(configKey)
  let winner: ProviderEntry | undefined

  if (chosen) {
    winner = drivers.find(d => d.package.includes(chosen))
    if (!winner) {
      throw new Error(
        `[RudderJS] Multiple ${prefix}* drivers installed but the selected driver "${chosen}" ` +
        `(from ${envKey} env or config('${configKey}')) doesn't match any of: ` +
        `${drivers.map(d => d.package).join(', ')}.`,
      )
    }
  } else {
    winner = drivers[0]
  }

  return entries.filter(e => !drivers.includes(e) || e === winner)
}
