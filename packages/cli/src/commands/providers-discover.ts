import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs'
import path from 'node:path'
import type { Command } from 'commander'
import { sortByStageAndDepends } from '@rudderjs/core'
import type { ProviderEntry, ProviderManifest } from '@rudderjs/core'

const C = {
  green:   (s: string) => `\x1b[32m${s}\x1b[0m`,
  cyan:    (s: string) => `\x1b[36m${s}\x1b[0m`,
  yellow:  (s: string) => `\x1b[33m${s}\x1b[0m`,
  magenta: (s: string) => `\x1b[35m${s}\x1b[0m`,
  dim:     (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold:    (s: string) => `\x1b[1m${s}\x1b[0m`,
}

const STAGE_COLORS: Record<ProviderEntry['stage'], (s: string) => string> = {
  foundation:     C.magenta,
  infrastructure: C.cyan,
  feature:        C.green,
  monitoring:     C.yellow,
}

const STAGE_ORDER: ProviderEntry['stage'][] = ['foundation', 'infrastructure', 'feature', 'monitoring']

/** Strip the @rudderjs/ prefix for display since most entries share it. */
function shortName(pkg: string): string {
  return pkg.startsWith('@rudderjs/') ? pkg.slice('@rudderjs/'.length) : pkg
}

interface RudderJsField {
  provider:      string
  stage:         ProviderEntry['stage']
  depends?:      string[]
  optional?:     boolean
  autoDiscover?: boolean
}

/**
 * `pnpm rudder providers:discover`
 *
 * Scans node_modules for packages that declare a `rudderjs` field in their
 * package.json, sorts them by stage + depends, and writes the manifest to
 * bootstrap/cache/providers.json. The manifest is consumed by
 * `defaultProviders()` at boot time.
 */
export function providersDiscoverCommand(program: Command): void {
  program
    .command('providers:discover')
    .description('Scan node_modules for RudderJS provider packages and write the manifest')
    .action(() => {
      const cwd = process.cwd()
      const nodeModules = path.join(cwd, 'node_modules')

      if (!existsSync(nodeModules)) {
        console.error(`[providers:discover] No node_modules at ${nodeModules}`)
        process.exit(1)
      }

      const entries = scanNodeModules(nodeModules)
      const sorted  = sortByStageAndDepends(entries)
      const skipped = entries.length - entries.filter(e => e.autoDiscover !== false).length

      const manifest: ProviderManifest = {
        version:   2,
        generated: new Date().toISOString(),
        providers: sorted,
      }

      const cacheDir = path.join(cwd, 'bootstrap/cache')
      mkdirSync(cacheDir, { recursive: true })
      writeFileSync(
        path.join(cacheDir, 'providers.json'),
        JSON.stringify(manifest, null, 2) + '\n',
      )

      console.log()
      console.log(`  ${C.green('✓')} ${C.bold(`Discovered ${sorted.length} provider${sorted.length === 1 ? '' : 's'}`)}`)
      if (skipped > 0) {
        console.log(C.dim(`    ${skipped} opted out via autoDiscover: false`))
      }

      // Group by stage in canonical order
      const grouped = new Map<ProviderEntry['stage'], ProviderEntry[]>()
      for (const e of sorted) {
        const list = grouped.get(e.stage) ?? []
        list.push(e)
        grouped.set(e.stage, list)
      }

      // Calculate column widths from the entries actually present
      const nameWidth = Math.max(
        ...sorted.map(e => shortName(e.package).length),
        4,
      ) + 2

      for (const stage of STAGE_ORDER) {
        const list = grouped.get(stage)
        if (!list || list.length === 0) continue

        const stageColor = STAGE_COLORS[stage]
        console.log()
        console.log(`  ${stageColor(stage)}`)

        list.forEach((e, i) => {
          const isLast = i === list.length - 1
          const branch = isLast ? '└─' : '├─'
          const name   = shortName(e.package).padEnd(nameWidth)
          const meta: string[] = []
          if (e.depends && e.depends.length > 0) {
            meta.push(C.dim('← ' + e.depends.map(shortName).join(', ')))
          }
          if (e.optional) meta.push(C.dim('(optional)'))
          const metaStr = meta.length > 0 ? '  ' + meta.join('  ') : ''
          console.log(`  ${C.dim(branch)} ${stageColor(name)}${e.provider}${metaStr}`)
        })
      }

      console.log()
      console.log(C.dim(`  Wrote ${path.relative(cwd, path.join(cacheDir, 'providers.json'))}`))
      console.log()
    })
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
        if (field.depends)      entry.depends  = field.depends
        if (field.optional)     entry.optional = field.optional

        out.push(entry)
      } catch {
        // unreadable / not a package
      }
    }
  }

  return out
}
