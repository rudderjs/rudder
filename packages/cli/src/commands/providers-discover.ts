import { existsSync } from 'node:fs'
import path from 'node:path'
import type { Command } from 'commander'
import type { ProviderEntry } from '@rudderjs/core'

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

function shortName(pkg: string): string {
  return pkg.startsWith('@rudderjs/') ? pkg.slice('@rudderjs/'.length) : pkg
}

/**
 * `pnpm rudder providers:discover`
 *
 * Thin CLI wrapper — scanning and manifest writing live in @rudderjs/core.
 */
export function providersDiscoverCommand(program: Command): void {
  program
    .command('providers:discover')
    .description('Scan node_modules for RudderJS provider packages and write the manifest')
    .action(async () => {
      const cwd = process.cwd()

      if (!existsSync(path.join(cwd, 'node_modules'))) {
        console.error(`[providers:discover] No node_modules at ${path.join(cwd, 'node_modules')}`)
        process.exit(1)
      }

      // Import scanning logic from @rudderjs/core
      const { scanProviders, writeProviderManifest } = await import(
        /* @vite-ignore */ '@rudderjs/core/commands/providers-discover'
      ) as typeof import('@rudderjs/core/commands/providers-discover')

      const sorted = scanProviders(cwd)
      const manifestPath = writeProviderManifest(cwd, sorted)

      // ── Pretty output ──────────────────────────────────
      console.log()
      console.log(`  ${C.green('✓')} ${C.bold(`Discovered ${sorted.length} provider${sorted.length === 1 ? '' : 's'}`)}`)

      const grouped = new Map<ProviderEntry['stage'], ProviderEntry[]>()
      for (const e of sorted) {
        const list = grouped.get(e.stage) ?? []
        list.push(e)
        grouped.set(e.stage, list)
      }

      const nameWidth = Math.max(...sorted.map(e => shortName(e.package).length), 4) + 2

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
      console.log(C.dim(`  Wrote ${path.relative(cwd, manifestPath)}`))
      console.log()
    })
}
