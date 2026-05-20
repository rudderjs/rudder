// Doctor checks contributed by @rudderjs/orm-drizzle.

import fs from 'node:fs'
import path from 'node:path'
import { registerDoctorCheck, type DoctorResult } from '@rudderjs/console'

function anyExists(rels: string[]): string | null {
  for (const rel of rels) {
    try {
      fs.statSync(path.join(process.cwd(), rel))
      return rel
    } catch { /* keep looking */ }
  }
  return null
}

registerDoctorCheck({
  id:       'orm-drizzle:schema',
  category: 'orm',
  title:    'Drizzle schema',
  run(): DoctorResult {
    // Drizzle convention: db/schema.ts or src/db/schema.ts or drizzle/schema.ts.
    // Some projects also split into db/schema/*.ts.
    const candidates = [
      'db/schema.ts',     'db/schema.js',
      'drizzle/schema.ts', 'drizzle/schema.js',
      'src/db/schema.ts', 'src/db/schema.js',
    ]
    const dirCandidates = ['db/schema', 'drizzle/schema', 'src/db/schema']
    const file = anyExists(candidates)
    if (file) return { status: 'ok', message: file }
    for (const dir of dirCandidates) {
      try {
        const full = path.join(process.cwd(), dir)
        const entries = fs.readdirSync(full).filter(f => f.endsWith('.ts') || f.endsWith('.js'))
        if (entries.length > 0) {
          return { status: 'ok', message: `${dir} (${entries.length} files)` }
        }
      } catch { /* dir missing */ }
    }
    return {
      status:  'error',
      message: 'no db/schema.ts (or equivalent) found',
      fix:     'Create db/schema.ts and export your drizzle tables — see https://orm.drizzle.team for the syntax',
    }
  },
})

registerDoctorCheck({
  id:       'orm-drizzle:database-url',
  category: 'orm',
  title:    'DATABASE_URL',
  run(): DoctorResult {
    const v = process.env['DATABASE_URL']
    if (!v) {
      return {
        status:  'error',
        message: 'unset',
        fix:     'Add DATABASE_URL to .env (e.g. postgres://user:pass@host:5432/db, mysql://..., or file:./dev.db)',
      }
    }
    if (!/^(file:|postgres(ql)?:\/\/|mysql:\/\/|libsql:\/\/)/.test(v)) {
      return {
        status:  'warn',
        message: 'set but doesn\'t look like a Drizzle-supported URL scheme',
        fix:     'Drizzle accepts file:, postgres://, postgresql://, mysql://, libsql://',
      }
    }
    return { status: 'ok', message: `set (${v.split(':')[0]})` }
  },
})
