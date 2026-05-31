// Execution conformance for the schema builder (7.1).
//
// Boots a REAL better-sqlite3 in-memory database and runs `SchemaBuilder`
// against it: a `create()`d table must be a real, usable table (proven by
// round-tripping rows through the `@rudderjs/orm` Model layer), defaults must
// apply, unique indexes must enforce, and introspection must reflect reality.
// Mirrors the native read/write conformance tests.

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { Model, ModelRegistry } from '../../index.js'
import { NativeAdapter } from '../adapter.js'
import { BetterSqlite3Driver } from '../drivers/better-sqlite3.js'
import { SqliteDialect } from '../dialect.js'
import type { Driver } from '../driver.js'
import { SchemaBuilder } from './schema-builder.js'

class User extends Model {
  static override table = 'users'
  id!: number
  name!: string
  email!: string
  active!: number
}

let driver: Driver
let schema: SchemaBuilder

beforeEach(async () => {
  driver = await BetterSqlite3Driver.open({ filename: ':memory:' })
  schema = new SchemaBuilder(driver, new SqliteDialect())
  ModelRegistry.reset()
  ModelRegistry.set(await NativeAdapter.make({ driverInstance: driver }))
})

afterEach(async () => {
  await driver.close()
})

describe('SchemaBuilder.create — produces a real, usable table', () => {
  it('a created table round-trips rows through the Model layer', async () => {
    await schema.create('users', (t) => {
      t.id()
      t.string('name')
      t.string('email').unique()
      t.boolean('active').default(true)
      t.timestamps()
    })

    const created = await User.create({ name: 'Alice', email: 'alice@example.com' })
    assert.strictEqual(typeof created.id, 'number')

    const found = await User.find(created.id)
    assert.strictEqual(found?.name, 'Alice')
    // default(true) → stored as 1
    assert.strictEqual(found?.active, 1)
  })

  it('a unique() column is enforced by a real unique index', async () => {
    await schema.create('users', (t) => {
      t.id()
      t.string('email').unique()
    })
    await User.create({ email: 'dup@example.com' } as Partial<User>)
    await assert.rejects(() => User.create({ email: 'dup@example.com' } as Partial<User>))
  })

  it('a non-null column without a default rejects a missing value', async () => {
    await schema.create('users', (t) => {
      t.id()
      t.string('name') // NOT NULL, no default
    })
    await assert.rejects(() => driver.execute('INSERT INTO users DEFAULT VALUES', []))
  })
})

describe('SchemaBuilder — drop + introspection', () => {
  it('dropIfExists is a no-op on a missing table and drops an existing one', async () => {
    await schema.dropIfExists('nope') // must not throw
    await schema.create('users', (t) => { t.id() })
    assert.strictEqual(await schema.hasTable('users'), true)
    await schema.drop('users')
    assert.strictEqual(await schema.hasTable('users'), false)
  })

  it('hasTable / hasColumn reflect the live schema', async () => {
    assert.strictEqual(await schema.hasTable('users'), false)
    await schema.create('users', (t) => {
      t.id()
      t.string('email')
    })
    assert.strictEqual(await schema.hasTable('users'), true)
    assert.strictEqual(await schema.hasColumn('users', 'email'), true)
    assert.strictEqual(await schema.hasColumn('users', 'nope'), false)
  })
})
