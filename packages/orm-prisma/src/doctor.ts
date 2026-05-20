// Doctor checks contributed by @rudderjs/orm-prisma.

import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
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
  // `prisma/schema/*.prisma` (multi-file split — what create-rudder-app emits).
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
    // Prisma generates either node_modules/.prisma/client (legacy default) or
    // node_modules/@prisma/client (newer) — accept either.
    const clientDirs = ['node_modules/.prisma/client', 'node_modules/@prisma/client']
    const clientPath = clientDirs.find(d => exists(`${d}/package.json`)) ?? null
    if (clientPath === null) {
      return {
        status:  'error',
        message: 'not generated — schema exists but no @prisma/client in node_modules',
        fix:     'pnpm rudder db:generate',
      }
    }
    // mtime sanity — client should be at least as new as the latest schema file
    const clientMtime = mtime(`${clientPath}/package.json`)
    const newestSchema = schemas.reduce<number>((acc, f) => Math.max(acc, mtime(f) ?? 0), 0)
    if (clientMtime !== null && newestSchema > 0 && clientMtime < newestSchema) {
      const minsBehind = Math.round((newestSchema - clientMtime) / 1000 / 60)
      return {
        status:  'warn',
        message: `stale — schema is newer by ~${minsBehind}min`,
        fix:     'pnpm rudder db:generate',
      }
    }
    return { status: 'ok', message: 'present and current' }
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
// runtime:db-connect — spawn a fresh PrismaClient (NOT the app's bound one;
// fail-fast on connection issues without depending on the app's DI graph)
// and run a trivial $queryRaw. Disconnects regardless of outcome.

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
    // Resolve @prisma/client through the user's node_modules so we get the
    // generated client (the framework's lazy peer-resolver pattern).
    const userRequire = (await import('node:module')).createRequire(path.join(process.cwd(), 'package.json'))
    let PrismaClient: new () => { $connect(): Promise<void>; $disconnect(): Promise<void>; $queryRaw(strings: TemplateStringsArray, ...args: unknown[]): Promise<unknown> }
    try {
      const mod = userRequire('@prisma/client')
      PrismaClient = mod.PrismaClient
    } catch {
      return {
        status:  'warn',
        message: '@prisma/client not resolvable — skip',
        fix:     'pnpm rudder db:generate',
      }
    }
    const client = new PrismaClient()
    const t0 = performance.now()
    try {
      await client.$connect()
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
    } finally {
      try { await client.$disconnect() } catch { /* best effort */ }
    }
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
