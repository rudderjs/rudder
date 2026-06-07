/**
 * Provider auto-discovery types + the minimal built-in registry.
 *
 * The built-in registry exists so a fresh dev clone can boot before the user
 * has run `pnpm rudder providers:discover` even once. It is intentionally
 * minimal — six foundation/infrastructure entries that are almost certainly
 * installed in any RudderJS app. Real apps get the full picture from the
 * generated manifest at `bootstrap/cache/providers.json`.
 */

export type ProviderStage = 'foundation' | 'infrastructure' | 'feature' | 'monitoring'

export interface ProviderEntry {
  package:       string
  provider:      string
  stage:         ProviderStage
  depends?:      string[]
  /** Skip without error if the package is not installed. Default: false. */
  optional?:     boolean
  /**
   * Opt out of auto-discovery. The package author or user can set this to false
   * to force explicit registration. Default: true.
   */
  autoDiscover?: boolean
  /**
   * Subpath to import the provider class from, e.g. `./server`. When set, the
   * loader imports `<package>/<providerSubpath>` instead of the package's main
   * entry. Used by packages that split their server-only code (e.g. `@rudderjs/ai`)
   * away from a runtime-agnostic main entry.
   */
  providerSubpath?: string
}

/**
 * Fingerprint of the dependency state a manifest was scanned from. Lets
 * `defaultProviders()` detect a stale manifest (raw `pnpm add/remove/update`
 * without a `providers:discover` run) and self-heal at boot.
 */
export interface ManifestFingerprint {
  /** sha256 of JSON({ dependencies, devDependencies }) from the app package.json. */
  depsHash?: string
  /** Stat of the first lockfile found — size/mtime only, the file is never read. */
  lockfile?: { name: string; size: number; mtimeMs: number }
}

export interface ProviderManifest {
  /** v2 = legacy (no fingerprint); v3 adds `fingerprint`. */
  version:      2 | 3
  generated:    string
  fingerprint?: ManifestFingerprint
  providers:    ProviderEntry[]
}

/**
 * Minimal fallback registry — used when no manifest exists.
 * Real apps run `pnpm rudder providers:discover` and get a full manifest.
 */
export const BUILTIN_REGISTRY: ProviderEntry[] = [
  { package: '@rudderjs/log',        provider: 'LogProvider',      stage: 'foundation',     optional: true },
  { package: '@rudderjs/orm-prisma', provider: 'DatabaseProvider', stage: 'infrastructure', optional: true },
  { package: '@rudderjs/session',    provider: 'SessionProvider',  stage: 'infrastructure', optional: true },
  { package: '@rudderjs/hash',       provider: 'HashProvider',     stage: 'infrastructure', optional: true },
  { package: '@rudderjs/cache',      provider: 'CacheProvider',    stage: 'infrastructure', optional: true,
    depends: ['@rudderjs/log'] },
  { package: '@rudderjs/auth',       provider: 'AuthProvider',     stage: 'infrastructure', optional: true,
    depends: ['@rudderjs/session', '@rudderjs/hash'] },
]
