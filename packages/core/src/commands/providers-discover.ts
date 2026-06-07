import { readFileSync, readdirSync, writeFileSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'
import { sortByStageAndDepends } from '../provider-sort.js'
import type { ManifestFingerprint, ProviderEntry, ProviderManifest } from '../provider-registry.js'

interface RudderJsField {
  provider:        string
  stage:           ProviderEntry['stage']
  depends?:        string[]
  optional?:       boolean
  autoDiscover?:   boolean
  providerSubpath?: string
}

/**
 * Scan node_modules for packages that declare a `rudderjs` field in their
 * package.json and return sorted provider entries.
 */
export function scanProviders(cwd: string): ProviderEntry[] {
  const nodeModules = path.join(cwd, 'node_modules')
  const entries = scanNodeModules(nodeModules)
  return sortByStageAndDepends(entries)
}

/** Lockfiles checked (in order) when fingerprinting the dependency state. */
const LOCKFILES = ['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'bun.lock', 'bun.lockb']

/**
 * Fingerprint the dependency state the scan ran against, so the boot path can
 * detect a stale manifest. `depsHash` catches package.json edits (add/remove);
 * the lockfile stat (size/mtime only — the multi-MB file is never read)
 * catches in-range updates that swap an installed package's `rudderjs` field.
 * Absent inputs are omitted; the staleness check skips missing fields.
 */
export function computeFingerprint(cwd: string): ManifestFingerprint {
  const fingerprint: ManifestFingerprint = {}

  try {
    const pkg = JSON.parse(readFileSync(path.join(cwd, 'package.json'), 'utf-8')) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    fingerprint.depsHash = createHash('sha256')
      .update(JSON.stringify({ dependencies: pkg.dependencies ?? {}, devDependencies: pkg.devDependencies ?? {} }))
      .digest('hex')
  } catch {
    // No readable package.json — fingerprint stays partial.
  }

  for (const name of LOCKFILES) {
    try {
      const stat = statSync(path.join(cwd, name))
      fingerprint.lockfile = { name, size: stat.size, mtimeMs: stat.mtimeMs }
      break
    } catch {
      // try the next lockfile
    }
  }

  return fingerprint
}

/** A manifest is stale when any fingerprint field that exists on both sides differs. */
export function isFingerprintStale(stored: ManifestFingerprint | undefined, current: ManifestFingerprint): boolean {
  if (!stored) return true // legacy v2 manifest — no fingerprint to trust
  if (stored.depsHash && current.depsHash && stored.depsHash !== current.depsHash) return true
  if (stored.lockfile && current.lockfile) {
    const a = stored.lockfile, b = current.lockfile
    if (a.name !== b.name || a.size !== b.size || a.mtimeMs !== b.mtimeMs) return true
  }
  return false
}

/**
 * Write the provider manifest to bootstrap/cache/providers.json.
 *
 * Atomic (tmp + rename) so a concurrently booting process never reads a
 * half-written manifest — the boot path may now write this file too.
 */
export function writeProviderManifest(cwd: string, sorted: ProviderEntry[]): string {
  const manifest: ProviderManifest = {
    version:     3,
    generated:   new Date().toISOString(),
    fingerprint: computeFingerprint(cwd),
    providers:   sorted,
  }

  const cacheDir = path.join(cwd, 'bootstrap/cache')
  mkdirSync(cacheDir, { recursive: true })
  const manifestPath = path.join(cacheDir, 'providers.json')
  const tmpPath = path.join(cacheDir, `.providers.json.${randomUUID()}.tmp`)
  writeFileSync(tmpPath, JSON.stringify(manifest, null, 2) + '\n')
  renameSync(tmpPath, manifestPath)
  return manifestPath
}

function scanNodeModules(nodeModules: string): ProviderEntry[] {
  const out: ProviderEntry[] = []
  let scopes: string[]
  try {
    scopes = readdirSync(nodeModules)
  } catch {
    return out
  }

  for (const scope of scopes) {
    if (!scope.startsWith('@')) continue

    let pkgs: string[]
    try {
      pkgs = readdirSync(path.join(nodeModules, scope))
    } catch {
      continue
    }

    for (const pkg of pkgs) {
      const pkgJsonPath = path.join(nodeModules, scope, pkg, 'package.json')
      try {
        const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf-8')) as {
          name?:     string
          rudderjs?: RudderJsField
        }
        if (!pkgJson.rudderjs || !pkgJson.name) continue

        const field = pkgJson.rudderjs

        // Honor opt-out: don't even include in the manifest.
        if (field.autoDiscover === false) continue

        const entry: ProviderEntry = {
          package:  pkgJson.name,
          provider: field.provider,
          stage:    field.stage,
        }
        if (field.depends)         entry.depends         = field.depends
        if (field.optional)        entry.optional        = field.optional
        if (field.providerSubpath) entry.providerSubpath = field.providerSubpath

        out.push(entry)
      } catch {
        // unreadable / not a package
      }
    }
  }

  return out
}
