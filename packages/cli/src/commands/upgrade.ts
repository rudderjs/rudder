import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import type { Command } from 'commander'

// ── Package manager detection ─────────────────────────────────

type PackageManager = 'pnpm' | 'npm' | 'yarn' | 'bun'

function detectPackageManager(cwd: string): PackageManager {
  // Lockfile is the most reliable signal — survives `rudder` invocation from
  // any shell. `npm_config_user_agent` is the secondary signal.
  if (existsSync(path.join(cwd, 'pnpm-lock.yaml')))       return 'pnpm'
  if (existsSync(path.join(cwd, 'bun.lockb')))            return 'bun'
  if (existsSync(path.join(cwd, 'yarn.lock')))            return 'yarn'
  if (existsSync(path.join(cwd, 'package-lock.json')))    return 'npm'
  const ua = process.env['npm_config_user_agent'] ?? ''
  if (ua.startsWith('pnpm')) return 'pnpm'
  if (ua.startsWith('yarn')) return 'yarn'
  if (ua.startsWith('bun'))  return 'bun'
  if (ua.startsWith('npm'))  return 'npm'
  return 'pnpm'
}

function pmInstall(pm: PackageManager): string[] {
  // Plain install — re-resolves every dep range based on the new
  // `package.json` values. Same shape across all four managers.
  return ['install']
}

// ── Semver (just enough) ──────────────────────────────────────

interface ParsedVersion { major: number; minor: number; patch: number }

/**
 * Classify what kind of range string a dep is using. The upgrade command
 * treats each shape differently:
 *
 * - `workspace` — `workspace:*` / `workspace:^` etc. Monorepo refs; skipped
 *   silently because they're resolved by pnpm at install time, not from npm.
 * - `floating` — `latest`, `*`, `next`, empty string. The user opted into
 *   auto-latest; we surface what `latest` currently resolves to as info but
 *   don't rewrite the range (rewriting to a caret would change semantics —
 *   they'd stop auto-picking-up future majors).
 * - `pinned` — anything that parses as a real version range (`^1.2.3`,
 *   `~1.2.3`, `1.2.3`, etc.). Bumped normally.
 */
function shapeOfRange(range: string): 'workspace' | 'floating' | 'pinned' {
  const t = range.trim()
  if (t.startsWith('workspace:')) return 'workspace'
  if (t === 'latest' || t === '*' || t === 'next' || t === '')
    return 'floating'
  return 'pinned'
}

function parseVersion(v: string): ParsedVersion | null {
  // Strip caret/tilde/comparator + any pre-release / build metadata.
  // Apps occasionally pin to `1.2.3-beta.4` from a changesets prerelease —
  // we keep only the numeric triple for comparison.
  const m = /^[\^~>=<v]*\s*(\d+)\.(\d+)\.(\d+)/.exec(v.trim())
  if (!m) return null
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) }
}

function compareVersions(a: ParsedVersion, b: ParsedVersion): number {
  if (a.major !== b.major) return a.major - b.major
  if (a.minor !== b.minor) return a.minor - b.minor
  return a.patch - b.patch
}

function fmt(v: ParsedVersion): string {
  return `${v.major}.${v.minor}.${v.patch}`
}

// ── NPM registry ──────────────────────────────────────────────

interface NpmDistTag { version: string }

/**
 * Fetch the `latest` dist-tag for a single package. Returns `null` when the
 * registry call fails (network, 404, malformed JSON) — caller skips that
 * package with a clear warning rather than aborting the whole upgrade.
 */
async function fetchLatest(pkg: string, registry: string): Promise<string | null> {
  // `encodeURIComponent` correctly encodes every character that's invalid in a
  // URL path segment — handles the scope separator `/` AND any future-edge
  // character without us tracking the spec. CodeQL's
  // `js/incomplete-string-escaping` flagged the prior `.replace('/', '%2F')`
  // for replacing only the first occurrence (false-positive for scoped npm
  // names, which only have one `/`, but the safer encoding has no downside).
  const url = `${registry.replace(/\/+$/, '')}/${encodeURIComponent(pkg)}/latest`
  try {
    const res = await fetch(url, { headers: { accept: 'application/json' } })
    if (!res.ok) return null
    const json = await res.json() as NpmDistTag
    return typeof json.version === 'string' ? json.version : null
  } catch {
    return null
  }
}

// ── Upgrade plan ──────────────────────────────────────────────

type UpgradeMode = 'latest' | 'minor' | 'patch'

interface DepEntry {
  name:    string
  range:   string
  section: 'dependencies' | 'devDependencies' | 'peerDependencies'
}

interface PlanRow {
  name:     string
  section:  DepEntry['section']
  current:  ParsedVersion
  latest:   ParsedVersion
  target:   ParsedVersion
  newRange: string
}

function buildTarget(current: ParsedVersion, latest: ParsedVersion, mode: UpgradeMode): ParsedVersion {
  // Cap the target by mode — `--minor` stays inside the current major,
  // `--patch` stays inside the current minor. `--latest` is unbounded.
  if (mode === 'latest') return latest
  if (mode === 'minor') {
    return latest.major === current.major ? latest : current
  }
  // patch
  return latest.major === current.major && latest.minor === current.minor ? latest : current
}

function collectDeps(pkg: Record<string, unknown>): DepEntry[] {
  const out: DepEntry[] = []
  for (const section of ['dependencies', 'devDependencies', 'peerDependencies'] as const) {
    const map = pkg[section]
    if (!map || typeof map !== 'object') continue
    for (const [name, range] of Object.entries(map as Record<string, string>)) {
      if (name.startsWith('@rudderjs/') && typeof range === 'string') {
        out.push({ name, range, section })
      }
    }
  }
  return out
}

// ── Output ────────────────────────────────────────────────────

const isTTY = process.stdout.isTTY ?? false
const dim   = (s: string) => isTTY ? `\x1b[2m${s}\x1b[0m` : s
const bold  = (s: string) => isTTY ? `\x1b[1m${s}\x1b[0m` : s
const green = (s: string) => isTTY ? `\x1b[32m${s}\x1b[0m` : s
const cyan  = (s: string) => isTTY ? `\x1b[36m${s}\x1b[0m` : s
const yel   = (s: string) => isTTY ? `\x1b[33m${s}\x1b[0m` : s
const red   = (s: string) => isTTY ? `\x1b[31m${s}\x1b[0m` : s

function colorBump(current: ParsedVersion, target: ParsedVersion): (s: string) => string {
  if (target.major > current.major) return red       // major
  if (target.minor > current.minor) return cyan      // minor
  if (target.patch > current.patch) return green     // patch
  return dim
}

function renderPlan(rows: PlanRow[]): void {
  const nameWidth = Math.max(...rows.map(r => r.name.length))
  for (const row of rows) {
    const color = colorBump(row.current, row.latest)
    const left  = row.name.padEnd(nameWidth)
    const arrow = dim('→')
    console.log(`  ${left}  ${dim(fmt(row.current))} ${arrow} ${color(fmt(row.target))}  ${dim('(' + row.section + ')')}`)
  }
}

// ── Apply ─────────────────────────────────────────────────────

function applyUpdates(pkgPath: string, pkg: Record<string, unknown>, rows: PlanRow[]): void {
  for (const row of rows) {
    const section = pkg[row.section] as Record<string, string>
    section[row.name] = row.newRange
  }
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
}

function runInstall(pm: PackageManager, cwd: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(pm, pmInstall(pm), { cwd, stdio: 'inherit', shell: process.platform === 'win32' })
    child.on('close', (code) => resolve(code === 0))
    child.on('error',          () => resolve(false))
  })
}

// ── Command ───────────────────────────────────────────────────

interface UpgradeOptions {
  check?:    boolean
  dryRun?:   boolean
  latest?:   boolean
  minor?:    boolean
  patch?:    boolean
  registry?: string
}

export function upgradeCommand(program: Command): void {
  program
    .command('upgrade')
    .description('Bump every @rudderjs/* dep in package.json to the latest published version')
    .option('--check',          'exit 1 if updates are available; do NOT modify package.json (CI-friendly)')
    .option('--dry-run',        'show what would change without modifying package.json or installing')
    .option('--latest',         'bump to the latest version regardless of current range (default)')
    .option('--minor',          'bump within the current major only')
    .option('--patch',          'bump within the current minor only')
    .option('--registry <url>', 'override the npm registry URL', 'https://registry.npmjs.org')
    .action(async (opts: UpgradeOptions) => {
      const cwd = process.cwd()
      const pkgPath = path.join(cwd, 'package.json')
      if (!existsSync(pkgPath)) {
        console.error(red('[rudder upgrade]') + ` no package.json in ${cwd}`)
        process.exit(1)
      }

      // Mode selection — `--patch` beats `--minor` beats `--latest` if more
      // than one is passed (most-restrictive wins, matches npm conventions).
      const mode: UpgradeMode = opts.patch ? 'patch' : opts.minor ? 'minor' : 'latest'

      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as Record<string, unknown>
      const deps = collectDeps(pkg)
      if (deps.length === 0) {
        console.log(dim('  No @rudderjs/* dependencies in package.json — nothing to upgrade.'))
        return
      }

      console.log(`\n  ${bold('Checking ' + deps.length + ' @rudderjs/* packages...')}`)

      const registry = opts.registry ?? 'https://registry.npmjs.org'
      const fetched = await Promise.all(deps.map(async (d) => {
        const latest = await fetchLatest(d.name, registry)
        return { dep: d, latest }
      }))

      const skipped:  string[] = []
      const floating: Array<{ name: string; range: string; resolves: string }> = []
      const rows:     PlanRow[] = []
      for (const { dep, latest } of fetched) {
        const shape = shapeOfRange(dep.range)
        if (shape === 'workspace') continue   // monorepo refs — silently skipped
        if (latest === null) {
          skipped.push(`${dep.name} (registry unreachable)`)
          continue
        }
        if (shape === 'floating') {
          // The user opted into `latest` / `*` — record what it resolves to
          // today as info; do NOT rewrite the range (would change semantics).
          floating.push({ name: dep.name, range: dep.range, resolves: latest })
          continue
        }
        const current = parseVersion(dep.range)
        const latestParsed = parseVersion(latest)
        if (!current || !latestParsed) {
          skipped.push(`${dep.name} (couldn't parse "${dep.range}" or "${latest}")`)
          continue
        }
        if (compareVersions(latestParsed, current) <= 0) continue   // already at/above latest
        const target = buildTarget(current, latestParsed, mode)
        if (compareVersions(target, current) <= 0) continue           // mode capped — no bump within bound
        rows.push({
          name:     dep.name,
          section:  dep.section,
          current,
          latest:   latestParsed,
          target,
          newRange: `^${fmt(target)}`,
        })
      }

      if (floating.length) {
        const nameWidth = Math.max(...floating.map(f => f.name.length))
        console.log(dim('\n  Floating ranges (left as-is — your package.json says "use latest"):'))
        for (const f of floating) {
          console.log(`    ${dim(f.name.padEnd(nameWidth))}  ${dim(`"${f.range}" resolves to ${f.resolves} today`)}`)
        }
        console.log(dim('    Run your package manager\'s install to refresh the lockfile.'))
      }

      if (skipped.length) {
        console.log(yel('\n  Could not check:'))
        for (const s of skipped) console.log(`    ${dim('•')} ${s}`)
      }

      if (rows.length === 0) {
        const pinnedChecked = deps.length - skipped.length - floating.length
          - deps.filter(d => shapeOfRange(d.range) === 'workspace').length
        if (pinnedChecked === 0 && floating.length === 0) {
          // Every dep was workspace / unreachable — most commonly a
          // monorepo. Avoid the misleading "everything up to date" green tick.
          console.log(dim('\n  Nothing to do — no parseable @rudderjs/* version ranges to check.'))
        } else if (pinnedChecked === 0) {
          // Only floating ranges — the info block above already covered it.
          // Don't repeat with a green tick that implies bump verification.
        } else {
          console.log(green(`\n  ✓ All ${pinnedChecked} pinned @rudderjs/* dependency(ies) are up to date.`))
        }
        return
      }

      console.log(`\n  ${bold('Updates available:')}`)
      renderPlan(rows)

      // Legend — only show when there are colored bumps to explain.
      const hasMajor = rows.some(r => r.target.major > r.current.major)
      if (hasMajor) {
        console.log(`\n  ${red('●')} major  ${cyan('●')} minor  ${green('●')} patch`)
        console.log(dim('  Major bumps may contain breaking changes — review CHANGELOGs before applying.'))
      }

      if (opts.check) {
        console.log(dim(`\n  --check mode: ${rows.length} update(s) available (exit 1).`))
        process.exit(1)
      }

      if (opts.dryRun) {
        console.log(dim('\n  --dry-run: package.json not modified.'))
        return
      }

      applyUpdates(pkgPath, pkg, rows)
      console.log(dim('\n  Updated package.json.'))

      const pm = detectPackageManager(cwd)
      console.log(`\n  Running ${cyan(pm + ' install')}...\n`)
      const ok = await runInstall(pm, cwd)
      if (!ok) {
        console.error(red('\n  Install failed.') + dim(' package.json was updated; you may need to install manually or revert.'))
        process.exit(1)
      }
      console.log(green(`\n  ✓ Upgraded ${rows.length} package(s).`))
    })
}

// ── Test surface ──────────────────────────────────────────────

/** @internal — exposed for unit tests */
export const _internal = {
  parseVersion,
  compareVersions,
  buildTarget,
  collectDeps,
  detectPackageManager,
  shapeOfRange,
}
