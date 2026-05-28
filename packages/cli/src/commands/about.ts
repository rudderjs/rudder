import { readFileSync, existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createRequire } from 'node:module'
import type { Command } from 'commander'
import { loadDotenvForChecks } from '../doctor/load-dotenv.js'

// ── Types ─────────────────────────────────────────────────────

interface PackageInfo {
  name:    string
  version: string
}

interface AboutSnapshot {
  application: {
    name:    string
    env:     string | null
    debug:   string | null
    url:     string | null
  }
  runtime: {
    node:       string
    os:         string
    arch:       string
    pm:         string
  }
  rudder: {
    coreVersion: string | null
    cliVersion:  string | null
  }
  packages: PackageInfo[]
}

// ── Snapshot collectors ──────────────────────────────────────

/**
 * Read the consumer's `package.json` for app name + the install plan, then
 * walk `node_modules/@rudderjs/*` to enumerate every installed framework
 * package with its actual installed version. Skip-boot — no app machinery
 * runs, so the command stays fast and works even when the app can't boot
 * (broken provider, missing manifest, etc.).
 */
export function collectSnapshot(cwd: string): AboutSnapshot {
  const pkgPath = path.join(cwd, 'package.json')
  const pkg = existsSync(pkgPath)
    ? (JSON.parse(readFileSync(pkgPath, 'utf8')) as Record<string, unknown>)
    : {}

  return {
    application: {
      name:  String(pkg['name'] ?? '<unnamed>'),
      env:   process.env['APP_ENV']   ?? null,
      debug: process.env['APP_DEBUG'] ?? null,
      url:   process.env['APP_URL']   ?? null,
    },
    runtime: {
      node: process.version,
      os:   `${os.type()} ${os.release()}`,
      arch: process.arch,
      pm:   detectPackageManager(cwd),
    },
    rudder: {
      coreVersion: readInstalledPackageVersion(cwd, '@rudderjs/core'),
      cliVersion:  readInstalledPackageVersion(cwd, '@rudderjs/cli'),
    },
    packages: listInstalledRudderPackages(cwd),
  }
}

/**
 * Detect the package manager the user is on, in the same shape `rudder
 * upgrade` does — lockfile is the strongest signal, then npm_config_user_agent,
 * then a sane default.
 */
function detectPackageManager(cwd: string): string {
  if (existsSync(path.join(cwd, 'pnpm-lock.yaml')))    return 'pnpm'
  if (existsSync(path.join(cwd, 'bun.lockb')))         return 'bun'
  if (existsSync(path.join(cwd, 'yarn.lock')))         return 'yarn'
  if (existsSync(path.join(cwd, 'package-lock.json'))) return 'npm'
  const ua = process.env['npm_config_user_agent'] ?? ''
  if (ua.startsWith('pnpm')) return 'pnpm'
  if (ua.startsWith('yarn')) return 'yarn'
  if (ua.startsWith('bun'))  return 'bun'
  if (ua.startsWith('npm'))  return 'npm'
  return 'unknown'
}

/**
 * Read a specific package's installed version by resolving its package.json
 * relative to `cwd`. `createRequire(cwd + '/')` lets node resolve like the
 * consumer would. Returns `null` when the package isn't installed.
 */
function readInstalledPackageVersion(cwd: string, name: string): string | null {
  try {
    const require = createRequire(path.join(cwd, 'package.json'))
    const pkg = require(`${name}/package.json`) as { version?: string }
    return typeof pkg.version === 'string' ? pkg.version : null
  } catch {
    return null
  }
}

/**
 * List every `@rudderjs/*` package present in `node_modules`. Scans the
 * `node_modules/@rudderjs/` directory directly so unhoisted (pnpm
 * `.pnpm/`-pinned) entries surface alongside top-level ones. Returns
 * `[]` on any failure — graceful.
 */
function listInstalledRudderPackages(cwd: string): PackageInfo[] {
  const scopeDir = path.join(cwd, 'node_modules', '@rudderjs')
  if (!existsSync(scopeDir)) return []
  const out: PackageInfo[] = []
  let entries: string[]
  try { entries = readdirSync(scopeDir) } catch { return [] }
  for (const entry of entries) {
    if (entry.startsWith('.')) continue
    const pkgJson = path.join(scopeDir, entry, 'package.json')
    if (!existsSync(pkgJson)) continue
    try {
      const meta = JSON.parse(readFileSync(pkgJson, 'utf8')) as { name?: string; version?: string }
      if (meta.name && meta.version) {
        out.push({ name: meta.name, version: meta.version })
      }
    } catch { /* skip unreadable manifest */ }
  }
  out.sort((a, b) => a.name.localeCompare(b.name))
  return out
}

// ── Output ────────────────────────────────────────────────────

const isTTY = process.stdout.isTTY ?? false
const dim   = (s: string) => isTTY ? `\x1b[2m${s}\x1b[0m` : s
const bold  = (s: string) => isTTY ? `\x1b[1m${s}\x1b[0m` : s
const cyan  = (s: string) => isTTY ? `\x1b[36m${s}\x1b[0m` : s
const yel   = (s: string) => isTTY ? `\x1b[33m${s}\x1b[0m` : s

/** Right-pad with leading dots, Laravel-style. Plays nice with ANSI codes. */
function dottedRow(label: string, value: string, width = 70): string {
  const labelLen = label.length
  const valueLen = stripAnsi(value).length
  const dots = '.'.repeat(Math.max(2, width - labelLen - valueLen - 1))
  return `  ${label} ${dim(dots)} ${value}`
}

/** Strip ANSI escapes for width math. Cheap and self-contained. */
function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[\d+m/g, '')
}

export function renderText(snap: AboutSnapshot): string[] {
  const out: string[] = []
  out.push(bold('\nEnvironment'))
  out.push(dottedRow('App Name',         cyan(snap.application.name)))
  out.push(dottedRow('Framework',        cyan(snap.rudder.coreVersion ? `@rudderjs/core ${snap.rudder.coreVersion}` : 'not installed')))
  out.push(dottedRow('CLI',              cyan(snap.rudder.cliVersion  ? `@rudderjs/cli ${snap.rudder.cliVersion}`   : 'not installed')))
  out.push(dottedRow('Node',             cyan(snap.runtime.node)))
  out.push(dottedRow('Package Manager',  cyan(snap.runtime.pm)))
  out.push(dottedRow('OS',               cyan(`${snap.runtime.os} (${snap.runtime.arch})`)))
  out.push(dottedRow('APP_ENV',          formatEnv(snap.application.env,   'not set')))
  out.push(dottedRow('APP_DEBUG',        formatEnv(snap.application.debug, 'not set')))
  out.push(dottedRow('APP_URL',          formatEnv(snap.application.url,   'not set')))

  if (snap.packages.length > 0) {
    out.push(bold(`\nInstalled @rudderjs/* packages (${snap.packages.length})`))
    const longest = Math.max(...snap.packages.map((p) => p.name.length))
    for (const p of snap.packages) {
      out.push(dottedRow(p.name.padEnd(longest), cyan(p.version)))
    }
  } else {
    out.push(bold('\nInstalled @rudderjs/* packages'))
    out.push(`  ${yel('(none found in node_modules)')}`)
  }

  return out
}

function formatEnv(value: string | null, fallback: string): string {
  if (value === null || value === '') return dim(`(${fallback})`)
  return cyan(value)
}

// ── Command ───────────────────────────────────────────────────

interface AboutOptions {
  json?: boolean
}

export function aboutCommand(program: Command): void {
  program
    .command('about')
    .description('Print a snapshot of the app — framework + runtime + installed packages (Laravel parity)')
    .option('--json', 'emit machine-readable JSON (useful for bug reports + LLM context)')
    .action((opts: AboutOptions) => {
      // `about` is in the skip-boot list (fast — no app machinery), so
      // bootstrap/app.ts's `import 'dotenv/config'` never runs. Pull `.env`
      // ourselves so APP_ENV / APP_DEBUG / APP_URL surface in the snapshot.
      loadDotenvForChecks(process.cwd())
      const snap = collectSnapshot(process.cwd())
      if (opts.json) {
        console.log(JSON.stringify(snap, null, 2))
        return
      }
      for (const line of renderText(snap)) console.log(line)
      console.log()   // trailing newline
    })
}

/** @internal — exposed for unit tests */
export const _internal = {
  collectSnapshot,
  renderText,
  detectPackageManager,
  listInstalledRudderPackages,
  readInstalledPackageVersion,
}
