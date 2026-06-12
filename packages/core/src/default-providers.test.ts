import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import path from 'node:path'
import { defaultProviders, getLastLoadedProviderEntries, resolveMultiDriver } from './default-providers.js'
import type { ProviderEntry } from './provider-registry.js'

// These tests run against a temporary cwd so we can write a manifest without
// touching the real playground. The loader uses process.cwd() at call time.

const SCRATCH = path.join(process.cwd(), '.test-scratch-default-providers')
const ORIGINAL_CWD = process.cwd()

describe('defaultProviders()', () => {
  beforeEach(() => {
    mkdirSync(path.join(SCRATCH, 'bootstrap/cache'), { recursive: true })
    process.chdir(SCRATCH)
  })

  afterEach(() => {
    process.chdir(ORIGINAL_CWD)
    if (existsSync(SCRATCH)) rmSync(SCRATCH, { recursive: true, force: true })
  })

  it('falls back to the built-in registry when no manifest exists', async () => {
    rmSync(path.join(SCRATCH, 'bootstrap/cache/providers.json'), { force: true })

    // Should return without throwing — packages are optional so missing peers are silent
    const providers = await defaultProviders()
    assert.ok(Array.isArray(providers))
  })

  it('honors the skip option', async () => {
    const manifest = {
      version: 2 as const,
      generated: new Date().toISOString(),
      providers: [
        { package: '@rudderjs/log',   provider: 'LogProvider',   stage: 'foundation' as const, optional: true },
        { package: '@rudderjs/cache', provider: 'CacheProvider', stage: 'infrastructure' as const, optional: true },
      ],
    }
    writeFileSync(path.join(SCRATCH, 'bootstrap/cache/providers.json'), JSON.stringify(manifest))

    await defaultProviders({ skip: ['@rudderjs/log'] })
    const loaded = getLastLoadedProviderEntries()

    // Skipped entries never appear in _lastLoadedEntries
    assert.ok(!loaded.some(e => e.package === '@rudderjs/log'))
  })

  it('skips entries with autoDiscover: false', async () => {
    const manifest = {
      version: 2 as const,
      generated: new Date().toISOString(),
      providers: [
        { package: '@rudderjs/cache', provider: 'CacheProvider', stage: 'infrastructure' as const, optional: true },
        { package: '@rudderjs/horizon', provider: 'HorizonProvider', stage: 'monitoring' as const, optional: true, autoDiscover: false },
      ],
    }
    writeFileSync(path.join(SCRATCH, 'bootstrap/cache/providers.json'), JSON.stringify(manifest))

    await defaultProviders()
    const loaded = getLastLoadedProviderEntries()

    assert.ok(!loaded.some(e => e.package === '@rudderjs/horizon'))
  })

  it('parses a valid manifest without throwing', async () => {
    const manifest = {
      version: 2 as const,
      generated: new Date().toISOString(),
      providers: [
        { package: '@rudderjs/log', provider: 'LogProvider', stage: 'foundation' as const, optional: true },
      ],
    }
    writeFileSync(path.join(SCRATCH, 'bootstrap/cache/providers.json'), JSON.stringify(manifest))

    await assert.doesNotReject(() => defaultProviders())
  })
})

describe('resolveMultiDriver()', () => {
  const PRISMA = '@rudderjs/orm-prisma'
  const DRIZZLE = '@rudderjs/orm-drizzle'
  const entry = (pkg: string): ProviderEntry =>
    ({ package: pkg, provider: 'OrmProvider', stage: 'infrastructure' }) as ProviderEntry
  const pkgs = (entries: ProviderEntry[]) => entries.map((e) => e.package)
  const resolve = (entries: ProviderEntry[]) =>
    resolveMultiDriver(entries, '@rudderjs/orm-', 'database.driver', 'DB_DRIVER')

  let prev: string | undefined
  beforeEach(() => { prev = process.env['DB_DRIVER'] })
  afterEach(() => {
    if (prev === undefined) delete process.env['DB_DRIVER']
    else process.env['DB_DRIVER'] = prev
  })

  it('selects the driver named by the env var, not just first-installed', () => {
    process.env['DB_DRIVER'] = 'drizzle'
    assert.deepEqual(pkgs(resolve([entry(PRISMA), entry(DRIZZLE)])), [DRIZZLE])
  })

  it('falls back to first-installed when neither env nor config is set', () => {
    delete process.env['DB_DRIVER']
    assert.deepEqual(pkgs(resolve([entry(PRISMA), entry(DRIZZLE)])), [PRISMA])
  })

  it('throws when the selected driver matches no installed package', () => {
    process.env['DB_DRIVER'] = 'mongoose'
    assert.throws(() => resolve([entry(PRISMA), entry(DRIZZLE)]), /doesn't match any of/)
  })

  it('leaves a single driver untouched', () => {
    process.env['DB_DRIVER'] = 'whatever'
    const all = [entry(PRISMA), entry('@rudderjs/cache')]
    assert.deepEqual(resolve(all), all)
  })

  it('keeps non-driver entries alongside the chosen driver', () => {
    process.env['DB_DRIVER'] = 'drizzle'
    const out = resolve([entry('@rudderjs/log'), entry(PRISMA), entry(DRIZZLE), entry('@rudderjs/cache')])
    assert.deepEqual(pkgs(out), ['@rudderjs/log', DRIZZLE, '@rudderjs/cache'])
  })
})
