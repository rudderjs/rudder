import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { sortByStageAndDepends } from '../provider-sort.js'
import type { ProviderEntry, ProviderManifest } from '../provider-registry.js'

interface RudderJsField {
  provider:      string
  stage:         ProviderEntry['stage']
  depends?:      string[]
  optional?:     boolean
  autoDiscover?: boolean
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

/**
 * Write the provider manifest to bootstrap/cache/providers.json.
 */
export function writeProviderManifest(cwd: string, sorted: ProviderEntry[]): string {
  const manifest: ProviderManifest = {
    version:   2,
    generated: new Date().toISOString(),
    providers: sorted,
  }

  const cacheDir = path.join(cwd, 'bootstrap/cache')
  mkdirSync(cacheDir, { recursive: true })
  const manifestPath = path.join(cacheDir, 'providers.json')
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
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
        if (field.depends)  entry.depends  = field.depends
        if (field.optional) entry.optional = field.optional

        out.push(entry)
      } catch {
        // unreadable / not a package
      }
    }
  }

  return out
}
