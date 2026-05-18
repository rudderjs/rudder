import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { _internal, registerConfigKey } from './add.js'

const { REGISTRY, findSpec, detectOrm } = _internal

describe('rudder add — package registry', () => {
  it('lists every aliased package exactly once', () => {
    const aliases = REGISTRY.map(p => p.alias)
    assert.equal(new Set(aliases).size, aliases.length)
  })

  it('every spec has a valid @rudderjs/* npm name', () => {
    for (const spec of REGISTRY) {
      assert.ok(spec.npmName.startsWith('@rudderjs/'),
        `${spec.alias} should map to an @rudderjs/* package, got "${spec.npmName}"`)
    }
  })

  it('every required alias resolves to another known package', () => {
    const known = new Set(REGISTRY.map(p => p.alias))
    for (const spec of REGISTRY) {
      for (const req of spec.requires ?? []) {
        assert.ok(known.has(req), `${spec.alias} requires unknown alias "${req}"`)
      }
    }
  })

  it('config templates emit non-empty TS source for every alias with a config block', () => {
    for (const spec of REGISTRY) {
      if (!spec.config) continue
      const body = spec.config.template({ orm: 'prisma' })
      assert.ok(body.length > 0, `${spec.alias} config template emitted empty string`)
      // Sanity — every template should import from somewhere or export something.
      assert.match(body, /^(import|export)/m, `${spec.alias} config doesn't look like TS module`)
    }
  })
})

describe('rudder add — findSpec', () => {
  it('finds by short alias', () => {
    const spec = findSpec('queue')
    assert.equal(spec?.npmName, '@rudderjs/queue')
  })

  it('finds by full npm package name', () => {
    const spec = findSpec('@rudderjs/queue')
    assert.equal(spec?.alias, 'queue')
  })

  it('returns null for unknown names', () => {
    assert.equal(findSpec('bogus'),                 null)
    assert.equal(findSpec('@rudderjs/bogus'),       null)
    assert.equal(findSpec('@some-other-scope/pkg'), null)
  })
})

describe('rudder add — sync config is ORM-aware', () => {
  it('emits the prisma persistence line when orm=prisma', () => {
    const sync = REGISTRY.find(p => p.alias === 'sync')!
    const body = sync.config!.template({ orm: 'prisma' })
    assert.ok(body.includes('syncPrisma()'), 'sync config should wire syncPrisma() when ORM is Prisma')
  })

  it('omits the persistence line for drizzle or no ORM', () => {
    const sync = REGISTRY.find(p => p.alias === 'sync')!
    assert.ok(!sync.config!.template({ orm: 'drizzle' }).includes('syncPrisma()'))
    assert.ok(!sync.config!.template({ orm: null      }).includes('syncPrisma()'))
  })
})

describe('rudder add — detectOrm', () => {
  let tmp: string
  beforeEach(async () => { tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'rudder-add-')) })
  afterEach(async  () => { await fs.rm(tmp, { recursive: true, force: true }) })

  it('returns "prisma" when @rudderjs/orm-prisma is in dependencies', async () => {
    await fs.writeFile(path.join(tmp, 'package.json'), JSON.stringify({
      dependencies: { '@rudderjs/orm-prisma': '^1.0.0' },
    }))
    assert.equal(detectOrm(tmp), 'prisma')
  })

  it('returns "drizzle" when @rudderjs/orm-drizzle is present', async () => {
    await fs.writeFile(path.join(tmp, 'package.json'), JSON.stringify({
      devDependencies: { '@rudderjs/orm-drizzle': '^1.0.0' },
    }))
    assert.equal(detectOrm(tmp), 'drizzle')
  })

  it('returns null when neither adapter is installed', async () => {
    await fs.writeFile(path.join(tmp, 'package.json'), JSON.stringify({
      dependencies: { '@rudderjs/core': '^1.0.0' },
    }))
    assert.equal(detectOrm(tmp), null)
  })

  it('returns null when package.json is missing', () => {
    assert.equal(detectOrm(tmp), null)
  })
})

describe('rudder add — registerConfigKey', () => {
  let tmp: string
  let indexFile: string

  const baseIndex = `import app      from './app.js'
import server   from './server.js'
import log      from './log.js'

const configs = { app, server, log }

export type Configs = typeof configs

export default configs
`

  beforeEach(async () => {
    tmp       = await fs.mkdtemp(path.join(os.tmpdir(), 'rudder-add-idx-'))
    indexFile = path.join(tmp, 'index.ts')
    await fs.writeFile(indexFile, baseIndex)
  })
  afterEach(async () => { await fs.rm(tmp, { recursive: true, force: true }) })

  it('adds a new import + key for an unrelated config', async () => {
    const result = registerConfigKey(indexFile, 'queue')
    assert.equal(result, 'ok')
    const out = await fs.readFile(indexFile, 'utf8')
    assert.match(out, /^import queue\s+from '\.\/queue\.js'$/m)
    assert.match(out, /const configs = \{ app, server, log, queue \}/)
  })

  it('is idempotent — re-running with the same key returns already-registered', async () => {
    registerConfigKey(indexFile, 'queue')
    const second = registerConfigKey(indexFile, 'queue')
    assert.equal(second, 'already-registered')
    const out = await fs.readFile(indexFile, 'utf8')
    // The second call must not have modified the file: exactly one import
    // line and one occurrence of `queue` in the configs map.
    const importMatches = out.match(/from '\.\/queue\.js'/g) ?? []
    assert.equal(importMatches.length, 1, 'import line should appear exactly once')

    const configsBlock = out.match(/const configs = \{([^}]*)\}/)![1]!
    const configsKeys  = configsBlock.split(',').map(s => s.trim()).filter(Boolean)
    assert.equal(configsKeys.filter(k => k === 'queue').length, 1, 'queue key should appear once in configs map')
  })

  it('bails on unrecognized file shape', async () => {
    await fs.writeFile(indexFile, `// totally custom file\nexport default {}\n`)
    assert.equal(registerConfigKey(indexFile, 'queue'), 'unrecognized-shape')
  })

  it('preserves trailing exports and comments', async () => {
    registerConfigKey(indexFile, 'queue')
    const out = await fs.readFile(indexFile, 'utf8')
    assert.match(out, /export type Configs = typeof configs/)
    assert.match(out, /export default configs/)
  })
})
