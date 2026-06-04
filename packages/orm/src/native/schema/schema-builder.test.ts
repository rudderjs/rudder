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
import { NativeAdapter } from '@rudderjs/database/native'
import { BetterSqlite3Driver } from '@rudderjs/database/native'
import { SqliteDialect } from '@rudderjs/database/native'
import type { Driver } from '@rudderjs/database/native'
import { SchemaBuilder } from '@rudderjs/database/native'

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

describe('SchemaBuilder.table — alters against a live table', () => {
  beforeEach(async () => {
    await schema.create('users', (t) => { t.id(); t.string('name') })
  })

  it('adds a column', async () => {
    await schema.table('users', (t) => t.string('email').nullable())
    assert.strictEqual(await schema.hasColumn('users', 'email'), true)
  })

  it('renames a column', async () => {
    await schema.table('users', (t) => t.renameColumn('name', 'fullName'))
    assert.strictEqual(await schema.hasColumn('users', 'name'), false)
    assert.strictEqual(await schema.hasColumn('users', 'fullName'), true)
  })

  it('drops a column', async () => {
    await schema.table('users', (t) => t.dropColumn('name'))
    assert.strictEqual(await schema.hasColumn('users', 'name'), false)
  })

  it('adds a column with a real, enforced unique index', async () => {
    await schema.table('users', (t) => t.string('email').nullable().unique())
    await driver.execute('INSERT INTO users (name, email) VALUES (?, ?)', ['a', 'x@y.z'])
    await assert.rejects(() => driver.execute('INSERT INTO users (name, email) VALUES (?, ?)', ['b', 'x@y.z']))
  })

  it('drops an index by name', async () => {
    await schema.table('users', (t) => t.string('email').nullable().unique())
    await schema.table('users', (t) => t.dropIndex('users_email_unique'))
    // duplicates now allowed (index gone)
    await driver.execute('INSERT INTO users (name, email) VALUES (?, ?)', ['a', 'dup'])
    await driver.execute('INSERT INTO users (name, email) VALUES (?, ?)', ['b', 'dup'])
  })
})

describe('SchemaBuilder.rename — renames a table', () => {
  it('renames the table (old gone, new present)', async () => {
    await schema.create('users', (t) => { t.id(); t.string('name') })
    await schema.rename('users', 'accounts')
    assert.strictEqual(await schema.hasTable('users'), false)
    assert.strictEqual(await schema.hasTable('accounts'), true)
  })
})

describe('SchemaBuilder.create — foreign keys are enforced (7.6)', () => {
  // better-sqlite3 does NOT enable FK enforcement by default, and this PR
  // deliberately does NOT change the production driver's default (that's a
  // behavior change with its own blast radius). Enable it explicitly on the
  // test driver so we can observe a real FK actually being enforced.
  beforeEach(async () => {
    await driver.execute('PRAGMA foreign_keys = ON', [])
  })

  async function createUsersAndPosts(onDelete?: 'cascade'): Promise<void> {
    await schema.create('users', (t) => { t.id(); t.string('name') })
    await schema.create('posts', (t) => {
      t.id()
      t.string('title')
      const fk = t.foreignId('user_id').constrained() // → users.id
      if (onDelete) fk.onDelete(onDelete)
    })
  }

  it('rejects inserting a child row that references a non-existent parent', async () => {
    await createUsersAndPosts()
    await assert.rejects(() =>
      driver.execute('INSERT INTO posts (title, user_id) VALUES (?, ?)', ['orphan', 999]),
    )
  })

  it('accepts a child row whose parent exists', async () => {
    await createUsersAndPosts()
    await driver.execute('INSERT INTO users (id, name) VALUES (?, ?)', [1, 'Alice'])
    await driver.execute('INSERT INTO posts (title, user_id) VALUES (?, ?)', ['Hello', 1])
    const rows = await driver.execute('SELECT * FROM posts', [])
    assert.strictEqual(rows.length, 1)
  })

  it('onDelete(cascade) removes children when the parent is deleted', async () => {
    await createUsersAndPosts('cascade')
    await driver.execute('INSERT INTO users (id, name) VALUES (?, ?)', [1, 'Alice'])
    await driver.execute('INSERT INTO posts (title, user_id) VALUES (?, ?)', ['Hello', 1])
    await driver.execute('INSERT INTO posts (title, user_id) VALUES (?, ?)', ['World', 1])
    await driver.execute('DELETE FROM users WHERE id = ?', [1])
    const rows = await driver.execute('SELECT * FROM posts', [])
    assert.strictEqual(rows.length, 0)
  })
})
