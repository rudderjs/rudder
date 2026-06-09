import fs from 'node:fs'
import path from 'node:path'
import { registerDoctorCheck, type DoctorResult } from '@rudderjs/console'

// ─── deps:version-skew ───────────────────────────────────────
//
// Cross-package version skew between installed @rudderjs/* siblings fails at
// runtime as a cryptic ESM link error naming no package and no version:
//
//   SyntaxError: The requested module '@rudderjs/contracts' does not provide
//   an export named 'REQUEST_CONTEXT'
//
// The declared ranges are correct on the published tarballs — the skew gets
// in because real apps pin @rudderjs/* with exact `pnpm.overrides` (the
// documented single-copy practice), and pnpm silently lets an override
// violate a dependency's declared floor. This check walks every installed
// @rudderjs/* package, reads its declared dependencies/peerDependencies on
// sibling @rudderjs/* packages, and verifies each against the version that
// actually resolves from that package's location. Catches every future
// instance of the class without per-symbol bookkeeping.
// Plan: docs/plans/2026-06-09-version-skew-diagnostics.md.

interface PkgManifest {
  name?:                 string
  version?:              string
  dependencies?:         Record<string, string>
  peerDependencies?:     Record<string, string>
  peerDependenciesMeta?: Record<string, { optional?: boolean }>
}

interface Triple { major: number; minor: number; patch: number }

// ── Minimal semver (just enough for @rudderjs/* sibling ranges) ──
//
// Real-world shapes in our manifests: `^1.16.0`, `>=2.0.0`, exact pins, and
// `||` alternatives. Anything unparseable fails OPEN — doctor must never
// false-fire on a range it can't read.

function parseTriple(v: string): Triple | null {
  const m = /^[v\s]*(\d+)\.(\d+)\.(\d+)/.exec(v.trim().replace(/^[\^~>=<]+/, ''))
  if (!m) return null
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) }
}

function compareTriples(a: Triple, b: Triple): number {
  if (a.major !== b.major) return a.major - b.major
  if (a.minor !== b.minor) return a.minor - b.minor
  return a.patch - b.patch
}

/** One comparator (`^1.2.3`, `>=2.0.0`, `1.2.3`, …) against a version. */
function satisfiesComparator(v: Triple, comparator: string): boolean {
  const floor = parseTriple(comparator)
  if (!floor) return true // unreadable — fail open
  const cmp = compareTriples(v, floor)
  if (comparator.startsWith('^')) {
    // Caret: same left-most non-zero component, at or above the floor.
    if (floor.major > 0) return v.major === floor.major && cmp >= 0
    if (floor.minor > 0) return v.major === 0 && v.minor === floor.minor && cmp >= 0
    return cmp === 0
  }
  if (comparator.startsWith('~')) return v.major === floor.major && v.minor === floor.minor && cmp >= 0
  if (comparator.startsWith('>=')) return cmp >= 0
  if (comparator.startsWith('>'))  return cmp > 0
  if (comparator.startsWith('<=')) return cmp <= 0
  if (comparator.startsWith('<'))  return cmp < 0
  return cmp === 0 // exact pin
}

/** `||` alternatives of space-joined comparators (`>=1.2.0 <2 || ^3.0.0`). */
function satisfiesRange(version: string, range: string): boolean {
  const v = parseTriple(version)
  if (!v) return true
  const r = range.trim()
  if (r === '' || r === '*' || r === 'latest' || r === 'next' || r.startsWith('workspace:')) return true
  return r.split('||').some((alt) => {
    const comparators = alt.trim().split(/\s+/).filter(Boolean)
    if (comparators.length === 0) return true
    return comparators.every((c) => satisfiesComparator(v, c))
  })
}

function readManifest(file: string): PkgManifest | null {
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')) as PkgManifest } catch { return null }
}

/**
 * The version of `sibling` that `fromRealDir`'s package actually loads,
 * following Node's resolution shape across layouts:
 *
 *   1. its own nested `node_modules/<sibling>` (npm conflict-nesting),
 *   2. the adjacent scope dir (pnpm virtual store puts a package's deps as
 *      siblings: `.pnpm/<pkg>@<v>/node_modules/@rudderjs/<sibling>`; for a
 *      hoisted top-level package this same step IS the top level),
 *   3. the app's top-level `node_modules` (hoisted npm/yarn).
 */
function resolveSiblingVersion(fromRealDir: string, sibling: string): string | null {
  const candidates = [
    path.join(fromRealDir, 'node_modules', sibling, 'package.json'),
    path.resolve(fromRealDir, '..', '..', sibling, 'package.json'),
    path.join(process.cwd(), 'node_modules', sibling, 'package.json'),
  ]
  for (const candidate of candidates) {
    const manifest = readManifest(candidate)
    if (manifest?.version) return manifest.version
  }
  return null
}

registerDoctorCheck({
  id:       'deps:version-skew',
  category: 'deps',
  title:    '@rudderjs/* sibling versions in range',
  run(): DoctorResult {
    const scopeDir = path.join(process.cwd(), 'node_modules', '@rudderjs')
    let entries: string[]
    try {
      entries = fs.readdirSync(scopeDir)
    } catch {
      return { status: 'ok', message: 'no @rudderjs packages installed' }
    }

    const violations: string[] = []
    let rangesChecked = 0

    for (const entry of entries) {
      let realDir: string
      try { realDir = fs.realpathSync(path.join(scopeDir, entry)) } catch { continue }
      const manifest = readManifest(path.join(realDir, 'package.json'))
      if (!manifest?.name || !manifest.version) continue

      const optional = manifest.peerDependenciesMeta ?? {}
      const requirements = { ...manifest.dependencies, ...manifest.peerDependencies }
      for (const [sibling, range] of Object.entries(requirements)) {
        if (!sibling.startsWith('@rudderjs/')) continue
        if (range.startsWith('workspace:')) continue // monorepo dev link — not an installed range
        const installed = resolveSiblingVersion(realDir, sibling)
        if (installed === null) {
          // Missing entirely: optional peers are legitimately absent; hard
          // deps are deps:declared-installed's finding, not a skew.
          void optional
          continue
        }
        rangesChecked++
        if (!satisfiesRange(installed, range)) {
          violations.push(`${manifest.name}@${manifest.version} requires ${sibling} ${range} — found ${installed}`)
        }
      }
    }

    if (violations.length > 0) {
      return {
        status:  'error',
        message: violations.length === 1
          ? violations[0]!
          : `${violations.length} sibling ranges violated (first: ${violations[0]})`,
        fix:     'Bump the pinned version (pnpm.overrides?) so siblings satisfy their declared ranges, then reinstall',
        detail:  violations.join('\n'),
      }
    }
    return { status: 'ok', message: `${rangesChecked} sibling range${rangesChecked === 1 ? '' : 's'} satisfied` }
  },
})
