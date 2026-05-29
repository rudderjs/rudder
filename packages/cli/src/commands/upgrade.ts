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

// ── Peer-dep range satisfaction (just enough) ────────────────

/**
 * Extract the set of major versions a peer-dep range accepts, plus an
 * `'any'` flag for unbounded ranges (`*`, `>=4.2.0`, `||`-chained
 * everything). The CLI uses this to detect when a framework package has
 * bumped a peer-dep major past what the consumer's `package.json` carries
 * — the rudderjs.com case from 2026-05-29 was `@rudderjs/vite@2.7` requiring
 * `vite ^8` while the consumer was on `^7.1.0`.
 *
 * Handles the shapes that show up in real `peerDependencies` fields:
 * - `^8.0.0`                          → {8}
 * - `~8.0.0`                          → {8}
 * - `8.0.0`                           → {8}  (exact pin, but we widen to
 *                                              the major so an exact-pinned
 *                                              consumer doesn't false-fire)
 * - `^4.2.0 \|\| ^5.0.0 \|\| ^6.0.0 \|\| ^7.0.0 \|\| ^8.0.0`  → {4,5,6,7,8}
 * - `>=5.0.0`                         → 'any' (no upper bound)
 * - `*`                               → 'any'
 *
 * Unparseable alternatives are skipped; if every alternative is
 * unparseable, returns `'any'` (defensive — never block on a range we
 * can't read).
 */
function acceptedMajors(range: string): Set<number> | 'any' {
  const t = range.trim()
  if (t === '' || t === '*' || t === 'latest' || t === 'next') return 'any'
  const accepted = new Set<number>()
  let sawAny = false
  for (const alt of t.split('||').map((s) => s.trim())) {
    // Unbounded lower-bound comparators (`>=N`, `>N`, `>=N.M`, etc.) accept
    // anything past the floor — treat as 'any' for our purposes.
    if (/^(>=?|>)\s*\d+/.test(alt)) { sawAny = true; continue }
    const m = /^[\^~]?\s*(\d+)\./.exec(alt)
    if (m) accepted.add(Number(m[1]))
  }
  if (sawAny && accepted.size === 0) return 'any'
  if (accepted.size === 0) return 'any'   // unparseable — fail open
  return accepted
}

/**
 * Decide whether the consumer's installed range for a peer dep satisfies
 * the framework's required range. Returns `null` when satisfied; a
 * short reason string when not (used as the warning line).
 *
 * Strategy: both sides are reduced to "accepted majors" (or `'any'`) and
 * intersected. Any overlap = satisfied. No overlap = mismatch.
 */
function diffPeerRange(consumerRange: string, requiredRange: string): string | null {
  const consumer = acceptedMajors(consumerRange)
  const required = acceptedMajors(requiredRange)
  if (consumer === 'any' || required === 'any') return null
  for (const m of consumer) if (required.has(m)) return null
  // No overlap.
  const consumerList = [...consumer].sort((a, b) => a - b).join(', ')
  const requiredList = [...required].sort((a, b) => a - b).join(', ')
  return `consumer accepts major ${consumerList}, framework needs major ${requiredList}`
}

// ── NPM registry ──────────────────────────────────────────────

interface NpmDistTag { version: string }
interface NpmManifest {
  version: string
  peerDependencies?: Record<string, string>
}

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

/**
 * Fetch the full package manifest for `<pkg>@<version>` so we can read
 * `peerDependencies`. Used after the upgrade plan is built — only the
 * packages we're actually bumping get fetched, not every dep we checked.
 *
 * Returns `null` on any failure; caller silently drops peer-dep checking
 * for that package rather than aborting the whole upgrade.
 */
async function fetchManifest(pkg: string, version: string, registry: string): Promise<NpmManifest | null> {
  const url = `${registry.replace(/\/+$/, '')}/${encodeURIComponent(pkg)}/${version}`
  try {
    const res = await fetch(url, { headers: { accept: 'application/json' } })
    if (!res.ok) return null
    return await res.json() as NpmManifest
  } catch {
    return null
  }
}

// ── CHANGELOG fetch + parse ───────────────────────────────────

/**
 * Per-version entry parsed from a changesets-style CHANGELOG.md. `headline` is
 * the first meaningful bullet (changesets cite-prefix `abc1234: ` is stripped;
 * "Updated dependencies" lines are skipped); empty string when no usable line
 * exists.
 */
export interface ChangelogEntry {
  version:  string
  parsed:   ParsedVersion
  headline: string
}

/**
 * Fetch the CHANGELOG.md for a published `@rudderjs/<name>` package from
 * GitHub raw at `main`. The npm tarball intentionally excludes CHANGELOG.md
 * (every package's `files` field is just `["dist"]`), so unpkg returns 404;
 * the public-repo raw URL is the simplest reliable source.
 *
 * Returns `null` on any failure — caller silently drops changelog rendering
 * for that package rather than aborting the upgrade.
 */
async function fetchChangelog(pkg: string, baseUrl: string): Promise<string | null> {
  // `@rudderjs/foo` → `packages/foo/CHANGELOG.md` (matches the monorepo layout)
  if (!pkg.startsWith('@rudderjs/')) return null
  const dir = pkg.slice('@rudderjs/'.length)
  const url = `${baseUrl.replace(/\/+$/, '')}/packages/${dir}/CHANGELOG.md`
  try {
    const res = await fetch(url, { headers: { accept: 'text/plain' } })
    if (!res.ok) return null
    return await res.text()
  } catch {
    return null
  }
}

/**
 * Walk a changesets-format CHANGELOG.md, returning one entry per `## X.Y.Z`
 * header whose version is in `(from, to]`. Entries are returned in the order
 * they appear in the file (newest first, since changesets prepends).
 */
export function parseChangelog(
  md:   string,
  from: ParsedVersion,
  to:   ParsedVersion,
): ChangelogEntry[] {
  // Pre-collect header positions so we can slice each section without scanning
  // the file twice.
  const re = /^## (\d+\.\d+\.\d+)\s*$/gm
  const positions: Array<{ version: string; start: number; end: number }> = []
  let m: RegExpExecArray | null
  while ((m = re.exec(md)) !== null) {
    positions.push({ version: m[1]!, start: m.index, end: -1 })
  }
  for (let i = 0; i < positions.length; i++) {
    positions[i]!.end = i + 1 < positions.length ? positions[i + 1]!.start : md.length
  }

  const out: ChangelogEntry[] = []
  for (const pos of positions) {
    const parsed = parseVersion(pos.version)
    if (!parsed) continue
    if (compareVersions(parsed, from) <= 0) continue   // not above current
    if (compareVersions(parsed, to)    >  0) continue   // beyond target
    const body = md.slice(pos.start, pos.end)
    out.push({ version: pos.version, parsed, headline: extractHeadline(body) })
  }
  return out
}

/**
 * Pick a one-line summary from a CHANGELOG section's body. Skips the `##`
 * version header, the `### Patch/Minor Changes` subheaders, and the noisy
 * `- Updated dependencies [...]` lines. Strips the changesets cite-prefix
 * (`- abc1234: text` → `text`). Returns the first useful line, truncated.
 */
function extractHeadline(body: string): string {
  for (const raw of body.split('\n')) {
    const line = raw.trim()
    if (!line)                                  continue
    if (line.startsWith('## ') || line.startsWith('### ')) continue
    if (!line.startsWith('-'))                  continue
    // After the dash, drop a leading short-sha cite (`abc1234: `).
    const text = line.slice(1).trim().replace(/^[a-f0-9]{6,12}:\s*/, '').trim()
    if (!text)                                  continue
    if (text.toLowerCase().startsWith('updated dependencies')) continue
    // Take first line only (multi-line bullets are possible).
    const first = text.split('\n')[0]!.trim()
    return first.length > 90 ? `${first.slice(0, 87)}...` : first
  }
  return ''
}

// ── Peer-dep mismatch collection ──────────────────────────────

interface ConsumerPeer {
  range:   string
  section: 'dependencies' | 'devDependencies' | 'peerDependencies'
}

/**
 * Read every consumer-side dep into a flat map for peer-dep lookups. Used to
 * answer: "does the consumer's `vite` range satisfy `@rudderjs/vite@2.7`'s
 * `peerDependencies.vite` requirement?". A `peer` appearing in multiple
 * sections (rare but possible) resolves with `dependencies` ≻
 * `devDependencies` ≻ `peerDependencies` precedence — what npm picks at
 * install time.
 */
export function readConsumerPeers(pkg: Record<string, unknown>): Map<string, ConsumerPeer> {
  const out = new Map<string, ConsumerPeer>()
  for (const section of ['peerDependencies', 'devDependencies', 'dependencies'] as const) {
    const map = pkg[section]
    if (!map || typeof map !== 'object') continue
    for (const [name, range] of Object.entries(map as Record<string, string>)) {
      if (typeof range === 'string') out.set(name, { range, section })
    }
  }
  return out
}

interface PeerMismatch {
  peer:            string                                // e.g. "vite"
  causedBy:        string                                // e.g. "@rudderjs/vite@2.7.3"
  consumerRange:   string                                // what the consumer's package.json says
  consumerSection: ConsumerPeer['section'] | null
  requiredRange:   string                                // what the framework declares as peer
  reason:          string                                // from diffPeerRange
}

type FetchManifestFn = (pkg: string, version: string) => Promise<NpmManifest | null>

/**
 * Walk every bump in the plan, fetch its manifest at the target version, and
 * collect any peerDependencies that disagree with the consumer's declared
 * ranges. Same peer triggered by multiple framework packages dedups on the
 * first one found.
 *
 * Network: one extra registry call per bumped package, in parallel — but
 * the `fetcher` argument is pluggable so tests can drive it with synthetic
 * manifests.
 */
export async function collectPeerMismatches(
  rows:     PlanRow[],
  consumer: Map<string, ConsumerPeer>,
  fetcher:  FetchManifestFn,
): Promise<PeerMismatch[]> {
  const manifests = await Promise.all(
    rows.map(async (r) => ({ row: r, manifest: await fetcher(r.name, fmt(r.target)) })),
  )

  const out: PeerMismatch[] = []
  const seenPeer = new Set<string>()
  for (const { row, manifest } of manifests) {
    const peers = manifest?.peerDependencies
    if (!peers) continue
    for (const [peer, requiredRange] of Object.entries(peers)) {
      // Skip @rudderjs/* peer cross-refs — those are handled by the main
      // bump plan, not the peer-mismatch warning.
      if (peer.startsWith('@rudderjs/')) continue
      if (seenPeer.has(peer)) continue
      const c = consumer.get(peer)
      if (!c) continue              // consumer doesn't declare this peer — install will surface it
      const reason = diffPeerRange(c.range, requiredRange)
      if (!reason) continue          // satisfied — nothing to warn about
      seenPeer.add(peer)
      out.push({
        peer,
        causedBy:        `${row.name}@${fmt(row.target)}`,
        consumerRange:   c.range,
        consumerSection: c.section,
        requiredRange,
        reason,
      })
    }
  }
  return out
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

/**
 * Render the upgrade plan: one row per package, each followed by an indented
 * block of `version  headline` lines from the package's CHANGELOG (one per
 * version in the bump range). Rows whose CHANGELOG fetch returned nothing
 * render as a plain row — graceful degradation.
 */
function renderPlanWithChangelogs(rows: PlanRow[], changelogs: Map<string, ChangelogEntry[]>): void {
  const nameWidth = Math.max(...rows.map(r => r.name.length))
  for (const row of rows) {
    const color = colorBump(row.current, row.latest)
    const left  = row.name.padEnd(nameWidth)
    const arrow = dim('→')
    console.log(`  ${left}  ${dim(fmt(row.current))} ${arrow} ${color(fmt(row.target))}  ${dim('(' + row.section + ')')}`)
    const entries = changelogs.get(row.name) ?? []
    if (entries.length === 0) continue
    const verWidth = Math.max(...entries.map(e => e.version.length))
    for (const e of entries) {
      const ver = e.version.padStart(verWidth)
      const head = e.headline || dim('(no summary line)')
      console.log(`      ${dim(ver)}  ${head}`)
    }
  }
}

type FetchChangelogFn = (pkg: string) => Promise<string | null>

/**
 * Walk the plan, fetch + parse each package's CHANGELOG in parallel, return a
 * map of `pkgName → entries-in-range`. Pluggable fetcher for testability.
 */
export async function collectChangelogs(
  rows:    PlanRow[],
  fetcher: FetchChangelogFn,
): Promise<Map<string, ChangelogEntry[]>> {
  const out = new Map<string, ChangelogEntry[]>()
  await Promise.all(rows.map(async (row) => {
    const md = await fetcher(row.name)
    if (!md) return
    const entries = parseChangelog(md, row.current, row.target)
    if (entries.length > 0) out.set(row.name, entries)
  }))
  return out
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
  check?:         boolean
  dryRun?:        boolean
  latest?:        boolean
  minor?:         boolean
  patch?:         boolean
  registry?:      string
  changelog?:     boolean
  changelogBase?: string
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
    .option('--registry <url>',  'override the npm registry URL', 'https://registry.npmjs.org')
    .option('--no-changelog',    'skip fetching CHANGELOG snippets (faster, less output)')
    .option('--changelog-base <url>', 'override the GitHub raw base URL used to fetch CHANGELOGs', 'https://raw.githubusercontent.com/rudderjs/rudder/main')
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

      // ── CHANGELOG snippets ────────────────────────────────
      //
      // For each bump, fetch the package's CHANGELOG.md from GitHub raw,
      // parse out every `## X.Y.Z` section in the (current, target] window,
      // and pluck a one-line headline per version. Shown inline under each
      // plan row so the user can see WHAT changed before applying.
      //
      // `--no-changelog` skips the fetch entirely for users who want speed
      // or quieter output. CHANGELOG failures degrade gracefully — a row
      // with no entries simply renders without the indented detail block.
      const changelogs = opts.changelog === false
        ? new Map<string, ChangelogEntry[]>()
        : await collectChangelogs(rows, (n) => fetchChangelog(n, opts.changelogBase ?? 'https://raw.githubusercontent.com/rudderjs/rudder/main'))

      renderPlanWithChangelogs(rows, changelogs)

      // Legend — only show when there are colored bumps to explain.
      const hasMajor = rows.some(r => r.target.major > r.current.major)
      if (hasMajor) {
        console.log(`\n  ${red('●')} major  ${cyan('●')} minor  ${green('●')} patch`)
        console.log(dim('  Major bumps may contain breaking changes — review CHANGELOGs before applying.'))
      }

      // ── Peer-dep mismatch check ─────────────────────────────
      //
      // Closes the gap that bit rudderjs.com on 2026-05-29: `pnpm update --latest
      // "@rudderjs/*"` happily bumped the framework packages, but didn't notice
      // that `@rudderjs/vite@2.7.x` requires `vite ^8` while the consumer's
      // package.json still declared `"vite": "^7.1.0"`. Apps stayed on the old
      // peer, got a (silent or warned-but-tolerated) peer mismatch, and missed
      // the framework upgrade.
      //
      // Strategy: for every package we're bumping, fetch its manifest at the
      // TARGET version and look up its peerDependencies. Each peer is
      // intersected against the consumer's declared range in package.json. No
      // overlap = mismatch. Mismatches are shown loudly and (in --check mode)
      // promote the exit code.
      const consumerPeers = readConsumerPeers(pkg)
      const peerMismatches = await collectPeerMismatches(
        rows,
        consumerPeers,
        (n, v) => fetchManifest(n, v, registry),
      )
      if (peerMismatches.length) {
        console.log(`\n  ${yel(bold('⚠ Peer-dependency mismatches:'))}`)
        for (const m of peerMismatches) {
          console.log(`    ${bold(m.peer)}  ${dim('— required by')} ${m.causedBy}`)
          console.log(`      ${dim('your package.json:')} ${m.consumerSection ? `${m.consumerSection}.` : ''}${m.peer} = ${red(`"${m.consumerRange}"`)}`)
          console.log(`      ${dim('framework needs:    ')} ${green(`"${m.requiredRange}"`)}`)
          console.log(`      ${dim('reason:             ')} ${m.reason}`)
        }
        console.log(dim('\n  Update these peer ranges in your package.json (then re-run upgrade).'))
      }

      if (opts.check) {
        const peerSuffix = peerMismatches.length ? `, ${peerMismatches.length} peer mismatch(es)` : ''
        console.log(dim(`\n  --check mode: ${rows.length} update(s) available${peerSuffix} (exit 1).`))
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
  acceptedMajors,
  diffPeerRange,
  readConsumerPeers,
  extractHeadline,
}
