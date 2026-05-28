import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { _internal, collectPeerMismatches } from './upgrade.js'

const {
  parseVersion,
  compareVersions,
  buildTarget,
  collectDeps,
  detectPackageManager,
  shapeOfRange,
  acceptedMajors,
  diffPeerRange,
  readConsumerPeers,
} = _internal

// ── shapeOfRange ──────────────────────────────────────────────

describe('upgrade — shapeOfRange', () => {
  it('classifies caret / tilde / exact as pinned', () => {
    assert.equal(shapeOfRange('^1.2.3'),     'pinned')
    assert.equal(shapeOfRange('~1.2.3'),     'pinned')
    assert.equal(shapeOfRange('1.2.3'),      'pinned')
    assert.equal(shapeOfRange('>=1.0.0'),    'pinned')
  })

  it('classifies workspace refs as workspace (any pnpm syntax)', () => {
    assert.equal(shapeOfRange('workspace:*'),       'workspace')
    assert.equal(shapeOfRange('workspace:^'),       'workspace')
    assert.equal(shapeOfRange('workspace:^1.0.0'),  'workspace')
  })

  it('classifies floating dist-tag refs (latest / next / *) as floating', () => {
    assert.equal(shapeOfRange('latest'),  'floating')
    assert.equal(shapeOfRange('*'),       'floating')
    assert.equal(shapeOfRange('next'),    'floating')
    assert.equal(shapeOfRange(''),        'floating')
  })

  it('trims whitespace before classifying', () => {
    assert.equal(shapeOfRange('  latest  '), 'floating')
    assert.equal(shapeOfRange(' ^1.2.3 '),   'pinned')
  })
})

// ── parseVersion ──────────────────────────────────────────────

describe('upgrade — parseVersion', () => {
  it('strips a leading caret', () => {
    assert.deepEqual(parseVersion('^1.2.3'), { major: 1, minor: 2, patch: 3 })
  })

  it('strips a leading tilde', () => {
    assert.deepEqual(parseVersion('~0.4.5'), { major: 0, minor: 4, patch: 5 })
  })

  it('accepts a bare triple', () => {
    assert.deepEqual(parseVersion('10.20.30'), { major: 10, minor: 20, patch: 30 })
  })

  it('truncates pre-release / build metadata', () => {
    assert.deepEqual(parseVersion('1.2.3-beta.4'),       { major: 1, minor: 2, patch: 3 })
    assert.deepEqual(parseVersion('^1.2.3+sha.abc'),      { major: 1, minor: 2, patch: 3 })
  })

  it('returns null for unparseable strings', () => {
    assert.equal(parseVersion('workspace:*'), null)
    assert.equal(parseVersion(''),            null)
    assert.equal(parseVersion('latest'),      null)
  })
})

// ── compareVersions ──────────────────────────────────────────

describe('upgrade — compareVersions', () => {
  it('sorts by major first', () => {
    assert.ok(compareVersions({ major: 2, minor: 0, patch: 0 }, { major: 1, minor: 99, patch: 99 }) > 0)
  })

  it('then by minor', () => {
    assert.ok(compareVersions({ major: 1, minor: 5, patch: 0 }, { major: 1, minor: 2, patch: 99 }) > 0)
  })

  it('then by patch', () => {
    assert.ok(compareVersions({ major: 1, minor: 2, patch: 4 }, { major: 1, minor: 2, patch: 3 }) > 0)
  })

  it('returns 0 for equal versions', () => {
    assert.equal(compareVersions({ major: 1, minor: 2, patch: 3 }, { major: 1, minor: 2, patch: 3 }), 0)
  })
})

// ── buildTarget ──────────────────────────────────────────────

describe('upgrade — buildTarget', () => {
  const cur = { major: 1, minor: 2, patch: 3 }

  it('--latest returns the latest regardless of bounds', () => {
    const latest = { major: 9, minor: 9, patch: 9 }
    assert.deepEqual(buildTarget(cur, latest, 'latest'), latest)
  })

  it('--minor honors a within-major bump', () => {
    const latest = { major: 1, minor: 5, patch: 0 }
    assert.deepEqual(buildTarget(cur, latest, 'minor'), latest)
  })

  it('--minor caps an across-major bump back to current', () => {
    const latest = { major: 2, minor: 0, patch: 0 }
    assert.deepEqual(buildTarget(cur, latest, 'minor'), cur)
  })

  it('--patch honors a within-minor bump', () => {
    const latest = { major: 1, minor: 2, patch: 9 }
    assert.deepEqual(buildTarget(cur, latest, 'patch'), latest)
  })

  it('--patch caps an across-minor bump back to current', () => {
    const latest = { major: 1, minor: 3, patch: 0 }
    assert.deepEqual(buildTarget(cur, latest, 'patch'), cur)
  })
})

// ── collectDeps ──────────────────────────────────────────────

describe('upgrade — collectDeps', () => {
  it('finds every @rudderjs/* dep across all three sections', () => {
    const pkg = {
      dependencies:    { '@rudderjs/core': '^1.0.0',  'react': '^19.0.0' },
      devDependencies: { '@rudderjs/cli':  '^4.0.0',  'typescript': '^5.0.0' },
      peerDependencies:{ '@rudderjs/contracts': '^1.0.0' },
    }
    const deps = collectDeps(pkg)
    assert.equal(deps.length, 3)
    assert.deepEqual(deps.find(d => d.name === '@rudderjs/core'),       { name: '@rudderjs/core',      range: '^1.0.0', section: 'dependencies' })
    assert.deepEqual(deps.find(d => d.name === '@rudderjs/cli'),        { name: '@rudderjs/cli',       range: '^4.0.0', section: 'devDependencies' })
    assert.deepEqual(deps.find(d => d.name === '@rudderjs/contracts'),  { name: '@rudderjs/contracts', range: '^1.0.0', section: 'peerDependencies' })
  })

  it('returns an empty list when no @rudderjs/* deps are present', () => {
    assert.deepEqual(collectDeps({ dependencies: { react: '^19.0.0' } }), [])
  })

  it('tolerates a missing section', () => {
    assert.deepEqual(
      collectDeps({ dependencies: { '@rudderjs/core': '^1.0.0' } }).map(d => d.name),
      ['@rudderjs/core'],
    )
  })

  it('ignores non-rudder scoped packages', () => {
    const pkg = {
      dependencies: {
        '@rudderjs/core': '^1.0.0',
        '@some-other/pkg': '^1.0.0',
        '@another/rudderjs-stuff': '^1.0.0',
      },
    }
    assert.deepEqual(collectDeps(pkg).map(d => d.name), ['@rudderjs/core'])
  })
})

// ── detectPackageManager ────────────────────────────────────

describe('upgrade — detectPackageManager', () => {
  let tmp: string

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'rudder-upgrade-'))
  })
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true })
  })

  it('detects pnpm from pnpm-lock.yaml', async () => {
    await fs.writeFile(path.join(tmp, 'pnpm-lock.yaml'), '')
    assert.equal(detectPackageManager(tmp), 'pnpm')
  })

  it('detects yarn from yarn.lock', async () => {
    await fs.writeFile(path.join(tmp, 'yarn.lock'), '')
    assert.equal(detectPackageManager(tmp), 'yarn')
  })

  it('detects npm from package-lock.json', async () => {
    await fs.writeFile(path.join(tmp, 'package-lock.json'), '')
    assert.equal(detectPackageManager(tmp), 'npm')
  })

  it('detects bun from bun.lockb', async () => {
    await fs.writeFile(path.join(tmp, 'bun.lockb'), '')
    assert.equal(detectPackageManager(tmp), 'bun')
  })

  it('lockfile precedence — pnpm beats yarn beats npm', async () => {
    await fs.writeFile(path.join(tmp, 'pnpm-lock.yaml'),    '')
    await fs.writeFile(path.join(tmp, 'yarn.lock'),         '')
    await fs.writeFile(path.join(tmp, 'package-lock.json'), '')
    assert.equal(detectPackageManager(tmp), 'pnpm')
  })

  it('defaults to pnpm when no lockfile and no UA', () => {
    // env var may be set in the test runner; clear it for this case
    const saved = process.env['npm_config_user_agent']
    delete process.env['npm_config_user_agent']
    try {
      assert.equal(detectPackageManager(tmp), 'pnpm')
    } finally {
      if (saved !== undefined) process.env['npm_config_user_agent'] = saved
    }
  })
})

// ── acceptedMajors ────────────────────────────────────────────

describe('upgrade — acceptedMajors', () => {
  it('caret/tilde/exact: one major', () => {
    assert.deepEqual([...(acceptedMajors('^8.0.0') as Set<number>)],  [8])
    assert.deepEqual([...(acceptedMajors('~8.0.0') as Set<number>)],  [8])
    assert.deepEqual([...(acceptedMajors('8.0.0')  as Set<number>)],  [8])
  })

  it('OR-chained alternatives', () => {
    const set = acceptedMajors('^4.2.0 || ^5.0.0 || ^6.0.0 || ^7.0.0 || ^8.0.0') as Set<number>
    assert.deepEqual([...set].sort((a, b) => a - b), [4, 5, 6, 7, 8])
  })

  it('unbounded lower-bound comparators are treated as any', () => {
    assert.equal(acceptedMajors('>=5.0.0'), 'any')
    assert.equal(acceptedMajors('>5.0.0'),  'any')
  })

  it('wildcards / floating refs are treated as any', () => {
    assert.equal(acceptedMajors('*'),       'any')
    assert.equal(acceptedMajors('latest'),  'any')
    assert.equal(acceptedMajors('next'),    'any')
    assert.equal(acceptedMajors(''),        'any')
  })

  it('fails open on unparseable input', () => {
    assert.equal(acceptedMajors('workspace:*'),    'any')
    assert.equal(acceptedMajors('garbage'),        'any')
  })
})

// ── diffPeerRange ─────────────────────────────────────────────

describe('upgrade — diffPeerRange', () => {
  it('returns null when the consumer satisfies the required range', () => {
    assert.equal(diffPeerRange('^8.0.0', '^8.0.0'),  null)
    assert.equal(diffPeerRange('^7.1.0', '^4.2.0 || ^5.0.0 || ^6.0.0 || ^7.0.0 || ^8.0.0'), null)
    assert.equal(diffPeerRange('*',      '^8.0.0'),  null)
    assert.equal(diffPeerRange('^7.1.0', '>=4.0.0'), null)
  })

  it('returns a reason when the consumer is behind the framework requirement', () => {
    const reason = diffPeerRange('^7.1.0', '^8.0.0')
    assert.match(reason!, /consumer accepts major 7/)
    assert.match(reason!, /framework needs major 8/)
  })

  it('returns a reason when the consumer is ahead of the framework requirement', () => {
    const reason = diffPeerRange('^9.0.0', '^8.0.0')
    assert.match(reason!, /consumer accepts major 9.*framework needs major 8/)
  })
})

// ── readConsumerPeers ─────────────────────────────────────────

describe('upgrade — readConsumerPeers', () => {
  it('reads from every section with the documented precedence', () => {
    const pkg = {
      dependencies:     { vite: '^8.0.0' },
      devDependencies:  { vite: '^7.0.0', '@vitejs/plugin-react': '^5.0.0' },
      peerDependencies: { vite: '^6.0.0', react: '^19.0.0' },
    }
    const m = readConsumerPeers(pkg)
    // dependencies wins over devDependencies wins over peerDependencies
    assert.deepEqual(m.get('vite'),                   { range: '^8.0.0', section: 'dependencies' })
    assert.deepEqual(m.get('@vitejs/plugin-react'),   { range: '^5.0.0', section: 'devDependencies' })
    assert.deepEqual(m.get('react'),                  { range: '^19.0.0', section: 'peerDependencies' })
  })

  it('returns an empty map when no sections are present', () => {
    assert.equal(readConsumerPeers({}).size, 0)
  })
})

// ── collectPeerMismatches (integration) ───────────────────────

describe('upgrade — collectPeerMismatches', () => {
  // Mock fetcher — returns manifests from a fixed lookup table. Lets us drive
  // collectPeerMismatches end-to-end without hitting the npm registry.
  function mkFetcher(table: Record<string, { peerDependencies?: Record<string, string> }>) {
    return async (pkg: string, version: string) => {
      const m = table[`${pkg}@${version}`]
      if (!m) return null
      return { version, ...m }
    }
  }

  it('flags a strict peer mismatch (the rudderjs.com-shaped case)', async () => {
    // Hypothetical: @rudderjs/vite@3.0.0 tightens vite from >=5 to strict ^8.
    // Consumer still on vite ^7.1.0 — the bump silently breaks the peer.
    const rows = [{
      name:     '@rudderjs/vite',
      section:  'devDependencies' as const,
      current:  { major: 2, minor: 4, patch: 0 },
      latest:   { major: 3, minor: 0, patch: 0 },
      target:   { major: 3, minor: 0, patch: 0 },
      newRange: '^3.0.0',
    }]
    const consumer = new Map([
      ['vite', { range: '^7.1.0', section: 'devDependencies' as const }],
    ])
    const fetcher = mkFetcher({
      '@rudderjs/vite@3.0.0': { peerDependencies: { vite: '^8.0.0' } },
    })
    const mismatches = await collectPeerMismatches(rows, consumer, fetcher)
    assert.equal(mismatches.length, 1)
    assert.equal(mismatches[0]!.peer,           'vite')
    assert.equal(mismatches[0]!.causedBy,       '@rudderjs/vite@3.0.0')
    assert.equal(mismatches[0]!.consumerRange,  '^7.1.0')
    assert.equal(mismatches[0]!.requiredRange,  '^8.0.0')
    assert.match(mismatches[0]!.reason, /consumer accepts major 7.*framework needs major 8/)
  })

  it('does NOT flag when the consumer satisfies the required range', async () => {
    const rows = [{
      name:     '@rudderjs/vite',
      section:  'devDependencies' as const,
      current:  { major: 2, minor: 4, patch: 0 },
      latest:   { major: 2, minor: 7, patch: 3 },
      target:   { major: 2, minor: 7, patch: 3 },
      newRange: '^2.7.3',
    }]
    const consumer = new Map([
      ['vite', { range: '^7.1.0', section: 'devDependencies' as const }],
    ])
    const fetcher = mkFetcher({
      // The real @rudderjs/vite@2.7.3 shape: permissive `>=5.0.0` accepts vite 7.
      '@rudderjs/vite@2.7.3': { peerDependencies: { vite: '>=5.0.0' } },
    })
    assert.deepEqual(await collectPeerMismatches(rows, consumer, fetcher), [])
  })

  it('does NOT flag when the consumer does not even declare the peer', async () => {
    // Real-world case: an app that doesn't use vite at all (an api-only app)
    // shouldn't get a peer warning when bumping @rudderjs/vite.
    const rows = [{
      name:     '@rudderjs/vite',
      section:  'devDependencies' as const,
      current:  { major: 2, minor: 4, patch: 0 },
      latest:   { major: 3, minor: 0, patch: 0 },
      target:   { major: 3, minor: 0, patch: 0 },
      newRange: '^3.0.0',
    }]
    const consumer = new Map<string, { range: string; section: 'dependencies' | 'devDependencies' | 'peerDependencies' }>()
    const fetcher = mkFetcher({
      '@rudderjs/vite@3.0.0': { peerDependencies: { vite: '^8.0.0' } },
    })
    assert.deepEqual(await collectPeerMismatches(rows, consumer, fetcher), [])
  })

  it('ignores @rudderjs/* peer cross-refs (handled by the main bump plan)', async () => {
    const rows = [{
      name:     '@rudderjs/vite',
      section:  'devDependencies' as const,
      current:  { major: 2, minor: 4, patch: 0 },
      latest:   { major: 2, minor: 7, patch: 3 },
      target:   { major: 2, minor: 7, patch: 3 },
      newRange: '^2.7.3',
    }]
    const consumer = new Map([
      ['@rudderjs/core', { range: '^1.0.0', section: 'dependencies' as const }],
    ])
    const fetcher = mkFetcher({
      '@rudderjs/vite@2.7.3': { peerDependencies: { '@rudderjs/core': '^2.0.0' } },
    })
    assert.deepEqual(await collectPeerMismatches(rows, consumer, fetcher), [])
  })

  it('dedups when the same peer is required by multiple bumps', async () => {
    const rows = [
      { name: '@rudderjs/a', section: 'dependencies' as const, current: { major: 1, minor: 0, patch: 0 }, latest: { major: 2, minor: 0, patch: 0 }, target: { major: 2, minor: 0, patch: 0 }, newRange: '^2.0.0' },
      { name: '@rudderjs/b', section: 'dependencies' as const, current: { major: 1, minor: 0, patch: 0 }, latest: { major: 2, minor: 0, patch: 0 }, target: { major: 2, minor: 0, patch: 0 }, newRange: '^2.0.0' },
    ]
    const consumer = new Map([
      ['vite', { range: '^7.0.0', section: 'devDependencies' as const }],
    ])
    const fetcher = mkFetcher({
      '@rudderjs/a@2.0.0': { peerDependencies: { vite: '^8.0.0' } },
      '@rudderjs/b@2.0.0': { peerDependencies: { vite: '^8.0.0' } },
    })
    const mismatches = await collectPeerMismatches(rows, consumer, fetcher)
    // One mismatch — first match wins; attributed to the first bump that triggered it.
    assert.equal(mismatches.length, 1)
    assert.equal(mismatches[0]!.causedBy, '@rudderjs/a@2.0.0')
  })

  it('tolerates a failed manifest fetch (returns null) — skip silently', async () => {
    const rows = [{
      name:     '@rudderjs/vite',
      section:  'devDependencies' as const,
      current:  { major: 2, minor: 4, patch: 0 },
      latest:   { major: 3, minor: 0, patch: 0 },
      target:   { major: 3, minor: 0, patch: 0 },
      newRange: '^3.0.0',
    }]
    const consumer = new Map([
      ['vite', { range: '^7.0.0', section: 'devDependencies' as const }],
    ])
    const fetcher = async () => null   // always-fail fetcher
    assert.deepEqual(await collectPeerMismatches(rows, consumer, fetcher), [])
  })
})
