// schema:types orchestration (GATE 7-types): introspect a live in-memory DB and
// emit registry types. Proves table discovery (excluding migrations/sqlite_*),
// cast folding by table, and the file write.

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, rmSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BetterSqlite3Driver } from '../drivers/better-sqlite3.js'
import { SqliteDialect } from '../dialect.js'
import type { Driver } from '../driver.js'
import { SchemaBuilder } from './schema-builder.js'
import { collectSchemaTypes, generateSchemaTypes, registryDtsPath } from './schema-types.js'

const dialect = new SqliteDialect()
let driver: Driver
let schema: SchemaBuilder

beforeEach(async () => {
  driver = await BetterSqlite3Driver.open({ filename: ':memory:' })
  schema = new SchemaBuilder(driver, dialect)
  await schema.create('users', (t) => {
    t.id()
    t.string('name')
    t.string('bio').nullable()
    t.boolean('active').default(true)
  })
  await schema.create('posts', (t) => {
    t.id()
    t.string('title')
  })
  // a framework bookkeeping table that must NOT appear in generated types
  await schema.create('migrations', (t) => { t.id(); t.string('migration') })
})
afterEach(async () => { await driver.close() })

describe('collectSchemaTypes', () => {
  it('discovers user tables, excluding migrations + sqlite_*', async () => {
    const tables = await collectSchemaTypes(driver, dialect, [])
    const names = tables.map((t) => t.table).sort()
    assert.deepEqual(names, ['posts', 'users'])
  })

  it('folds a model\'s casts in by table name', async () => {
    const tables = await collectSchemaTypes(driver, dialect, [
      { table: 'users', casts: { active: 'boolean' } },
    ])
    const users = tables.find((t) => t.table === 'users')!
    const active = users.columns.find((c) => c.name === 'active')!
    assert.equal(active.ts, 'boolean')           // cast overrides INTEGER storage
    const bio = users.columns.find((c) => c.name === 'bio')!
    assert.equal(bio.ts, 'string | null')        // nullable widens
  })
})

describe('generateSchemaTypes — writes registry.d.ts', () => {
  let cwd: string
  beforeEach(() => { cwd = mkdtempSync(join(tmpdir(), 'rudder-schema-types-')) })
  afterEach(() => { rmSync(cwd, { recursive: true, force: true }) })

  it('writes .rudder/types/models.d.ts with the generated shape', async () => {
    const { path, tableCount } = await generateSchemaTypes(driver, dialect, cwd, [
      { table: 'users', casts: { active: 'boolean' } },
    ])
    assert.equal(path, registryDtsPath(cwd))
    assert.equal(path, join(cwd, '.rudder', 'types', 'models.d.ts'))
    assert.equal(tableCount, 2)
    const dts = readFileSync(path, 'utf8')
    assert.match(dts, /declare module '@rudderjs\/orm'/)
    assert.match(dts, /users: \{/)
    assert.match(dts, /active: boolean/)
    assert.doesNotMatch(dts, /migrations:/)   // bookkeeping table excluded
  })

  it('removes the legacy app/Models/__schema/registry.d.ts on write (migration)', async () => {
    const legacyDir = join(cwd, 'app', 'Models', '__schema')
    mkdirSync(legacyDir, { recursive: true })
    writeFileSync(join(legacyDir, 'registry.d.ts'), '// stale legacy emit\n')
    await generateSchemaTypes(driver, dialect, cwd, [])
    assert.equal(existsSync(join(legacyDir, 'registry.d.ts')), false)
    assert.equal(existsSync(legacyDir), false, 'empty __schema/ dir should be removed too')
  })
})
