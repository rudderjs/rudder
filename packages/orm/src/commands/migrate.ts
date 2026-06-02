import { readFileSync, existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'
import { CliError } from '@rudderjs/console'
import { ModelRegistry } from '../index.js'
import type { OrmAdapter } from '@rudderjs/contracts'
import type { ModelCastInfo } from '../native/schema/schema-types.js'

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

/**
 * Run a shell command with inherited stdio. Returns exit code.
 *
 * `shell: true` is load-bearing on Windows — the `pnpm` shim is `pnpm.cmd`,
 * and modern Node's BatBadBut mitigation throws when a `.cmd`/`.bat` is spawned
 * with `shell: false`. We therefore keep the shell and instead guarantee that
 * the ONLY caller-influenced token (a make:migration `--name`) carries no shell
 * metacharacters — see `assertSafeName()`, applied where it enters the argv.
 * Every other arg in this file is a hardcoded literal.
 */
function run(cmd: string, args: string[], cwd: string): Promise<number> {
  // pnpm 11's `verify-deps-before-run` runs a deps-status check before `pnpm
  // exec`, and it fatally exits (ERR_PNPM_IGNORED_BUILDS) when ANY dependency
  // has an un-approved build script — e.g. a transitive `msw` postinstall, or
  // an optional `argon2` — aborting `prisma generate`/`db push` before the tool
  // even runs. Disable that pre-flight check for our tool invocations; the deps
  // were already installed (at scaffold time or via `pnpm install`).
  const finalArgs = cmd === 'pnpm'
    ? ['--config.verify-deps-before-run=false', ...args]
    : args
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, finalArgs, { cwd, stdio: 'inherit', shell: true })
    proc.on('close', code => resolve(code ?? 1))
    proc.on('error', reject)
  })
}

/**
 * Find a `database/seeders/DatabaseSeeder` file in the project root.
 * Returns the absolute path, or null if not found. Exported for testing.
 */
export function findSeederFile(cwd: string = process.cwd()): string | null {
  for (const ext of ['ts', 'js', 'mts', 'mjs']) {
    const candidate = join(cwd, 'database', 'seeders', `DatabaseSeeder.${ext}`)
    if (existsSync(candidate)) return candidate
  }
  return null
}

/**
 * Detect whether `package.json` has a `prisma.seed` field configured.
 * Used as the fallback path for Prisma projects that don't ship a Seeder class.
 */
export function hasPrismaSeedConfig(cwd: string = process.cwd()): boolean {
  try {
    const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'))
    return typeof pkg?.prisma?.seed === 'string' && pkg.prisma.seed.length > 0
  } catch {
    return false
  }
}

/**
 * Validate a migration name before it reaches the (shelled) spawn. Migration
 * names become directory/file names downstream, so a strict identifier
 * allowlist is both safe and more than permissive enough — and it closes the
 * one shell-injection path through `make:migration --name`.
 */
export function assertSafeName(name: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(name)) {
    throw new Error(
      `[RudderJS ORM] Invalid migration name ${JSON.stringify(name)}. ` +
      `Use only letters, digits, dots, dashes, and underscores (no spaces or shell metacharacters).`,
    )
  }
  return name
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
        return ['exec', 'prisma', 'migrate', 'dev', '--create-only', '--name', assertSafeName(options.name ?? 'migration')]
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
      return ['exec', 'drizzle-kit', 'generate', '--name', assertSafeName(options.name ?? 'migration')]
    case 'db:push':
      return ['exec', 'drizzle-kit', 'push']
    case 'db:generate':
      // Drizzle schemas are TypeScript — no generation step needed
      return []
  }
}

// ─── Vector migration (#B7 Phase 3) ──────────────────────

/** Conservative SQL identifier check — letters, digits, underscores; must
 *  start with a letter or underscore. Defends against the `--vector` CLI
 *  flag receiving anything that would compose into surprising SQL. */
function isValidIdentifier(s: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(s)
}

export interface VectorMigrationOptions {
  table:      string
  column:     string
  dimensions: number
  /** ORM target — affects the migration filename layout. Auto-detected from
   *  package.json when omitted; falls back to 'drizzle' if no ORM is detected. */
  orm?: 'prisma' | 'drizzle'
  /** Distance metric the HNSW index will be optimized for. Default `'cosine'`. */
  metric?: 'cosine' | 'l2' | 'inner-product'
}

export interface VectorMigrationResult {
  filePath: string
  sql:      string
  /** Schema.prisma snippet apps using Prisma should add to their model. */
  prismaSchemaSnippet?: string
}

/**
 * Build the raw SQL for adding a pgvector column + HNSW index. Pure;
 * no I/O. Exported for testing and so apps can compose the snippet
 * into a hand-rolled migration if their layout differs from the
 * convention {@link writeVectorMigration} uses.
 */
export function buildVectorMigrationSql(opts: VectorMigrationOptions): string {
  const { table, column, dimensions, metric = 'cosine' } = opts
  if (!isValidIdentifier(table)) {
    throw new Error(`[RudderJS ORM] make:migration --vector: invalid table name "${table}".`)
  }
  if (!isValidIdentifier(column)) {
    throw new Error(`[RudderJS ORM] make:migration --vector: invalid column name "${column}".`)
  }
  if (!Number.isInteger(dimensions) || dimensions <= 0) {
    throw new Error(`[RudderJS ORM] make:migration --vector: dimensions must be a positive integer; got ${String(dimensions)}.`)
  }
  const opsClass =
    metric === 'l2'            ? 'vector_l2_ops' :
    metric === 'inner-product' ? 'vector_ip_ops' :
                                 'vector_cosine_ops'

  return [
    `-- Add ${dimensions}-dim pgvector column "${column}" to "${table}" (metric: ${metric})`,
    '',
    'CREATE EXTENSION IF NOT EXISTS vector;',
    '',
    `ALTER TABLE "${table}" ADD COLUMN "${column}" vector(${dimensions});`,
    '',
    `CREATE INDEX "${table}_${column}_hnsw_idx" ON "${table}" USING hnsw ("${column}" ${opsClass});`,
    '',
  ].join('\n')
}

/**
 * Build the Prisma `schema.prisma` snippet that mirrors the SQL
 * column. Prisma can't natively type pgvector columns; users declare
 * `Unsupported("vector(N)")` and the cosine HNSW index alongside.
 */
export function buildPrismaSchemaSnippet(opts: VectorMigrationOptions): string {
  const { column, dimensions, metric = 'cosine' } = opts
  const opsClass =
    metric === 'l2'            ? 'VectorL2Ops' :
    metric === 'inner-product' ? 'VectorIpOps' :
                                 'VectorCosineOps'
  return [
    '// Prisma users — add to your model:',
    '//',
    `//   ${column}  Unsupported("vector(${dimensions})")?`,
    `//   @@index([${column}(ops: ${opsClass})], type: Hnsw)`,
    '',
    '// Prisma 5.10+ supports the Hnsw index type via the postgresqlExtensions',
    '// preview feature — enable it in your generator block if you haven\'t:',
    '//',
    '//   generator client {',
    '//     previewFeatures = ["postgresqlExtensions"]',
    '//   }',
    '//',
    '//   datasource db { extensions = [vector] }',
  ].join('\n')
}

/**
 * UTC timestamp suitable for the migration filename prefix. Format
 * `YYYYMMDDHHmmss` — sortable, matches Prisma's convention out of the
 * box and works fine as a Drizzle migration tag.
 */
function migrationTimestamp(now: Date = new Date()): string {
  const pad = (n: number, w = 2): string => String(n).padStart(w, '0')
  return (
    now.getUTCFullYear().toString() +
    pad(now.getUTCMonth() + 1) +
    pad(now.getUTCDate()) +
    pad(now.getUTCHours()) +
    pad(now.getUTCMinutes()) +
    pad(now.getUTCSeconds())
  )
}

/**
 * Write a pgvector migration file to a sensible default location for
 * the detected ORM. Prisma migrations land under
 * `prisma/migrations/<ts>_add_<col>_vector_to_<table>/migration.sql`
 * (Prisma's standard layout). Drizzle migrations land under
 * `drizzle/<ts>_add_<col>_vector_to_<table>.sql`.
 *
 * If the layout differs from the default, use {@link buildVectorMigrationSql}
 * directly and write the SQL wherever your migration tooling expects.
 */
export async function writeVectorMigration(
  opts: VectorMigrationOptions,
  cwd: string = process.cwd(),
  now: Date = new Date(),
): Promise<VectorMigrationResult> {
  const sql      = buildVectorMigrationSql(opts)
  const orm      = opts.orm ?? detectORM(cwd) ?? 'drizzle'
  const ts       = migrationTimestamp(now)
  const slug     = `add_${opts.column}_vector_to_${opts.table}`
  const filename = orm === 'prisma'
    ? join('prisma', 'migrations', `${ts}_${slug}`, 'migration.sql')
    : join('drizzle', `${ts}_${slug}.sql`)

  const filePath = join(cwd, filename)
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, sql, 'utf8')

  const result: VectorMigrationResult = { filePath, sql }
  if (orm === 'prisma') {
    result.prismaSchemaSnippet = buildPrismaSchemaSnippet(opts)
  }
  return result
}

/**
 * Parse `--vector <table> <column> <dimensions>` (with optional
 * `--metric <cosine|l2|inner-product>`) out of the `make:migration`
 * CLI args. Returns `null` if `--vector` isn't present so the standard
 * delegation to prisma/drizzle-kit can run.
 *
 * Exported for testing.
 */
export function parseVectorFlag(args: readonly string[]): { table: string; column: string; dimensions: number; metric?: 'cosine' | 'l2' | 'inner-product' } | null {
  const i = args.indexOf('--vector')
  if (i === -1) return null
  const table  = args[i + 1]
  const column = args[i + 2]
  const dimStr = args[i + 3]
  if (!table || !column || !dimStr) {
    throw new Error('[RudderJS ORM] make:migration --vector requires <table> <column> <dimensions>; e.g. `--vector documents embedding 1536`.')
  }
  const dimensions = Number(dimStr)
  if (!Number.isInteger(dimensions) || dimensions <= 0) {
    throw new Error(`[RudderJS ORM] make:migration --vector: dimensions must be a positive integer; got "${dimStr}".`)
  }

  const mIdx = args.indexOf('--metric')
  let metric: 'cosine' | 'l2' | 'inner-product' | undefined
  if (mIdx !== -1) {
    const v = args[mIdx + 1]
    if (v !== 'cosine' && v !== 'l2' && v !== 'inner-product') {
      throw new Error(`[RudderJS ORM] make:migration --metric must be one of cosine|l2|inner-product; got "${v ?? ''}".`)
    }
    metric = v
  }

  return metric ? { table, column, dimensions, metric } : { table, column, dimensions }
}

// ─── Native engine migrations (in-process) ────────────────
//
// The native SQLite engine has no external CLI to shell out to — it runs
// migrations in-process via `@rudderjs/orm/native`'s `Migrator`. A native app is
// detected by the *absence* of an adapter package (`detectORM` → null): only
// prisma/drizzle ship those, so "no ORM package + a registered native adapter"
// means the native engine. Because `migrate`/`migrate:status` skip app boot (to
// stay tool-only for prisma/drizzle), the native branch boots on demand to get
// the configured adapter.

/** The native engine's schema:types capability (GATE 7-types) — present on the
 *  native adapter only. Lets `migrate*` and `schema:types` regenerate the typed
 *  `registry.d.ts` from the live schema. */
interface SchemaTypesCapable {
  generateSchemaTypes(cwd: string, models: ModelCastInfo[]): Promise<{ path: string; tableCount: number }>
}

/** A native adapter is duck-typed by its `schemaBuilder()` accessor — prisma/
 *  drizzle adapters don't have it. Avoids an `instanceof` across module
 *  boundaries and keeps native off the cold-boot path for non-native apps. */
export type NativeAdapterLike = OrmAdapter
  & import('../native/schema/migrator.js').MigratorAdapter
  & SchemaTypesCapable

export function nativeAdapterOrNull(): NativeAdapterLike | null {
  const adapter = ModelRegistry.get() as (OrmAdapter & { schemaBuilder?: unknown }) | null
  return adapter && typeof adapter.schemaBuilder === 'function' ? (adapter as NativeAdapterLike) : null
}

/**
 * If this is a native-engine app, boot it on demand (the `migrate*` /
 * `schema:types` commands skip app boot by default to stay tool-only for
 * prisma/drizzle) and return the registered native adapter. Returns null for
 * prisma/drizzle apps (an adapter package is present) or when no `bootApp` is
 * injected (e.g. unit tests calling a runner directly).
 */
export async function resolveNativeAdapter(
  cwd: string,
  bootApp?: () => Promise<void>,
): Promise<NativeAdapterLike | null> {
  if (detectORM(cwd) !== null) return null
  if (!bootApp) return null
  await bootApp()
  return nativeAdapterOrNull()
}

/**
 * Collect each registered model's table + declared string casts, in the
 * {@link ModelCastInfo} shape the schema-types generator folds in (so a
 * `boolean`/`date`/`json` cast refines the generated column type). Class-based
 * casts (custom `CastUsing`, `vector(...)`) are skipped — the generator can't
 * name them, so the storage type wins, which is the correct fallback. Only
 * models imported during boot are registered; absent models simply don't
 * contribute casts (the column still gets its storage type).
 */
export function collectRegisteredModelCasts(): ModelCastInfo[] {
  const out: ModelCastInfo[] = []
  for (const [, ModelClass] of ModelRegistry.all()) {
    const casts: Record<string, string> = {}
    for (const [col, def] of Object.entries(ModelClass.casts ?? {})) {
      if (typeof def === 'string') casts[col] = def
    }
    out.push({ table: ModelClass.getTable(), casts })
  }
  return out
}

/**
 * Regenerate `app/Models/__schema/registry.d.ts` from a booted native adapter's
 * live schema. Shared by the `schema:types` command and the post-`migrate`
 * auto-gen hook. Logs the written path + table count.
 */
export async function runNativeSchemaTypes(adapter: NativeAdapterLike, cwd: string): Promise<void> {
  const { path, tableCount } = await adapter.generateSchemaTypes(cwd, collectRegisteredModelCasts())
  console.log(`  Schema types written to ${path.replace(cwd + '/', '')} (${tableCount} table${tableCount === 1 ? '' : 's'}).`)
}

/**
 * Apply pending native migrations. Returns the count applied. With
 * `{ pretend: true }` it prints the SQL each pending migration would emit
 * (executing nothing) and returns 0; `{ step: true }` records each pending
 * migration in its own batch.
 */
export async function runNativeMigrate(
  adapter: NativeAdapterLike,
  cwd: string,
  opts: { step?: boolean; pretend?: boolean } = {},
): Promise<number> {
  const { Migrator, discoverMigrations } = await import('../native/index.js')
  const migrations = await discoverMigrations(join(cwd, 'database', 'migrations'))
  const result = await new Migrator(adapter).run(migrations, (name) => console.log(`  ✓ ${name}`), opts)
  if (result.pretended) {
    if (result.pretended.length === 0) console.log('  Nothing to migrate.')
    for (const m of result.pretended) {
      console.log(`  -- ${m.name}`)
      for (const sql of m.statements) console.log(`  ${sql};`)
    }
    return 0
  }
  return result.applied.length
}

/** Print native migration status (ran / pending per migration). */
export async function runNativeStatus(adapter: NativeAdapterLike, cwd: string): Promise<void> {
  const { Migrator, discoverMigrations } = await import('../native/index.js')
  const migrations = await discoverMigrations(join(cwd, 'database', 'migrations'))
  const rows = await new Migrator(adapter).status(migrations)
  if (rows.length === 0) {
    console.log('  No migrations found in database/migrations.')
    return
  }
  for (const r of rows) {
    console.log(`  ${r.ran ? `Ran (batch ${r.batch})` : 'Pending'.padEnd(13)}  ${r.name}`)
  }
}

/**
 * Roll back native migrations. With no opts: the last batch. `{ step: N }`: the
 * last N applied migrations across batches. `{ batch: N }`: every migration in
 * batch N. Returns the count reverted.
 */
export async function runNativeRollback(
  adapter: NativeAdapterLike,
  cwd: string,
  opts: { step?: number; batch?: number } = {},
): Promise<number> {
  const { Migrator, discoverMigrations } = await import('../native/index.js')
  const migrations = await discoverMigrations(join(cwd, 'database', 'migrations'))
  const { reverted } = await new Migrator(adapter).rollback(migrations, (name) => console.log(`  ✓ rolled back ${name}`), opts)
  return reverted.length
}

/** Roll back EVERY native migration (Laravel `migrate:reset`). Returns the count
 *  reverted. */
export async function runNativeReset(adapter: NativeAdapterLike, cwd: string): Promise<number> {
  const { Migrator, discoverMigrations } = await import('../native/index.js')
  const migrations = await discoverMigrations(join(cwd, 'database', 'migrations'))
  const reverted = await new Migrator(adapter).rollbackAll(migrations)
  for (const name of reverted) console.log(`  ✓ rolled back ${name}`)
  return reverted.length
}

/** Roll back every native migration, then re-run them all. Returns the count
 *  re-applied. `{ step: true }` re-applies each migration in its own batch. */
export async function runNativeRefresh(
  adapter: NativeAdapterLike,
  cwd: string,
  opts: { step?: boolean } = {},
): Promise<number> {
  const { Migrator, discoverMigrations } = await import('../native/index.js')
  const migrations = await discoverMigrations(join(cwd, 'database', 'migrations'))
  const migrator = new Migrator(adapter)
  await migrator.rollbackAll(migrations)
  const { applied } = await migrator.run(migrations, (name) => console.log(`  ✓ ${name}`), opts)
  return applied.length
}

/** Drop all tables (no `down()` needed), then re-run every native migration.
 *  Returns the count applied. */
export async function runNativeFresh(adapter: NativeAdapterLike, cwd: string): Promise<number> {
  const { Migrator, discoverMigrations } = await import('../native/index.js')
  const migrations = await discoverMigrations(join(cwd, 'database', 'migrations'))
  const migrator = new Migrator(adapter)
  await migrator.dropAllTables()
  const { applied } = await migrator.run(migrations, (name) => console.log(`  ✓ ${name}`))
  return applied.length
}

// ─── Native engine migration stub (7.3) ──────────────────
//
// `make:migration <name>` on a native app has no external CLI to delegate to,
// so it writes a hand-authored up/down stub directly — the same role
// `prisma migrate dev --create-only` / `drizzle-kit generate` play for those
// ORMs. Laravel-style name inference scaffolds the common case (`create_*_table`).

/**
 * Build the contents of a native migration stub file. Pure; no I/O. Exported
 * for testing and so apps can compose the stub themselves if their layout
 * differs from the convention {@link writeNativeMigration} uses.
 *
 * Name inference (Laravel parity):
 *  - `create_<table>_table` → an `up()` that scaffolds `Schema.create('<table>', …)`
 *    with `t.id()` + `t.timestamps()`, and a `down()` that drops the table.
 *  - any other name → a generic empty up/down stub with `// TODO` markers.
 *
 * Table alters (`Schema.table`) are intentionally NOT scaffolded — they ship in
 * a separate phase (7.4); a generic name yields an empty stub the author fills in.
 */
export function buildNativeMigrationStub(name: string): string {
  const header = `import { Migration, Schema } from '@rudderjs/orm/native'\n\nexport default class extends Migration {\n`
  const footer = `}\n`

  const createMatch = /^create_(\w+)_table$/.exec(name)
  if (createMatch) {
    const table = createMatch[1]
    return (
      header +
      `  async up() {\n` +
      `    await Schema.create('${table}', (t) => {\n` +
      `      t.id()\n` +
      `      t.timestamps()\n` +
      `    })\n` +
      `  }\n\n` +
      `  async down() {\n` +
      `    await Schema.dropIfExists('${table}')\n` +
      `  }\n` +
      footer
    )
  }

  return (
    header +
    `  async up() {\n` +
    `    // TODO: define the schema changes for this migration\n` +
    `  }\n\n` +
    `  async down() {\n` +
    `    // TODO: reverse the schema changes made in up()\n` +
    `  }\n` +
    footer
  )
}

export interface NativeMigrationResult {
  filePath: string
  contents: string
}

/**
 * Write a native migration stub to `database/migrations/<ts>_<name>.ts`,
 * creating the directory if needed. Mirrors {@link writeVectorMigration}'s
 * style (`now` is injectable for deterministic tests).
 */
export async function writeNativeMigration(
  name: string,
  cwd: string = process.cwd(),
  now: Date = new Date(),
): Promise<NativeMigrationResult> {
  assertSafeName(name)
  const contents = buildNativeMigrationStub(name)
  const ts       = migrationTimestamp(now)
  const filePath = join(cwd, 'database', 'migrations', `${ts}_${name}.ts`)

  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, contents, 'utf8')

  return { filePath, contents }
}

// ─── CLI flag parsing (Laravel migrate flag parity) ──────

/** Whether a `--name` (or `--name=…`) flag is present. */
export function hasFlag(args: readonly string[], name: string): boolean {
  return args.some(a => a === `--${name}` || a.startsWith(`--${name}=`))
}

/** Parse the numeric value of a `--name=N` or `--name N` flag. Returns undefined
 *  when the flag is absent or carries no numeric value (e.g. a bare `--name`). */
export function flagNumber(args: readonly string[], name: string): number | undefined {
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!
    if (a === `--${name}`) {
      const next = args[i + 1]
      return next !== undefined && /^\d+$/.test(next) ? Number(next) : undefined
    }
    if (a.startsWith(`--${name}=`)) {
      const v = a.slice(name.length + 3)
      return /^\d+$/.test(v) ? Number(v) : undefined
    }
  }
  return undefined
}

/** Resolve the `--step` flag for rollback: its numeric value, or 1 for a bare
 *  `--step`, or undefined when absent. */
export function rollbackStep(args: readonly string[]): number | undefined {
  return hasFlag(args, 'step') ? (flagNumber(args, 'step') ?? 1) : undefined
}

// ─── Command Registration ─────────────────────────────────

/**
 * Register all migrate/db commands with the rudder CLI.
 * Called by the CLI's eager-load mechanism (no provider boot needed).
 */
export function registerMigrateCommands(
  rudder: { command(name: string, handler: (args: string[]) => void | Promise<void>): { description(text: string): unknown } },
  opts: { bootApp?: () => Promise<void> } = {},
): void {
  const cwd = process.cwd()

  function requireORM(): ORM {
    const orm = detectORM(cwd)
    if (!orm) {
      throw new Error('No ORM detected. Install @rudderjs/orm-prisma or @rudderjs/orm-drizzle, or configure the native engine (engine: \'native\').')
    }
    return orm
  }

  // Boot the native engine on demand (migrate* skip app boot by default) and
  // return its adapter; null for prisma/drizzle apps → shell-out path.
  const resolveNative = (): Promise<NativeAdapterLike | null> => resolveNativeAdapter(cwd, opts.bootApp)

  async function exec(
    orm: ORM,
    command: Parameters<typeof buildArgs>[1],
    options?: { name?: string; tolerateNonZero?: boolean },
  ): Promise<number> {
    const { tolerateNonZero, ...buildOpts } = options ?? {}
    const args = buildArgs(orm, command, { ...buildOpts, env: process.env['NODE_ENV'] ?? 'development' })
    if (args.length === 0) {
      console.log('Nothing to do (not needed for this ORM).')
      return 0
    }
    const code = await run('pnpm', args, cwd)
    if (code !== 0 && !tolerateNonZero) {
      // Throw a CliError (printed as a clean red line + exit code by the CLI)
      // rather than a plain Error — the underlying tool (prisma/drizzle-kit)
      // already printed its actionable message via inherited stdio, so dumping
      // a Node stack trace on top is pure noise. Mirrors the migrate:status
      // tolerate-non-zero fix; here we still fail, just cleanly.
      throw new CliError(`Migration command failed (exit ${code})`, code)
    }
    return code
  }

  // ── migrate ───────────────────────────────────────────
  // Flags (native engine): --step (each migration its own batch), --pretend
  // (print SQL, run nothing), --force (accepted; we never prompt, so a no-op).
  rudder.command('migrate', async (args: string[]) => {
    const native = await resolveNative()
    if (native) {
      console.log('  ORM: native')
      if (hasFlag(args, 'pretend')) {
        await runNativeMigrate(native, cwd, { pretend: true })
        return // dry run — schema unchanged, skip type regen
      }
      const count = await runNativeMigrate(native, cwd, { step: hasFlag(args, 'step') })
      console.log(count === 0 ? '  Nothing to migrate.' : `  Migrations complete (${count} applied).`)
      await runNativeSchemaTypes(native, cwd)
      return
    }
    const orm = requireORM()
    console.log(`  ORM: ${orm}`)
    await exec(orm, 'migrate')
    console.log('  Migrations complete.')
  }).description('Run pending database migrations — flags: --step, --pretend, --force (native)')

  // ── migrate:fresh ─────────────────────────────────────
  rudder.command('migrate:fresh', async (args: string[]) => {
    const native = await resolveNative()
    if (native) {
      console.log('  ORM: native')
      const count = await runNativeFresh(native, cwd)
      console.log(`  Database reset complete (${count} migration${count === 1 ? '' : 's'} re-applied).`)
      await runNativeSchemaTypes(native, cwd)
      if (hasFlag(args, 'seed')) await runSeeder(cwd)
      return
    }
    const orm = requireORM()
    console.log(`  ORM: ${orm}`)
    await exec(orm, 'migrate:fresh')
    console.log('  Database reset complete.')
  }).description('Drop all tables and re-run all migrations — flag: --seed (native)')

  // ── migrate:rollback ──────────────────────────────────
  // Flags (native): --step[=N] (last N migrations across batches), --batch=N
  // (every migration in batch N). Default: the last batch.
  rudder.command('migrate:rollback', async (args: string[]) => {
    const native = await resolveNative()
    if (native) {
      console.log('  ORM: native')
      const batch = flagNumber(args, 'batch')
      const step  = rollbackStep(args)
      const opts = batch !== undefined ? { batch } : step !== undefined ? { step } : {}
      const count = await runNativeRollback(native, cwd, opts)
      console.log(count === 0 ? '  Nothing to roll back.' : `  Rolled back ${count} migration${count === 1 ? '' : 's'}.`)
      await runNativeSchemaTypes(native, cwd)
      return
    }
    // Prisma/Drizzle migrations are forward-only — neither tool reverses an
    // applied migration. Point at the destructive reset instead of shelling out.
    const orm = requireORM()
    throw new CliError(
      `migrate:rollback is only supported on the native engine. ${orm} migrations are forward-only — ` +
      `use \`rudder migrate:fresh\` to drop and re-apply (destructive).`,
      1,
    )
  }).description('Roll back migrations — flags: --step[=N], --batch=N (native engine only)')

  // ── migrate:reset ─────────────────────────────────────
  rudder.command('migrate:reset', async () => {
    const native = await resolveNative()
    if (native) {
      console.log('  ORM: native')
      const count = await runNativeReset(native, cwd)
      console.log(count === 0 ? '  Nothing to reset.' : `  Rolled back ${count} migration${count === 1 ? '' : 's'}.`)
      await runNativeSchemaTypes(native, cwd)
      return
    }
    const orm = requireORM()
    throw new CliError(
      `migrate:reset is only supported on the native engine. ${orm} migrations are forward-only — ` +
      `use \`rudder migrate:fresh\` to drop and re-apply (destructive).`,
      1,
    )
  }).description('Roll back all migrations (native engine only)')

  // ── migrate:refresh ───────────────────────────────────
  // Flags (native): --step (re-apply each migration in its own batch), --seed.
  rudder.command('migrate:refresh', async (args: string[]) => {
    const native = await resolveNative()
    if (native) {
      console.log('  ORM: native')
      const count = await runNativeRefresh(native, cwd, { step: hasFlag(args, 'step') })
      console.log(`  Refresh complete (${count} migration${count === 1 ? '' : 's'} re-applied).`)
      await runNativeSchemaTypes(native, cwd)
      if (hasFlag(args, 'seed')) await runSeeder(cwd)
      return
    }
    const orm = requireORM()
    throw new CliError(
      `migrate:refresh is only supported on the native engine. ${orm} migrations are forward-only — ` +
      `use \`rudder migrate:fresh\` to drop and re-apply (destructive).`,
      1,
    )
  }).description('Roll back all migrations and re-run them — flags: --step, --seed (native engine only)')

  // ── migrate:status ────────────────────────────────────
  rudder.command('migrate:status', async () => {
    const native = await resolveNative()
    if (native) {
      await runNativeStatus(native, cwd)
      return
    }
    const orm = requireORM()
    // `prisma migrate status` exits non-zero for *informational* states (drift,
    // pending migrations, or a db:push-managed DB with no migrations dir) — not
    // just hard failures. Surface its output (already printed via inherited
    // stdio) and preserve the exit code for CI, but don't throw: throwing here
    // dumps a JS stack trace on what is really just a status report.
    const code = await exec(orm, 'migrate:status', { tolerateNonZero: true })
    if (code !== 0) process.exitCode = code
  }).description('Show the status of each migration')

  // ── make:migration ────────────────────────────────────
  rudder.command('make:migration', async (args: string[]) => {
    // --vector <table> <column> <dimensions> [--metric cosine|l2|inner-product]
    // short-circuits the standard prisma/drizzle-kit delegation: writes the
    // pgvector SQL directly so apps don't have to hand-edit the file the
    // upstream tool produces. Detected ORM picks the directory layout.
    const vector = parseVectorFlag(args)
    if (vector) {
      const orm = detectORM(cwd) ?? 'drizzle'
      const result = await writeVectorMigration({ ...vector, orm }, cwd)
      console.log(`  Wrote ${result.filePath.replace(cwd + '/', '')}`)
      if (result.prismaSchemaSnippet) {
        console.log()
        console.log(result.prismaSchemaSnippet)
      }
      return
    }

    const name = args[0] ?? 'migration'

    // Native app (no prisma/drizzle adapter package) → write a hand-authored
    // up/down stub directly; there's no external CLI to delegate to. This is
    // boot-free: it only writes a file (make:migration is in the CLI skip-boot
    // set), so no adapter is required.
    if (detectORM(cwd) === null) {
      const result = await writeNativeMigration(name, cwd)
      console.log('  ORM: native')
      console.log(`  Wrote ${result.filePath.replace(cwd + '/', '')}`)
      return
    }

    const orm = requireORM()
    console.log(`  ORM: ${orm}`)
    await exec(orm, 'make:migration', { name })
    console.log(`  Migration "${name}" created.`)
  }).description('Create a new migration file — pnpm rudder make:migration <name> | make:migration --vector <table> <column> <dim>')

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

  // ── db:seed ───────────────────────────────────────────
  rudder.command('db:seed', async () => {
    await runSeeder(cwd)
  }).description('Seed the database — runs database/seeders/DatabaseSeeder')
}

/**
 * In-process seeder runner.
 *
 * Resolution order:
 *   1. `database/seeders/DatabaseSeeder.{ts,js,mts,mjs}` — instantiate default
 *      export and call `.run()` (or `await default()` if it's a function).
 *   2. Prisma fallback — if `package.json#prisma.seed` is configured, shell out
 *      to `prisma db seed`.
 *   3. Otherwise — clear error pointing the user at option 1.
 */
export async function runSeeder(cwd: string = process.cwd()): Promise<void> {
  const seederFile = findSeederFile(cwd)
  if (seederFile) {
    console.log(`  Seeding from ${seederFile.replace(cwd + '/', '')}…`)
    const mod: unknown = await import(pathToFileURL(seederFile).href)
    const exported = (mod as { default?: unknown }).default
    if (!exported) {
      throw new Error(`[RudderJS] ${seederFile} has no default export. Export a Seeder subclass or an async function.`)
    }
    if (typeof exported === 'function') {
      // Class constructor → instantiate + run(); or plain function → invoke
      const isClass = /^class\s/.test(Function.prototype.toString.call(exported))
      if (isClass) {
        const Cls = exported as new () => { run(): void | Promise<void> }
        const instance = new Cls()
        await instance.run()
      } else {
        await (exported as () => void | Promise<void>)()
      }
    } else {
      throw new Error(`[RudderJS] ${seederFile} default export must be a Seeder class or function.`)
    }
    console.log('  Seeding complete.')
    return
  }

  if (detectORM(cwd) === 'prisma' && hasPrismaSeedConfig(cwd)) {
    console.log('  Running prisma db seed (configured in package.json)…')
    const code = await run('pnpm', ['exec', 'prisma', 'db', 'seed'], cwd)
    if (code !== 0) {
      throw new Error(`prisma db seed failed (exit ${code})`)
    }
    return
  }

  throw new Error(
    '[RudderJS] No seeder found. Create database/seeders/DatabaseSeeder.ts:\n\n' +
    '  import { Seeder } from \'@rudderjs/orm\'\n' +
    '  export default class DatabaseSeeder extends Seeder {\n' +
    '    async run() { /* seed your data */ }\n' +
    '  }\n',
  )
}
