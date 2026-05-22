import fs from 'node:fs'
import path from 'node:path'
import { registerDoctorCheck, type DoctorResult } from '@rudderjs/console'
import { fileExists, mtimeMs, readJsonSafe } from './_fs.js'

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
    ].filter(name => name.startsWith('@rudderjs/') || name === 'create-rudder' || name === 'create-rudder-app')

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
