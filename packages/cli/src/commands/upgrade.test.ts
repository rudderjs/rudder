import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { _internal } from './upgrade.js'

const { parseVersion, compareVersions, buildTarget, collectDeps, detectPackageManager } = _internal

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
