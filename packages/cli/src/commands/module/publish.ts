import { readFile, writeFile, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve, join, relative } from 'node:path'
import { spawn } from 'node:child_process'
import type { Command } from 'commander'
import { intro, outro, spinner, log } from '@clack/prompts'

export const MARKERS_RE = /\/\/ <rudderjs:modules:start>[\s\S]*?\/\/ <rudderjs:modules:end>/m

// ─── Helpers ───────────────────────────────────────────────

export async function findPrismaFiles(modulesDir: string, moduleFilter?: string): Promise<Array<{ module: string; file: string; content: string }>> {
  const results: Array<{ module: string; file: string; content: string }> = []

  if (!existsSync(modulesDir)) return results

  const entries = await readdir(modulesDir, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (moduleFilter && entry.name !== moduleFilter) continue

    const moduleDir = join(modulesDir, entry.name)
    const moduleFiles = await readdir(moduleDir)

    for (const f of moduleFiles) {
      if (!f.endsWith('.prisma')) continue
      const filePath = join(moduleDir, f)
      const content = await readFile(filePath, 'utf8')
      results.push({ module: entry.name, file: f, content })
    }
  }

  return results
}

export function buildMergedBlock(shards: Array<{ module: string; file: string; content: string }>): string {
  const inner = shards
    .map(s => `// module: ${s.module} (${s.file})\n${s.content.trim()}`)
    .join('\n\n')

  return `// <rudderjs:modules:start>\n${inner}\n// <rudderjs:modules:end>`
}

function runCommand(cmd: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { cwd, stdio: 'inherit', shell: true })
    proc.on('close', code => {
      if (code === 0) resolve()
      else reject(new Error(`Command exited with code ${code}`))
    })
    proc.on('error', reject)
  })
}

// ─── Command ───────────────────────────────────────────────

/**
 * Where the merged module block lands. Scaffolded apps (and the playground)
 * use Prisma's multi-file layout — `prisma.config.ts` points `schema` at the
 * `prisma/schema/` DIRECTORY — so merging into a sibling `prisma/schema.prisma`
 * would write a file Prisma never reads and the publish would be a silent
 * no-op. Multi-file layout → `prisma/schema/modules.prisma` (picked up like
 * any other shard); legacy single-file layout → `prisma/schema.prisma`.
 */
export function resolveSchemaTarget(cwd: string): string {
  const schemaDir = resolve(cwd, 'prisma/schema')
  return existsSync(schemaDir)
    ? join(schemaDir, 'modules.prisma')
    : resolve(cwd, 'prisma/schema.prisma')
}

export function publishModule(program: Command): void {
  program
    .command('module:publish [module]')
    .description('Merge module Prisma shards into the app Prisma schema (prisma/schema/modules.prisma, or prisma/schema.prisma on single-file layouts)')
    .option('--generate', 'Run prisma generate after merging')
    .option('--migrate', 'Run prisma migrate dev after merging')
    .option('--name <name>', 'Migration name (used with --migrate)', 'auto')
    .action(async (
      moduleFilter: string | undefined,
      opts: { generate?: boolean; migrate?: boolean; name: string }
    ) => {
      intro('Publishing module Prisma shards')

      const cwd        = process.cwd()
      const modulesDir = resolve(cwd, 'app/Modules')
      const schemaPath = resolveSchemaTarget(cwd)

      const s = spinner()
      s.start('Scanning for .prisma files')
      const shards = await findPrismaFiles(modulesDir, moduleFilter)
      s.stop(`Found ${shards.length} shard(s)`)

      if (shards.length === 0) {
        log.error('No .prisma files found in app/Modules/')
        return
      }

      for (const shard of shards) {
        log.success(`  ${shard.module}/${shard.file}`)
      }

      const mergedBlock = buildMergedBlock(shards)

      let schema: string
      let existing: string | null = null
      try {
        existing = await readFile(schemaPath, 'utf8')
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
      }
      if (existing !== null) {
        schema = MARKERS_RE.test(existing)
          ? existing.replace(MARKERS_RE, mergedBlock)
          : existing.trimEnd() + '\n\n' + mergedBlock + '\n'
      } else {
        schema = mergedBlock + '\n'
      }

      const schemaRel = relative(cwd, schemaPath)
      const s2 = spinner()
      s2.start(`Writing ${schemaRel}`)
      await writeFile(schemaPath, schema)
      s2.stop(`${schemaRel} updated`)

      if (opts.generate) {
        const sg = spinner()
        sg.start('Running prisma generate')
        try {
          await runCommand('pnpm', ['exec', 'prisma', 'generate'], cwd)
          sg.stop('prisma generate complete')
        } catch (e) {
          sg.stop('prisma generate failed')
          log.error(String(e))
        }
      }

      if (opts.migrate) {
        const sm = spinner()
        sm.start('Running prisma migrate dev')
        try {
          await runCommand('pnpm', ['exec', 'prisma', 'migrate', 'dev', '--name', opts.name], cwd)
          sm.stop('prisma migrate dev complete')
        } catch (e) {
          sm.stop('prisma migrate dev failed')
          log.error(String(e))
        }
      }

      outro('Publish complete')
    })
}
