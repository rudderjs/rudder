import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { _internal } from './about.js'

const {
  collectSnapshot,
  renderText,
  detectPackageManager,
  listInstalledRudderPackages,
  readInstalledPackageVersion,
} = _internal

// ── detectPackageManager ──────────────────────────────────────

describe('about — detectPackageManager', () => {
  let tmp: string

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'rudder-about-'))
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

  it('returns "unknown" when nothing matches', () => {
    // ensure no UA influence
    const saved = process.env['npm_config_user_agent']
    delete process.env['npm_config_user_agent']
    try {
      assert.equal(detectPackageManager(tmp), 'unknown')
    } finally {
      if (saved !== undefined) process.env['npm_config_user_agent'] = saved
    }
  })
})

// ── listInstalledRudderPackages ───────────────────────────────

describe('about — listInstalledRudderPackages', () => {
  let tmp: string

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'rudder-about-pkgs-'))
    await fs.mkdir(path.join(tmp, 'node_modules', '@rudderjs'), { recursive: true })
  })
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true })
  })

  it('returns each installed @rudderjs/* package sorted by name', async () => {
    await fs.mkdir(path.join(tmp, 'node_modules', '@rudderjs', 'cli'),  { recursive: true })
    await fs.mkdir(path.join(tmp, 'node_modules', '@rudderjs', 'core'), { recursive: true })
    await fs.writeFile(path.join(tmp, 'node_modules', '@rudderjs', 'cli',  'package.json'), '{"name":"@rudderjs/cli","version":"4.7.0"}')
    await fs.writeFile(path.join(tmp, 'node_modules', '@rudderjs', 'core', 'package.json'), '{"name":"@rudderjs/core","version":"1.5.0"}')

    assert.deepEqual(listInstalledRudderPackages(tmp), [
      { name: '@rudderjs/cli',  version: '4.7.0' },
      { name: '@rudderjs/core', version: '1.5.0' },
    ])
  })

  it('returns [] when node_modules/@rudderjs is absent', async () => {
    const blank = await fs.mkdtemp(path.join(os.tmpdir(), 'rudder-about-blank-'))
    try {
      assert.deepEqual(listInstalledRudderPackages(blank), [])
    } finally {
      await fs.rm(blank, { recursive: true, force: true })
    }
  })

  it('ignores dotted entries (e.g. .pnpm/ stash)', async () => {
    await fs.mkdir(path.join(tmp, 'node_modules', '@rudderjs', '.pnpm'), { recursive: true })
    await fs.mkdir(path.join(tmp, 'node_modules', '@rudderjs', 'cli'),   { recursive: true })
    await fs.writeFile(path.join(tmp, 'node_modules', '@rudderjs', 'cli', 'package.json'), '{"name":"@rudderjs/cli","version":"4.7.0"}')
    assert.deepEqual(listInstalledRudderPackages(tmp), [
      { name: '@rudderjs/cli', version: '4.7.0' },
    ])
  })

  it('skips entries with unreadable package.json without aborting', async () => {
    await fs.mkdir(path.join(tmp, 'node_modules', '@rudderjs', 'broken'), { recursive: true })
    await fs.mkdir(path.join(tmp, 'node_modules', '@rudderjs', 'cli'),    { recursive: true })
    await fs.writeFile(path.join(tmp, 'node_modules', '@rudderjs', 'broken', 'package.json'), '{not json}')
    await fs.writeFile(path.join(tmp, 'node_modules', '@rudderjs', 'cli',    'package.json'), '{"name":"@rudderjs/cli","version":"4.7.0"}')
    assert.deepEqual(listInstalledRudderPackages(tmp), [
      { name: '@rudderjs/cli', version: '4.7.0' },
    ])
  })

  it('skips entries missing the name or version field', async () => {
    await fs.mkdir(path.join(tmp, 'node_modules', '@rudderjs', 'a'), { recursive: true })
    await fs.writeFile(path.join(tmp, 'node_modules', '@rudderjs', 'a', 'package.json'), '{"version":"1.0.0"}')   // no name
    assert.deepEqual(listInstalledRudderPackages(tmp), [])
  })
})

// ── readInstalledPackageVersion ───────────────────────────────

describe('about — readInstalledPackageVersion', () => {
  let tmp: string

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'rudder-about-rv-'))
    await fs.writeFile(path.join(tmp, 'package.json'), '{"name":"test"}')
    await fs.mkdir(path.join(tmp, 'node_modules', '@rudderjs', 'cli'), { recursive: true })
    await fs.writeFile(path.join(tmp, 'node_modules', '@rudderjs', 'cli', 'package.json'), '{"name":"@rudderjs/cli","version":"4.7.0"}')
  })
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true })
  })

  it('resolves a known installed package version', () => {
    assert.equal(readInstalledPackageVersion(tmp, '@rudderjs/cli'), '4.7.0')
  })

  it('returns null when the package is not installed', () => {
    assert.equal(readInstalledPackageVersion(tmp, '@rudderjs/orm-prisma'), null)
  })
})

// ── collectSnapshot ───────────────────────────────────────────

describe('about — collectSnapshot', () => {
  let tmp: string

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'rudder-about-snap-'))
    await fs.writeFile(path.join(tmp, 'package.json'),    '{"name":"snap-test"}')
    await fs.writeFile(path.join(tmp, 'pnpm-lock.yaml'),  '')
    await fs.mkdir(path.join(tmp, 'node_modules', '@rudderjs', 'core'), { recursive: true })
    await fs.writeFile(path.join(tmp, 'node_modules', '@rudderjs', 'core', 'package.json'), '{"name":"@rudderjs/core","version":"1.5.0"}')
  })
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true })
  })

  it('fills application + runtime + rudder sections from the consumer cwd', () => {
    const snap = collectSnapshot(tmp)
    assert.equal(snap.application.name,    'snap-test')
    assert.equal(snap.runtime.pm,          'pnpm')
    assert.equal(snap.runtime.node,        process.version)
    assert.equal(snap.rudder.coreVersion,  '1.5.0')
    assert.equal(snap.rudder.cliVersion,   null)   // not installed in this fixture
    assert.equal(snap.packages.length,     1)
    assert.deepEqual(snap.packages[0],     { name: '@rudderjs/core', version: '1.5.0' })
  })

  it('uses "<unnamed>" when package.json has no name', async () => {
    await fs.writeFile(path.join(tmp, 'package.json'), '{}')
    assert.equal(collectSnapshot(tmp).application.name, '<unnamed>')
  })
})

// ── renderText ────────────────────────────────────────────────

describe('about — renderText', () => {
  function strip(s: string): string {
    // eslint-disable-next-line no-control-regex
    return s.replace(/\x1b\[\d+m/g, '')
  }

  it('renders every section with the expected labels', () => {
    const lines = renderText({
      application: { name: 'demo', env: 'local', debug: 'true', url: 'http://localhost' },
      runtime:     { node: 'v22.0.0', os: 'Linux 6.0', arch: 'x64', pm: 'pnpm' },
      rudder:      { coreVersion: '1.5.0', cliVersion: '4.7.0' },
      packages:    [
        { name: '@rudderjs/cli',  version: '4.7.0' },
        { name: '@rudderjs/core', version: '1.5.0' },
      ],
    }).map(strip)

    assert.ok(lines.some(l => l.includes('App Name')   && l.includes('demo')))
    assert.ok(lines.some(l => l.includes('Framework')  && l.includes('1.5.0')))
    assert.ok(lines.some(l => l.includes('CLI')        && l.includes('4.7.0')))
    assert.ok(lines.some(l => l.includes('Node')       && l.includes('v22.0.0')))
    assert.ok(lines.some(l => l.includes('APP_ENV')    && l.includes('local')))
    assert.ok(lines.some(l => l.includes('Installed @rudderjs/* packages (2)')))
  })

  it('shows "(none found in node_modules)" when no packages', () => {
    const lines = renderText({
      application: { name: 'demo', env: null, debug: null, url: null },
      runtime:     { node: 'v22.0.0', os: 'Linux 6.0', arch: 'x64', pm: 'pnpm' },
      rudder:      { coreVersion: null, cliVersion: null },
      packages:    [],
    }).map(strip)
    assert.ok(lines.some(l => l.includes('(none found in node_modules)')))
  })
})
