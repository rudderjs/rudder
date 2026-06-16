import fs from 'node:fs'
import path from 'node:path'
import { registerDoctorCheck, type DoctorResult } from '@rudderjs/console'
import { fileExists, mtimeMs, readFileSafe, readJsonSafe } from './_fs.js'

interface AppPkg {
  dependencies?:    Record<string, string>
  devDependencies?: Record<string, string>
}

function isResolvable(pkg: string): boolean {
  const target = path.join(process.cwd(), 'node_modules', pkg, 'package.json')
  try { return fs.statSync(target).isFile() } catch { return false }
}

registerDoctorCheck({
  id:       'deps:providers-manifest',
  category: 'deps',
  title:    'providers manifest',
  run(): DoctorResult {
    // Manual-composition path: bootstrap/providers.ts that does NOT call
    // defaultProviders() doesn't need the auto-discovery manifest at all.
    // Detect by absence of the call (not by array-literal shape, which also
    // matches the standard scaffolded template `[...(await defaultProviders())]`).
    const providersTs = readFileSafe('bootstrap/providers.ts')
    if (providersTs !== null && !/\bdefaultProviders\s*\(/.test(providersTs)) {
      return { status: 'ok', message: 'manual composition (no auto-discovery)' }
    }
    const manifest = 'bootstrap/cache/providers.json'
    if (!fileExists(manifest)) {
      return {
        status:  'warn',
        message: 'missing — providers won\'t auto-discover',
        fix:     'pnpm rudder providers:discover',
      }
    }
    const manifestMtime = mtimeMs(manifest)
    const pkgMtime      = mtimeMs('package.json')
    if (manifestMtime !== null && pkgMtime !== null && manifestMtime < pkgMtime) {
      return {
        status:  'warn',
        message: 'older than package.json — packages added since last refresh',
        fix:     'pnpm rudder providers:discover',
      }
    }
    return { status: 'ok', message: 'present and current' }
  },
  async fixer(): Promise<DoctorResult> {
    // Same logic as `rudder providers:discover` but invoked in-process so
    // --fix doesn't shell out. `@rudderjs/core/commands/providers-discover`
    // re-exports the two pure pieces — scanner + writer.
    try {
      const { scanProviders, writeProviderManifest } = await import(
        /* @vite-ignore */ '@rudderjs/core/commands/providers-discover'
      ) as typeof import('@rudderjs/core/commands/providers-discover')
      const sorted = scanProviders(process.cwd())
      writeProviderManifest(process.cwd(), sorted)
      return { status: 'ok', message: `regenerated (${sorted.length} provider${sorted.length === 1 ? '' : 's'})` }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return { status: 'error', message: `could not regenerate: ${msg}` }
    }
  },
})

registerDoctorCheck({
  id:       'deps:declared-installed',
  category: 'deps',
  title:    '@rudderjs/* installed',
  run(): DoctorResult {
    const pkg = readJsonSafe<AppPkg>('package.json')
    if (!pkg) {
      return { status: 'error', message: 'package.json unreadable', fix: 'Check the file exists and is valid JSON' }
    }
    const declared = [
      ...Object.keys(pkg.dependencies    ?? {}),
      ...Object.keys(pkg.devDependencies ?? {}),
    ].filter(name => name.startsWith('@rudderjs/') || name === 'create-rudder')

    const missing = declared.filter(name => !isResolvable(name))
    if (missing.length > 0) {
      return {
        status:  'error',
        message: `${missing.length} declared but not in node_modules: ${missing.join(', ')}`,
        fix:     'Run your package manager install (e.g. `pnpm install`)',
      }
    }
    return { status: 'ok', message: `${declared.length} declared, all resolvable` }
  },
})

// `deps:auth-views` moved to @rudderjs/auth/doctor in Phase 3 — it's a
// package-specific concern that lives with the package that owns it.

/** Merged dependencies + devDependencies key set. */
function allDeps(pkg: AppPkg): Set<string> {
  return new Set([
    ...Object.keys(pkg.dependencies    ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
  ])
}

registerDoctorCheck({
  id:       'deps:single-orm-driver',
  category: 'deps',
  title:    'ORM driver',
  run(): DoctorResult {
    const pkg = readJsonSafe<AppPkg>('package.json')
    if (!pkg) return { status: 'ok', message: 'package.json unreadable (skipped)' }
    // Any `@rudderjs/orm-*` is an adapter (orm-prisma, orm-drizzle, …); the bare
    // `@rudderjs/orm` / `@rudderjs/database` native engine is not prefixed `orm-`.
    const drivers = [...allDeps(pkg)].filter(name => name.startsWith('@rudderjs/orm-'))
    if (drivers.length <= 1) {
      return { status: 'ok', message: drivers[0] ?? 'native engine' }
    }
    return {
      status:  'warn',
      message: `${drivers.length} ORM adapters installed (${drivers.join(', ')}) — one is selected silently`,
      fix:     'Remove the unused adapter, or set DB_DRIVER (e.g. DB_DRIVER=prisma) / config("database.driver") to choose explicitly',
    }
  },
})

// The view scanner requires exactly one Vike renderer installed; two or more
// makes it throw a cryptic "multi-renderer" error. Surface it as a clear,
// actionable check. (vike-react-rsc-rudder is intentionally excluded — it is an
// RSC variant that can legitimately sit alongside its base.)
const VIKE_RENDERERS = ['vike-react', 'vike-vue', 'vike-solid'] as const

registerDoctorCheck({
  id:       'deps:single-vike-renderer',
  category: 'deps',
  title:    'Vike renderer',
  run(): DoctorResult {
    const pkg = readJsonSafe<AppPkg>('package.json')
    if (!pkg) return { status: 'ok', message: 'package.json unreadable (skipped)' }
    const deps  = allDeps(pkg)
    const found = VIKE_RENDERERS.filter(r => deps.has(r))
    if (found.length <= 1) {
      return { status: 'ok', message: found[0] ?? 'none (vanilla / no controller views)' }
    }
    const toRemove = found.slice(1)
    return {
      status:  'error',
      message: `${found.length} Vike renderers installed (${found.join(', ')}) — the view scanner needs exactly one`,
      fix:     `Keep one and remove the rest, e.g. \`pnpm remove ${toRemove.join(' ')}\``,
    }
  },
})
