import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import type { Command } from 'commander'
import { intro, outro, log } from '@clack/prompts'

// ─── Types ────────────────────────────────────────────────

export type ORM = 'prisma' | 'drizzle'

// ─── Helpers ──────────────────────────────────────────────

/** Detect which ORM is installed by checking package.json dependencies. */
export function detectORM(cwd: string = process.cwd()): ORM | null {
  try {
    const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'))
    const deps: Record<string, string> = { ...pkg.dependencies, ...pkg.devDependencies }
    if ('@boostkit/orm-prisma' in deps) return 'prisma'
    if ('@boostkit/orm-drizzle' in deps) return 'drizzle'
    return null
  } catch {
    return null
  }
}

/** Run a shell command with inherited stdio. Returns exit code. */
function run(cmd: string, args: string[], cwd: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { cwd, stdio: 'inherit', shell: true })
    proc.on('close', code => resolve(code ?? 1))
    proc.on('error', reject)
  })
}

/** Build the args array for a given ORM and command. Exported for testing. */
export function buildArgs(
  orm: ORM,
  command: 'migrate' | 'migrate:fresh' | 'migrate:status' | 'make:migration' | 'db:push' | 'db:generate',
  options: { name?: string; env?: string } = {},
): string[] {
  const env = options.env ?? process.env['NODE_ENV'] ?? 'development'
  const isProd = env === 'production'

  if (orm === 'prisma') {
    switch (command) {
      case 'migrate':
        return ['exec', 'prisma', 'migrate', isProd ? 'deploy' : 'dev']
      case 'migrate:fresh':
        return ['exec', 'prisma', 'migrate', 'reset', '--force']
      case 'migrate:status':
        return ['exec', 'prisma', 'migrate', 'status']
      case 'make:migration':
        return ['exec', 'prisma', 'migrate', 'dev', '--create-only', '--name', options.name ?? 'migration']
      case 'db:push':
        return ['exec', 'prisma', 'db', 'push']
      case 'db:generate':
        return ['exec', 'prisma', 'generate']
    }
  }

  // Drizzle
  switch (command) {
    case 'migrate':
      return ['exec', 'drizzle-kit', 'migrate']
    case 'migrate:fresh':
      return ['exec', 'drizzle-kit', 'migrate', '--force']
    case 'migrate:status':
      return ['exec', 'drizzle-kit', 'check']
    case 'make:migration':
      return ['exec', 'drizzle-kit', 'generate', '--name', options.name ?? 'migration']
    case 'db:push':
      return ['exec', 'drizzle-kit', 'push']
    case 'db:generate':
      // Drizzle schemas are TypeScript — no generation step needed
      return []
  }
}

// ─── Commands ─────────────────────────────────────────────

export function migrateCommands(program: Command): void {
  const cwd = process.cwd()

  function requireORM(): ORM {
    const orm = detectORM(cwd)
    if (!orm) {
      log.error('No ORM detected. Install @boostkit/orm-prisma or @boostkit/orm-drizzle.')
      process.exit(1)
    }
    return orm
  }

  async function exec(orm: ORM, command: Parameters<typeof buildArgs>[1], options?: { name?: string }): Promise<void> {
    const args = buildArgs(orm, command, { ...options, env: process.env['NODE_ENV'] ?? 'development' })
    if (args.length === 0) {
      log.info('Nothing to do (not needed for this ORM).')
      return
    }
    const code = await run('pnpm', args, cwd)
    if (code !== 0) process.exit(code)
  }

  // ── migrate ───────────────────────────────────────────
  program
    .command('migrate')
    .description('Run pending database migrations')
    .action(async () => {
      intro('migrate')
      const orm = requireORM()
      log.info(`Detected ORM: ${orm}`)
      await exec(orm, 'migrate')
      outro('Migrations complete.')
    })

  // ── migrate:fresh ─────────────────────────────────────
  program
    .command('migrate:fresh')
    .description('Drop all tables and re-run all migrations')
    .action(async () => {
      intro('migrate:fresh')
      const orm = requireORM()
      log.info(`Detected ORM: ${orm}`)
      await exec(orm, 'migrate:fresh')
      outro('Database reset complete.')
    })

  // ── migrate:status ────────────────────────────────────
  program
    .command('migrate:status')
    .description('Show the status of each migration')
    .action(async () => {
      intro('migrate:status')
      const orm = requireORM()
      await exec(orm, 'migrate:status')
      outro('')
    })

  // ── make:migration ────────────────────────────────────
  program
    .command('make:migration <name>')
    .description('Create a new migration file')
    .action(async (name: string) => {
      intro('make:migration')
      const orm = requireORM()
      log.info(`Detected ORM: ${orm}`)
      await exec(orm, 'make:migration', { name })
      outro(`Migration "${name}" created.`)
    })

  // ── db:push ───────────────────────────────────────────
  program
    .command('db:push')
    .description('Push schema changes directly to the database (no migration file)')
    .action(async () => {
      intro('db:push')
      const orm = requireORM()
      log.info(`Detected ORM: ${orm}`)
      await exec(orm, 'db:push')
      outro('Database pushed.')
    })

  // ── db:generate ───────────────────────────────────────
  program
    .command('db:generate')
    .description('Regenerate the database client (Prisma only)')
    .action(async () => {
      intro('db:generate')
      const orm = requireORM()
      await exec(orm, 'db:generate')
      outro('Client generated.')
    })
}
