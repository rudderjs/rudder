import { readFile, writeFile, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { spawn } from 'node:child_process'
import type { Command } from 'commander'
import { intro, outro, spinner, log } from '@clack/prompts'

export const MARKERS_RE = /\/\/ <boostkit:modules:start>[\s\S]*?\/\/ <boostkit:modules:end>/m

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

  return `// <boostkit:modules:start>\n${inner}\n// <boostkit:modules:end>`
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

export function publishModule(program: Command): void {
  program
    .command('module:publish [module]')
    .description('Merge module Prisma shards into prisma/schema.prisma')
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
      const schemaPath = resolve(cwd, 'prisma/schema.prisma')

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
      if (existsSync(schemaPath)) {
        schema = await readFile(schemaPath, 'utf8')
        if (MARKERS_RE.test(schema)) {
          schema = schema.replace(MARKERS_RE, mergedBlock)
        } else {
          schema = schema.trimEnd() + '\n\n' + mergedBlock + '\n'
        }
      } else {
        schema = mergedBlock + '\n'
      }

      const s2 = spinner()
      s2.start('Writing prisma/schema.prisma')
      await writeFile(schemaPath, schema)
      s2.stop('prisma/schema.prisma updated')

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
