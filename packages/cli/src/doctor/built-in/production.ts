import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { registerDoctorCheck, type DoctorResult } from '@rudderjs/console'

/**
 * Production-readiness checks — gated behind `rudder doctor --production`.
 *
 * These are deliberately strict: a green `--production` doctor is the
 * pre-deploy gate. Each check enforces an invariant that would be a real
 * incident in prod — security leak, broken deploy, accidental SQLite usage,
 * etc. — but would false-fire in local development (which is why they're
 * `productionOnly: true` and don't run in the default doctor pass).
 *
 * Designed to be run by CI before deploy:
 *
 *     pnpm rudder doctor --production
 *
 * Exit code 1 on any non-green outcome.
 */

// ── APP_DEBUG must be false ──────────────────────────────────

registerDoctorCheck({
  id:             'production:app-debug',
  category:       'production',
  title:          'APP_DEBUG must be off',
  productionOnly: true,
  run(): DoctorResult {
    const v = (process.env['APP_DEBUG'] ?? '').toLowerCase()
    if (v === 'true' || v === '1') {
      return {
        status:  'error',
        message: `APP_DEBUG=${process.env['APP_DEBUG']} would leak stack traces + dump() output to clients`,
        fix:     'Set APP_DEBUG=false in your production environment',
      }
    }
    return { status: 'ok', message: 'off' }
  },
})

// ── APP_ENV must be production ───────────────────────────────

registerDoctorCheck({
  id:             'production:app-env',
  category:       'production',
  title:          'APP_ENV should be "production"',
  productionOnly: true,
  run(): DoctorResult {
    const v = process.env['APP_ENV']
    if (v === 'production') return { status: 'ok', message: 'production' }
    return {
      status:  'warn',
      message: `APP_ENV=${v ?? '<unset>'} (expected "production")`,
      fix:     'Set APP_ENV=production in your production environment',
    }
  },
})

// ── APP_URL must be HTTPS ────────────────────────────────────

registerDoctorCheck({
  id:             'production:app-url',
  category:       'production',
  title:          'APP_URL must be HTTPS',
  productionOnly: true,
  run(): DoctorResult {
    const v = process.env['APP_URL']
    if (!v) return { status: 'warn', message: 'APP_URL unset', fix: 'Set APP_URL=https://your-domain in your production environment' }
    if (v.startsWith('http://')) {
      return {
        status:  'error',
        message: `APP_URL=${v} uses plain HTTP`,
        fix:     'Change to https:// — auth cookies + CSP rely on the URL matching the scheme served',
      }
    }
    return { status: 'ok', message: v }
  },
})

// ── DATABASE_URL must not be local ───────────────────────────

registerDoctorCheck({
  id:             'production:database-url',
  category:       'production',
  title:          'DATABASE_URL must point at a real database',
  productionOnly: true,
  run(): DoctorResult {
    const v = process.env['DATABASE_URL']
    if (!v) return { status: 'ok', message: 'unset — assuming non-DB app' }   // no ORM = no problem
    if (v.startsWith('file:') || v.startsWith('sqlite:')) {
      return {
        status:  'error',
        message: `DATABASE_URL=${v} uses SQLite (file-based)`,
        fix:     'SQLite is fine for dev/tests; production needs Postgres / MySQL / a managed DB',
      }
    }
    if (/localhost|127\.0\.0\.1|0\.0\.0\.0/.test(v)) {
      return {
        status:  'error',
        message: `DATABASE_URL points at the local machine`,
        fix:     'Point at your managed/clustered DB host — the app server should not be the DB server in prod',
      }
    }
    return { status: 'ok', message: redactDsn(v) }
  },
})

// ── No `@rudderjs/*` on floating ranges ─────────────────────

registerDoctorCheck({
  id:             'production:rudder-pinning',
  category:       'production',
  title:          '@rudderjs/* deps should be pinned (no `latest`/`*`)',
  productionOnly: true,
  run(): DoctorResult {
    const pkgPath = path.join(process.cwd(), 'package.json')
    if (!existsSync(pkgPath)) return { status: 'warn', message: 'no package.json in cwd' }
    let pkg: Record<string, unknown>
    try { pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as Record<string, unknown> }
    catch { return { status: 'error', message: 'package.json not parseable' } }

    const floating: string[] = []
    for (const section of ['dependencies', 'devDependencies', 'peerDependencies'] as const) {
      const map = pkg[section] as Record<string, string> | undefined
      if (!map) continue
      for (const [name, range] of Object.entries(map)) {
        if (!name.startsWith('@rudderjs/')) continue
        const t = (range ?? '').trim()
        if (t === 'latest' || t === '*' || t === 'next' || t === '') floating.push(name)
      }
    }
    if (floating.length === 0) return { status: 'ok', message: 'every @rudderjs/* range is pinned' }
    return {
      status:  'warn',
      message: `${floating.length} dep(s) on a floating range: ${floating.join(', ')}`,
      fix:     'Pin these to caret ranges (e.g. ^1.5.1) so deploys aren\'t at the mercy of the dist-tag moving',
    }
  },
})

// ── No `workspace:*` refs ────────────────────────────────────

registerDoctorCheck({
  id:             'production:workspace-refs',
  category:       'production',
  title:          'No `workspace:*` refs in package.json',
  productionOnly: true,
  run(): DoctorResult {
    const pkgPath = path.join(process.cwd(), 'package.json')
    if (!existsSync(pkgPath)) return { status: 'warn', message: 'no package.json in cwd' }
    let pkg: Record<string, unknown>
    try { pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as Record<string, unknown> }
    catch { return { status: 'error', message: 'package.json not parseable' } }

    const workspaceRefs: string[] = []
    for (const section of ['dependencies', 'devDependencies', 'peerDependencies'] as const) {
      const map = pkg[section] as Record<string, string> | undefined
      if (!map) continue
      for (const [name, range] of Object.entries(map)) {
        if (typeof range === 'string' && range.trim().startsWith('workspace:')) {
          workspaceRefs.push(name)
        }
      }
    }
    if (workspaceRefs.length === 0) return { status: 'ok', message: 'no workspace: refs' }
    return {
      status:  'error',
      message: `${workspaceRefs.length} dep(s) use workspace: — only resolvable inside the monorepo: ${workspaceRefs.join(', ')}`,
      fix:     'Replace each `workspace:*` with a real version range before publishing/deploying',
    }
  },
})

// ── Build output exists ──────────────────────────────────────

registerDoctorCheck({
  id:             'production:dist-exists',
  category:       'production',
  title:          'dist/ build output must exist',
  productionOnly: true,
  run(): DoctorResult {
    if (existsSync(path.join(process.cwd(), 'dist'))) return { status: 'ok', message: 'present' }
    return {
      status:  'error',
      message: 'no dist/ in cwd',
      fix:     'Run your build step (`pnpm build` typically) before deploying',
    }
  },
})

// ── Providers manifest must exist ───────────────────────────

registerDoctorCheck({
  id:             'production:providers-manifest',
  category:       'production',
  title:          'bootstrap/cache/providers.json must exist',
  productionOnly: true,
  run(): DoctorResult {
    if (existsSync(path.join(process.cwd(), 'bootstrap', 'cache', 'providers.json'))) {
      return { status: 'ok', message: 'present' }
    }
    return {
      status:  'error',
      message: 'manifest missing — auto-discovery has nothing to load from',
      fix:     'Run `pnpm rudder providers:discover` as part of your deploy pipeline',
    }
  },
})

// ── Helpers ──────────────────────────────────────────────────

/**
 * Trim credentials out of a DSN-ish URL so the doctor report doesn't leak
 * secrets in CI logs. `postgres://user:secret@host:5432/db` → `postgres://[redacted]@host:5432/db`.
 */
function redactDsn(s: string): string {
  return s.replace(/:\/\/[^@]+@/, '://[redacted]@')
}
