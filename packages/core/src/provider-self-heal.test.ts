// Boot-time self-heal of the provider manifest: missing/stale manifests are
// rescanned from node_modules without a manual `providers:discover` run.
// Dev rewrites the manifest; production honors a stale manifest (deterministic
// boots) and only scans in memory when the manifest is missing entirely.
import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { defaultProviders, getLastLoadedProviderEntries } from './default-providers.js'
import { computeFingerprint, isFingerprintStale } from './commands/providers-discover.js'
import type { ProviderManifest } from './provider-registry.js'

const SCRATCH = path.join(process.cwd(), '.test-scratch-self-heal')
const ORIGINAL_CWD = process.cwd()
const MANIFEST = path.join(SCRATCH, 'bootstrap/cache/providers.json')

/** Install a fake importable provider package into the scratch node_modules. */
function installFakePkg(name: string, provider: string): void {
  const dir = path.join(SCRATCH, 'node_modules', name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    name,
    type: 'module',
    main: './index.js',
    rudderjs: { provider, stage: 'feature' },
  }))
  writeFileSync(path.join(dir, 'index.js'), `export class ${provider} {}\n`)
}

function readManifest(): ProviderManifest {
  return JSON.parse(readFileSync(MANIFEST, 'utf-8')) as ProviderManifest
}

describe('provider manifest self-heal', () => {
  let prevAppEnv: string | undefined

  beforeEach(() => {
    mkdirSync(path.join(SCRATCH, 'bootstrap/cache'), { recursive: true })
    writeFileSync(path.join(SCRATCH, 'package.json'), JSON.stringify({
      name: 'scratch-app',
      dependencies: { '@rudderjs/fake-feature': '1.0.0' },
    }))
    installFakePkg('@rudderjs/fake-feature', 'FakeFeatureProvider')
    process.chdir(SCRATCH)
    prevAppEnv = process.env['APP_ENV']
  })

  afterEach(() => {
    if (prevAppEnv === undefined) delete process.env['APP_ENV']
    else process.env['APP_ENV'] = prevAppEnv
    process.chdir(ORIGINAL_CWD)
    if (existsSync(SCRATCH)) rmSync(SCRATCH, { recursive: true, force: true })
  })

  // ── development ─────────────────────────────────────────────

  it('dev: missing manifest → scans, writes a v3 manifest, loads the provider', async () => {
    process.env['APP_ENV'] = 'development'

    const providers = await defaultProviders()

    assert.ok(providers.some(p => p.name === 'FakeFeatureProvider'))
    const manifest = readManifest()
    assert.equal(manifest.version, 3)
    assert.ok(manifest.fingerprint?.depsHash, 'fingerprint.depsHash stamped')
    assert.ok(manifest.providers.some(e => e.package === '@rudderjs/fake-feature'))
  })

  it('dev: stale fingerprint → rescans and rewrites (picks up a raw pnpm add)', async () => {
    process.env['APP_ENV'] = 'development'

    // Manifest predates the install of fake-feature: wrong hash, entry missing.
    writeFileSync(MANIFEST, JSON.stringify({
      version: 3,
      generated: new Date().toISOString(),
      fingerprint: { depsHash: 'deadbeef' },
      providers: [],
    }))

    const providers = await defaultProviders()

    assert.ok(providers.some(p => p.name === 'FakeFeatureProvider'), 'newly installed package loads')
    const manifest = readManifest()
    assert.notEqual(manifest.fingerprint?.depsHash, 'deadbeef', 'manifest rewritten with fresh fingerprint')
  })

  it('dev: legacy v2 manifest (no fingerprint) → regenerated to v3 once', async () => {
    process.env['APP_ENV'] = 'development'

    writeFileSync(MANIFEST, JSON.stringify({
      version: 2,
      generated: new Date().toISOString(),
      providers: [],
    }))

    await defaultProviders()

    assert.equal(readManifest().version, 3)
  })

  it('dev: fresh fingerprint → manifest untouched (fast path)', async () => {
    process.env['APP_ENV'] = 'development'

    // Generate a fresh manifest, then capture its exact bytes.
    await defaultProviders()
    const before = readFileSync(MANIFEST, 'utf-8')

    await defaultProviders()

    assert.equal(readFileSync(MANIFEST, 'utf-8'), before, 'no rewrite when nothing changed')
  })

  // ── production ──────────────────────────────────────────────

  it('prod: stale manifest is honored, not rescanned or rewritten', async () => {
    process.env['APP_ENV'] = 'production'

    const stale = JSON.stringify({
      version: 3,
      generated: new Date().toISOString(),
      fingerprint: { depsHash: 'deadbeef' },
      providers: [], // deliberately missing the installed fake package
    })
    writeFileSync(MANIFEST, stale)

    const providers = await defaultProviders()

    assert.ok(!providers.some(p => p.name === 'FakeFeatureProvider'), 'manifest wins over the live scan')
    assert.equal(readFileSync(MANIFEST, 'utf-8'), stale, 'manifest file untouched in production')
  })

  it('prod: missing manifest → in-memory scan still boots the full provider set', async () => {
    process.env['APP_ENV'] = 'production'

    const providers = await defaultProviders()

    assert.ok(providers.some(p => p.name === 'FakeFeatureProvider'))
    assert.deepEqual(
      getLastLoadedProviderEntries().map(e => e.package),
      ['@rudderjs/fake-feature'],
    )
  })
})

// ── fingerprint unit behavior ─────────────────────────────────

describe('manifest fingerprint', () => {
  const FP_SCRATCH = path.join(ORIGINAL_CWD, '.test-scratch-fingerprint')

  beforeEach(() => { mkdirSync(FP_SCRATCH, { recursive: true }) })
  afterEach(() => { rmSync(FP_SCRATCH, { recursive: true, force: true }) })

  it('hashes the deps blocks and stats the first lockfile found', () => {
    writeFileSync(path.join(FP_SCRATCH, 'package.json'), JSON.stringify({ dependencies: { a: '1' } }))
    writeFileSync(path.join(FP_SCRATCH, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')

    const fp = computeFingerprint(FP_SCRATCH)
    assert.match(fp.depsHash ?? '', /^[0-9a-f]{64}$/)
    assert.equal(fp.lockfile?.name, 'pnpm-lock.yaml')
    assert.ok((fp.lockfile?.size ?? 0) > 0)
  })

  it('omits absent inputs instead of failing', () => {
    const fp = computeFingerprint(FP_SCRATCH) // empty dir
    assert.equal(fp.depsHash, undefined)
    assert.equal(fp.lockfile, undefined)
  })

  it('staleness: legacy (no stored fingerprint) is always stale', () => {
    assert.equal(isFingerprintStale(undefined, {}), true)
  })

  it('staleness: differing depsHash or lockfile stat is stale; missing fields are skipped', () => {
    const lock = { name: 'pnpm-lock.yaml', size: 10, mtimeMs: 1 }
    assert.equal(isFingerprintStale({ depsHash: 'a' }, { depsHash: 'b' }), true)
    assert.equal(isFingerprintStale({ depsHash: 'a' }, { depsHash: 'a' }), false)
    assert.equal(isFingerprintStale({ lockfile: lock }, { lockfile: { ...lock, size: 11 } }), true)
    assert.equal(isFingerprintStale({ lockfile: lock }, { lockfile: lock }), false)
    // One side missing a field → that field is not evidence of staleness.
    assert.equal(isFingerprintStale({ depsHash: 'a' }, {}), false)
    assert.equal(isFingerprintStale({}, { depsHash: 'a' }), false)
  })
})
