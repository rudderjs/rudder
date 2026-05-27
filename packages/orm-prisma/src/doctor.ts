// Doctor checks contributed by @rudderjs/orm-prisma.

import fs from 'node:fs'
import path from 'node:path'
import { execSync, spawnSync } from 'node:child_process'
import { registerDoctorCheck, type DoctorResult } from '@rudderjs/console'

/** Redact the password from a Prisma DATABASE_URL for safe error messages. */
function redactDsn(url: string): string {
  return url.replace(/:\/\/([^:@]+):[^@]+@/, '://$1:***@')
}

function exists(rel: string): boolean {
  try { fs.statSync(path.join(process.cwd(), rel)); return true } catch { return false }
}

function mtime(rel: string): number | null {
  try { return fs.statSync(path.join(process.cwd(), rel)).mtimeMs } catch { return null }
}

function findSchemaFiles(): string[] {
  // Two scaffolder shapes: `prisma/schema.prisma` (single-file) or
  // `prisma/schema/*.prisma` (multi-file split — what create-rudder emits).
  const out: string[] = []
  if (exists('prisma/schema.prisma')) out.push('prisma/schema.prisma')
  try {
    const dir = path.join(process.cwd(), 'prisma/schema')
    for (const f of fs.readdirSync(dir)) {
      if (f.endsWith('.prisma')) out.push(path.join('prisma/schema', f))
    }
  } catch { /* dir doesn't exist */ }
  return out
}

/**
 * Locate the directory `prisma generate` actually wrote into. Tries (in order):
 *
 * 1. The `output = "..."` declared in a `generator client {}` block in any
 *    user schema file. Resolved relative to that schema's directory (Prisma
 *    docs). This is the Prisma 7 `prisma-client` generator path and any
 *    explicit `output` config.
 * 2. `node_modules/@prisma/client/node_modules/.prisma/client/` — Prisma 7
 *    default with pnpm. `prisma generate` writes a nested `.prisma/client/`
 *    INSIDE the resolved `@prisma/client` package. fs.statSync follows the
 *    outer symlink so this path works regardless of where the pnpm-real
 *    directory lives.
 * 3. `node_modules/.prisma/client/` — legacy / hoisted layout (Prisma 5/6,
 *    or npm/yarn flat node_modules).
 *
 * Returns the absolute path to the generated dir, or null if no generated
 * client is found. Exported for testing.
 */
export function findGeneratedClientDir(schemas: string[], cwd: string = process.cwd()): string | null {
  // 1. Schema-declared output. Walk each schema looking for the first
  //    `generator <name> { ... output = "..." ... }` block. Non-greedy `[^}]*?`
  //    keeps us inside one block.
  const outputRe = /generator\s+\w+\s*\{[^}]*?output\s*=\s*"([^"]+)"/s
  for (const schemaRel of schemas) {
    const schemaAbs = path.join(cwd, schemaRel)
    let content: string
    try { content = fs.readFileSync(schemaAbs, 'utf-8') } catch { continue }
    const match = content.match(outputRe)
    if (match?.[1]) {
      const resolved = path.resolve(path.dirname(schemaAbs), match[1])
      if (fs.existsSync(resolved)) return resolved
    }
  }
  // 2. Resolve `@prisma/client` and look for a sibling `.prisma/client/`
  //    inside its own node_modules container. Works for:
  //      - pnpm: realpath is .pnpm/<id>/node_modules/@prisma/client/; the
  //        siblings live at .pnpm/<id>/node_modules/.prisma/client/.
  //      - npm/yarn flat: realpath is node_modules/@prisma/client/; siblings
  //        live at node_modules/.prisma/client/.
  //    `prisma generate` writes the generated artifacts there in both shapes.
  try {
    const realClient = fs.realpathSync(path.join(cwd, 'node_modules', '@prisma', 'client'))
    // realClient = <container>/node_modules/@prisma/client → siblings at
    // <container>/node_modules/.prisma/client (two levels up + .prisma/client).
    const sibling = path.join(realClient, '..', '..', '.prisma', 'client')
    if (fs.existsSync(sibling)) return sibling
  } catch { /* @prisma/client not installed (Prisma 7 prisma-client generator only) */ }
  // 3. Legacy / hoisted layout at the project root.
  const topLevel = path.join(cwd, 'node_modules', '.prisma', 'client')
  if (fs.existsSync(topLevel)) return topLevel
  return null
}

/** Newest file mtime in a directory. 0 if dir is empty or unreadable. */
function newestFileMtime(dir: string): number {
  let max = 0
  try {
    for (const f of fs.readdirSync(dir)) {
      try {
        const m = fs.statSync(path.join(dir, f)).mtimeMs
        if (m > max) max = m
      } catch { /* skip */ }
    }
  } catch { /* unreadable */ }
  return max
}

registerDoctorCheck({
  id:       'orm-prisma:schema',
  category: 'orm',
  title:    'Prisma schema',
  run(): DoctorResult {
    const files = findSchemaFiles()
    if (files.length === 0) {
      return {
        status:  'error',
        message: 'no prisma/schema.prisma or prisma/schema/*.prisma found',
        fix:     'Create prisma/schema.prisma (or prisma/schema/<name>.prisma for multi-file) with your data model',
      }
    }
    return { status: 'ok', message: `${files.length} file${files.length === 1 ? '' : 's'} (${files.join(', ')})` }
  },
})

registerDoctorCheck({
  id:       'orm-prisma:client-generated',
  category: 'orm',
  title:    'Prisma client',
  run(): DoctorResult {
    const schemas = findSchemaFiles()
    if (schemas.length === 0) {
      return { status: 'ok', message: 'no schema — skip (covered by orm-prisma:schema)' }
    }
    // Locate the directory `prisma generate` actually wrote to. Handles:
    // schema-declared `output = "..."`, Prisma 7 + pnpm nested layout, and
    // the legacy `node_modules/.prisma/client/` flat layout. Comparing against
    // `node_modules/@prisma/client/package.json` (the previous approach) was
    // unreliable under Prisma 7 + pnpm — the symlinked package.json mtime
    // never moves on regenerate; the actual artifacts land in the nested
    // .prisma/client/ directory instead.
    const dir = findGeneratedClientDir(schemas)
    if (dir === null) {
      return {
        status:  'error',
        message: 'not generated — no .prisma/client/ directory found',
        fix:     'pnpm rudder db:generate',
      }
    }
    const clientMtime  = newestFileMtime(dir)
    const newestSchema = schemas.reduce<number>((acc, f) => Math.max(acc, mtime(f) ?? 0), 0)
    if (clientMtime > 0 && newestSchema > 0 && clientMtime < newestSchema) {
      const minsBehind = Math.round((newestSchema - clientMtime) / 1000 / 60)
      return {
        status:  'warn',
        message: `stale — schema is newer by ~${minsBehind}min`,
        fix:     'pnpm rudder db:generate',
      }
    }
    // pnpm puts the generated client deep under .pnpm/<id>/… — the full
    // relative path is noise. Collapse it to a short "via pnpm" tag and
    // show the real path only when it's a custom output or a flat layout.
    const rel = path.relative(process.cwd(), dir)
    const short = rel.includes(`node_modules${path.sep}.pnpm${path.sep}`)
      ? 'node_modules/.prisma/client (via pnpm)'
      : rel
    return { status: 'ok', message: `present and current (${short})` }
  },
  fixer(): DoctorResult {
    // Same path as `rudder db:generate` — shell-out to `pnpm exec prisma
    // generate`. The migrate.ts command hardcodes pnpm; we match so behavior
    // is consistent (a non-pnpm doctor user wouldn't have working db:generate
    // either, so the fixer doesn't introduce a new constraint).
    const result = spawnSync('pnpm', ['exec', 'prisma', 'generate'], {
      cwd:     process.cwd(),
      stdio:   ['ignore', 'pipe', 'pipe'],
      timeout: 60_000,
    })
    if (result.status === 0) {
      return { status: 'ok', message: 'client regenerated' }
    }
    const stderr = (result.stderr?.toString() ?? '').trim()
    const stdout = (result.stdout?.toString() ?? '').trim()
    const detail = stderr || stdout
    const out: DoctorResult = {
      status:  'error',
      message: `prisma generate failed (exit ${result.status ?? 'null'})`,
    }
    if (detail) out.detail = detail.slice(0, 800)
    return out
  },
})

registerDoctorCheck({
  id:       'orm-prisma:database-url',
  category: 'orm',
  title:    'DATABASE_URL',
  run(): DoctorResult {
    const v = process.env['DATABASE_URL']
    if (!v) {
      return {
        status:  'error',
        message: 'unset',
        fix:     'Add DATABASE_URL to .env (e.g. `DATABASE_URL=file:./dev.db` for sqlite, or your postgres/mysql connection string)',
      }
    }
    // Parseable check — Prisma accepts file:, postgres://, postgresql://, mysql://, sqlserver://, mongodb://, mongodb+srv://
    if (!/^(file:|postgres(ql)?:\/\/|mysql:\/\/|sqlserver:\/\/|mongodb(\+srv)?:\/\/)/.test(v)) {
      return {
        status:  'warn',
        message: 'set but doesn\'t look like a Prisma-supported URL scheme',
        fix:     'Prisma accepts file:, postgres://, postgresql://, mysql://, sqlserver://, mongodb://, mongodb+srv://',
      }
    }
    return { status: 'ok', message: `set (${v.split(':')[0]})` }
  },
})

// ─── --deep checks ────────────────────────────────────────
//
// runtime:db-connect — verify the DB is reachable by running a trivial $queryRaw
// on the app's ALREADY-CONSTRUCTED client. --deep boots the app, so the adapter
// has built + cached the client (with the correct driver adapter / options) on
// globalThis. We reuse it rather than spawning a fresh `new PrismaClient()`:
// Prisma 7's `prisma-client` generator REJECTS a bare client (it needs the
// driver adapter the app wires), so a bare construction throws an unhandled
// exception (https://github.com/rudderjs/rudder — doctor was broken on Prisma 7).
// Reusing the app's client also tests exactly what the app uses. We do NOT
// disconnect it — it's the app's shared, HMR-reused pool.

// Shape of the orm-prisma adapter's globalThis client cache (see index.ts).
type CachedPrismaClient = {
  $queryRaw(strings: TemplateStringsArray, ...args: unknown[]): Promise<unknown>
}
const PRISMA_CLIENT_CACHE_KEY = '__rudderjs_prisma_client__'

registerDoctorCheck({
  id:        'orm-prisma:db-connect',
  category:  'runtime',
  title:     'Database connection',
  needsBoot: true,
  async run(): Promise<DoctorResult> {
    const dsn = process.env['DATABASE_URL']
    if (!dsn) {
      return { status: 'ok', message: 'no DATABASE_URL — skip (covered by orm-prisma:database-url)' }
    }
    const cached = (globalThis as Record<string, unknown>)[PRISMA_CLIENT_CACHE_KEY] as
      | { client?: CachedPrismaClient }
      | undefined
    const client = cached?.client
    if (!client) {
      return {
        status:  'warn',
        message: 'no Prisma client constructed during boot — skip (app may not use @rudderjs/orm-prisma, or boot failed)',
        fix:     'Run `pnpm rudder doctor --deep` from the app root; if the app uses Prisma, check the boot error above.',
      }
    }
    const t0 = performance.now()
    try {
      await client.$queryRaw`SELECT 1`
      const ms = Math.round(performance.now() - t0)
      return { status: 'ok', message: `connected in ${ms}ms (${dsn.split(':')[0]})` }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      // Strip the leading `Invalid \`prisma...\` invocation:` frame Prisma
      // tacks on every error — the user wants the actual cause.
      const trimmed = msg.replace(/^Invalid `.+?` invocation[:\n]/s, '').split('\n').slice(0, 4).join(' ').trim()
      return {
        status:  'error',
        message: trimmed.slice(0, 200),
        fix:     `Check DATABASE_URL (${redactDsn(dsn)}) is reachable and credentials are correct; run \`pnpm rudder db:push\` if the schema isn't applied yet.`,
        detail:  msg,
      }
    }
    // NB: no $disconnect — `client` is the app's shared pool (reused across HMR re-boots).
  },
})

// runtime:migration-drift — parse `prisma migrate status` output. Warn on
// pending migrations OR drift detected. Prisma's exit codes: 0 = up to
// date, 1 = drift/pending. We treat 1 as a warn (not an error) because
// many dev workflows intentionally have unapplied migrations.

registerDoctorCheck({
  id:        'orm-prisma:migration-drift',
  category:  'runtime',
  title:     'Migration status',
  needsBoot: true,
  run(): DoctorResult {
    if (!process.env['DATABASE_URL']) {
      return { status: 'ok', message: 'no DATABASE_URL — skip' }
    }
    try {
      const out = execSync('pnpm exec prisma migrate status', {
        cwd:     process.cwd(),
        stdio:   ['ignore', 'pipe', 'pipe'],
        timeout: 8000,
      }).toString()
      return { status: 'ok', message: out.includes('Database schema is up to date') ? 'up to date' : 'in sync' }
    } catch (e) {
      // Prisma exits non-zero on drift; the stdout/stderr still carries the
      // detail. execSync's error has `.stdout` and `.stderr` buffers.
      const err = e as { stdout?: Buffer; stderr?: Buffer; status?: number; message?: string }
      const text = `${err.stdout ?? ''}\n${err.stderr ?? ''}`
      if (/Following migration[s]? have not yet been applied|Drift detected|migrations? to apply/i.test(text)) {
        return {
          status:  'warn',
          message: 'pending migrations or schema drift',
          fix:     'pnpm rudder migrate (or `pnpm exec prisma migrate deploy` in production)',
          detail:  text.trim().slice(0, 800),
        }
      }
      // Some other error (no prisma binary, etc.) — surface as a soft warn
      const detail = text.trim().slice(0, 800) || err.message
      const out: DoctorResult = {
        status:  'warn',
        message: 'could not check migration status',
        fix:     'Install prisma CLI or run `pnpm exec prisma migrate status` manually',
      }
      if (detail) out.detail = detail
      return out
    }
  },
})
