import { cp, mkdir, readdir, stat } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import type { Command } from 'commander'
import { intro, outro, log, spinner } from '@clack/prompts'
import { detectORM } from './migrate.js'

interface PublishGroup {
  from:    string
  to:      string
  tag?:    string
  /** Always overwrite — set by framework-managed pages like panels */
  force?:  boolean
  /** If set, only publish when this ORM is detected in the project. */
  orm?:    'prisma' | 'drizzle'
  /** If set, only publish when this database driver is detected. */
  driver?: 'sqlite' | 'postgresql' | 'mysql'
}

/** Detect the database driver from Prisma schema or config. */
export function detectDriver(cwd: string = process.cwd()): 'sqlite' | 'postgresql' | 'mysql' | null {
  // Try prisma/schema/base.prisma (multi-file)
  for (const schemaPath of [
    join(cwd, 'prisma', 'schema', 'base.prisma'),
    join(cwd, 'prisma', 'schema.prisma'),
  ]) {
    try {
      const content = readFileSync(schemaPath, 'utf8')
      const match = content.match(/provider\s*=\s*"(sqlite|postgresql|mysql)"/)
      if (match?.[1]) return match[1] as 'sqlite' | 'postgresql' | 'mysql'
    } catch { /* file not found */ }
  }

  // Try config/database.ts — look for default driver
  try {
    const content = readFileSync(join(cwd, 'config', 'database.ts'), 'utf8')
    if (content.includes("'postgresql'") || content.includes('"postgresql"')) return 'postgresql'
    if (content.includes("'mysql'") || content.includes('"mysql"')) return 'mysql'
    if (content.includes("'sqlite'") || content.includes('"sqlite"')) return 'sqlite'
  } catch { /* file not found */ }

  return null
}

// ─── Command ───────────────────────────────────────────────

export function vendorPublishCommand(program: Command): void {
  program
    .command('vendor:publish')
    .description('Publish package assets (pages, config, migrations) to your application')
    .option('--provider <provider>', 'Only publish assets from the given provider')
    .option('--tag <tag>',           'Only publish assets with the given tag')
    .option('--list',                'List available publishable assets without copying')
    .option('--force',               'Overwrite existing files')
    .action(async (opts: { provider?: string; tag?: string; list?: boolean; force?: boolean }) => {
      intro('vendor:publish')

      // Read from globalThis — populated by ServiceProvider.publishes() during app boot.
      // Using globalThis avoids module-cache fragmentation across tsx/ESM load paths.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const registry: Map<string, PublishGroup[]> = (globalThis as any).__boostkit_publish_registry__ ?? new Map()
      const cwd      = process.cwd()

      // ── Build filtered entries ───────────────────────────
      let entries: Array<[string, PublishGroup[]]> = [...registry.entries()]

      if (opts.provider) {
        entries = entries.filter(([name]) => name === opts.provider)
        if (entries.length === 0) {
          log.error(`No publishable assets found for provider "${opts.provider}"`)
          outro('')
          return
        }
      }

      if (opts.tag) {
        entries = entries
          .map(([name, groups]): [string, PublishGroup[]] => [
            name,
            groups.filter((g) => g.tag === opts.tag),
          ])
          .filter(([, groups]) => groups.length > 0)

        if (entries.length === 0) {
          log.error(`No publishable assets found with tag "${opts.tag}"`)
          outro('')
          return
        }
      }

      if (entries.length === 0) {
        log.warn('No publishable assets are registered.')
        outro('')
        return
      }

      // ── Deduplicate by destination (no-tag mode only) ──
      // When no --tag is given, multiple groups from the same provider may target the
      // same `to` path (e.g. auth publishes React, Vue, Solid variants all to pages/(auth)).
      // Only the first registered group per destination is published — that is the default.
      // Users must pass --tag to get a specific variant.
      if (!opts.tag) {
        entries = entries.map(([name, groups]): [string, PublishGroup[]] => {
          const seen = new Set<string>()
          return [name, groups.filter((g) => {
            if (seen.has(g.to)) return false
            seen.add(g.to)
            return true
          })]
        }).filter(([, groups]) => groups.length > 0)
      }

      // ── Filter by ORM + driver ─────────────────────────
      // Only applied to groups that have orm/driver set — generic groups always pass.
      const detectedOrm    = detectORM(cwd)
      const detectedDriver = detectDriver(cwd)

      entries = entries
        .map(([name, groups]): [string, PublishGroup[]] => [
          name,
          groups.filter((g) => {
            if (g.orm && g.orm !== detectedOrm) return false
            if (g.driver && g.driver !== detectedDriver) return false
            return true
          }),
        ])
        .filter(([, groups]) => groups.length > 0)

      // ── List mode ────────────────────────────────────────
      if (opts.list) {
        for (const [provider, groups] of entries) {
          log.message(`\n  ${provider}`)
          for (const g of groups) {
            const tag    = g.tag    ? `  [${g.tag}]`       : ''
            const orm    = g.orm    ? `  (${g.orm})`       : ''
            const driver = g.driver ? `  (${g.driver})`    : ''
            log.message(`    ${g.from}`)
            log.message(`    → ${g.to}${tag}${orm}${driver}`)
          }
        }
        outro('Use vendor:publish to copy the files above into your application.')
        return
      }

      // ── Copy files ───────────────────────────────────────
      let published = 0

      for (const [, groups] of entries) {
        for (const group of groups) {
          const dest = resolve(cwd, group.to)
          const s    = spinner()
          s.start(`Copying to ${group.to}`)

          await mkdir(dest, { recursive: true })

          const forceGroup = !!(opts.force || group.force)
          const skipped    = await copyDir(group.from, dest, forceGroup)

          if (skipped > 0 && !forceGroup) {
            s.stop(`Published to ${group.to}  (${skipped} file(s) skipped — use --force to overwrite)`)
          } else {
            s.stop(`Published to ${group.to}`)
          }

          published++
        }
      }

      outro(published > 0 ? 'Assets published successfully.' : 'Nothing was published.')
    })
}

// ─── Helpers ───────────────────────────────────────────────

/**
 * Recursively copy `src` into `dest`.
 * Returns the number of files skipped (already exist and force=false).
 */
async function copyDir(src: string, dest: string, force: boolean): Promise<number> {
  let skipped = 0

  const srcStat = await stat(src).catch(() => null)
  if (!srcStat) {
    log.warn(`Source not found: ${src}`)
    return 0
  }

  if (srcStat.isFile()) {
    if (!force) {
      const { existsSync } = await import('node:fs')
      const target = join(dest, src.split('/').pop() ?? '')
      if (existsSync(target)) return 1
    }
    await cp(src, dest, { recursive: true, force })
    return 0
  }

  const entries = await readdir(src, { withFileTypes: true })
  for (const entry of entries) {
    const srcPath  = join(src, entry.name)
    const destPath = join(dest, entry.name)

    if (entry.isDirectory()) {
      await mkdir(destPath, { recursive: true })
      skipped += await copyDir(srcPath, destPath, force)
    } else {
      if (!force) {
        const { existsSync } = await import('node:fs')
        if (existsSync(destPath)) {
          skipped++
          continue
        }
      }
      await cp(srcPath, destPath, { force })
    }
  }

  return skipped
}
