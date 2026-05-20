// Doctor checks contributed by @rudderjs/orm-prisma.

import fs from 'node:fs'
import path from 'node:path'
import { registerDoctorCheck, type DoctorResult } from '@rudderjs/console'

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
