import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawn } from 'node:child_process'

// ─── Types ────────────────────────────────────────────────

export type ORM = 'prisma' | 'drizzle'

// ─── Helpers ──────────────────────────────────────────────

/** Detect which ORM is installed by checking package.json dependencies. */
export function detectORM(cwd: string = process.cwd()): ORM | null {
  try {
    const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'))
    const deps: Record<string, string> = { ...pkg.dependencies, ...pkg.devDependencies }
    if ('@rudderjs/orm-prisma' in deps) return 'prisma'
    if ('@rudderjs/orm-drizzle' in deps) return 'drizzle'
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

// ─── Command Registration ─────────────────────────────────

/**
 * Register all migrate/db commands with the rudder CLI.
 * Called by the CLI's eager-load mechanism (no provider boot needed).
 */
export function registerMigrateCommands(
  rudder: { command(name: string, handler: (args: string[]) => void | Promise<void>): { description(text: string): unknown } },
): void {
  const cwd = process.cwd()

  function requireORM(): ORM {
    const orm = detectORM(cwd)
    if (!orm) {
      throw new Error('No ORM detected. Install @rudderjs/orm-prisma or @rudderjs/orm-drizzle.')
    }
    return orm
  }

  async function exec(
    orm: ORM,
    command: Parameters<typeof buildArgs>[1],
    options?: { name?: string },
  ): Promise<void> {
    const args = buildArgs(orm, command, { ...options, env: process.env['NODE_ENV'] ?? 'development' })
    if (args.length === 0) {
      console.log('Nothing to do (not needed for this ORM).')
      return
    }
    const code = await run('pnpm', args, cwd)
    if (code !== 0) {
      throw new Error(`Migration command failed (exit ${code})`)
    }
  }

  // ── migrate ───────────────────────────────────────────
  rudder.command('migrate', async () => {
    const orm = requireORM()
    console.log(`  ORM: ${orm}`)
    await exec(orm, 'migrate')
    console.log('  Migrations complete.')
  }).description('Run pending database migrations')

  // ── migrate:fresh ─────────────────────────────────────
  rudder.command('migrate:fresh', async () => {
    const orm = requireORM()
    console.log(`  ORM: ${orm}`)
    await exec(orm, 'migrate:fresh')
    console.log('  Database reset complete.')
  }).description('Drop all tables and re-run all migrations')

  // ── migrate:status ────────────────────────────────────
  rudder.command('migrate:status', async () => {
    const orm = requireORM()
    await exec(orm, 'migrate:status')
  }).description('Show the status of each migration')

  // ── make:migration ────────────────────────────────────
  rudder.command('make:migration', async (args: string[]) => {
    const name = args[0] ?? 'migration'
    const orm = requireORM()
    console.log(`  ORM: ${orm}`)
    await exec(orm, 'make:migration', { name })
    console.log(`  Migration "${name}" created.`)
  }).description('Create a new migration file — pnpm rudder make:migration <name>')

  // ── db:push ───────────────────────────────────────────
  rudder.command('db:push', async () => {
    const orm = requireORM()
    console.log(`  ORM: ${orm}`)
    await exec(orm, 'db:push')
    console.log('  Database pushed.')
  }).description('Push schema changes directly to the database (no migration file)')

  // ── db:generate ───────────────────────────────────────
  rudder.command('db:generate', async () => {
    const orm = requireORM()
    await exec(orm, 'db:generate')
    console.log('  Client generated.')
  }).description('Regenerate the database client (Prisma only)')
}
