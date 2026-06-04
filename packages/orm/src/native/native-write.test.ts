// Write-path conformance for the native engine.
//
// Boots a REAL better-sqlite3 in-memory database, registers `NativeAdapter`,
// and drives the WRITE + SOFT-DELETE slice of the `@rudderjs/orm` Model surface
// against it — the dialect-agnostic Model suite IS the conformance suite
// (cross-phase rule 1). Green here = Phase 2 done.
//
// A fresh in-memory DB is opened per test so writes never leak between cases.

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { Model, ModelRegistry } from '../index.js'
import { NativeAdapter } from '@rudderjs/database/native'
import { BetterSqlite3Driver } from '@rudderjs/database/native'
import type { Driver } from '@rudderjs/database/native'

// ── Models under test ────────────────────────────────────────
class Post extends Model {
  static override table = 'posts'
  id!: number
  title!: string
  views!: number
  published!: number
}

class Doc extends Model {
  static override table = 'docs'
  static override softDeletes = true
  id!: number
  title!: string
  deletedAt!: string | null
}

// upsert targets: a UNIQUE column + a composite primary key.
class User extends Model {
  static override table = 'users'
  static override casts = { active: 'boolean' as const }
  id!: number
  email!: string
  name!: string
  visits!: number
  active!: boolean
}
class Membership extends Model {
  static override table = 'memberships'
  userId!: number
  teamId!: number
  role!: string
}

let driver: Driver

beforeEach(async () => {
  driver = await BetterSqlite3Driver.open({ filename: ':memory:' })
  await driver.execute(
    `CREATE TABLE posts (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, views INTEGER DEFAULT 0, published INTEGER DEFAULT 0)`, [])
  await driver.execute(
    `CREATE TABLE docs (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, deletedAt TEXT)`, [])
  await driver.execute(
    `CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE, name TEXT, visits INTEGER DEFAULT 0, active INTEGER DEFAULT 0)`, [])
  await driver.execute(
    `CREATE TABLE memberships (userId INTEGER NOT NULL, teamId INTEGER NOT NULL, role TEXT, PRIMARY KEY (userId, teamId))`, [])
  ModelRegistry.reset()
  ModelRegistry.set(await NativeAdapter.make({ driverInstance: driver }))
})

afterEach(async () => {
  await driver.close()
})

describe('native write — create', () => {
  it('create() inserts and returns the row with its generated id', async () => {
    const post = await Post.create({ title: 'Hello', views: 3, published: 1 })
    assert.ok(post instanceof Post)
    assert.strictEqual(typeof post.id, 'number')
    assert.strictEqual(post.title, 'Hello')
    assert.strictEqual(post.views, 3)
  })

  it('created row is readable back', async () => {
    const created = await Post.create({ title: 'Persisted', views: 1, published: 0 })
    const found = await Post.find(created.id)
    assert.ok(found)
    assert.strictEqual(found!.title, 'Persisted')
  })

  it('omitted columns fall to DB defaults', async () => {
    const post = await Post.create({ title: 'Defaults' })
    assert.strictEqual(post.views, 0)
    assert.strictEqual(post.published, 0)
  })
})

describe('native write — update', () => {
  it('update(id, data) patches and returns the new row', async () => {
    const post = await Post.create({ title: 'Before', views: 0, published: 0 })
    const updated = await Post.update(post.id, { title: 'After', views: 9 })
    assert.strictEqual(updated.title, 'After')
    assert.strictEqual(updated.views, 9)
    const found = await Post.find(post.id)
    assert.strictEqual(found!.title, 'After')
  })

  it('updateAll patches every matching row and returns the count', async () => {
    await Post.create({ title: 'a', views: 0, published: 0 })
    await Post.create({ title: 'b', views: 0, published: 0 })
    await Post.create({ title: 'c', views: 0, published: 1 })
    const n = await Post.query().where('published', 0).updateAll({ views: 5 })
    assert.strictEqual(n, 2)
    const bumped = await Post.query().where('views', 5).get()
    assert.strictEqual(bumped.length, 2)
  })

  it('updateAll with no match returns 0', async () => {
    const n = await Post.query().where('title', 'nope').updateAll({ views: 1 })
    assert.strictEqual(n, 0)
  })
})

describe('native write — delete (hard)', () => {
  it('delete(id) removes the row on a non-soft-delete model', async () => {
    const post = await Post.create({ title: 'doomed', views: 0, published: 0 })
    await Post.delete(post.id)
    assert.strictEqual(await Post.find(post.id), null)
  })

  it('deleteAll removes matching rows and returns the count', async () => {
    await Post.create({ title: 'a', views: 0, published: 1 })
    await Post.create({ title: 'b', views: 0, published: 1 })
    await Post.create({ title: 'c', views: 0, published: 0 })
    const n = await Post.query().where('published', 1).deleteAll()
    assert.strictEqual(n, 2)
    assert.strictEqual(await Post.count(), 1)
  })
})

describe('native write — insertMany', () => {
  it('inserts a batch', async () => {
    await Post.query().insertMany([
      { title: 'x', views: 1, published: 0 },
      { title: 'y', views: 2, published: 1 },
    ] as Partial<Post>[])
    assert.strictEqual(await Post.count(), 2)
  })

  it('empty batch is a no-op', async () => {
    await Post.query().insertMany([])
    assert.strictEqual(await Post.count(), 0)
  })
})

describe('native write — increment / decrement', () => {
  it('increment bumps the column atomically and returns the new row', async () => {
    const post = await Post.create({ title: 'counter', views: 10, published: 0 })
    const after = await Post.increment(post.id, 'views', 5)
    assert.strictEqual(after.views, 15)
  })

  it('increment defaults amount to 1', async () => {
    const post = await Post.create({ title: 'c', views: 0, published: 0 })
    const after = await Post.increment(post.id, 'views')
    assert.strictEqual(after.views, 1)
  })

  it('decrement subtracts', async () => {
    const post = await Post.create({ title: 'c', views: 10, published: 0 })
    const after = await Post.decrement(post.id, 'views', 4)
    assert.strictEqual(after.views, 6)
  })

  it('increment can write extra columns at the same time', async () => {
    const post = await Post.create({ title: 'c', views: 0, published: 0 })
    const after = await Post.increment(post.id, 'views', 2, { published: 1 } as Partial<Post>)
    assert.strictEqual(after.views, 2)
    assert.strictEqual(after.published, 1)
  })
})

describe('native write — soft deletes', () => {
  it('delete(id) sets deletedAt instead of removing the row', async () => {
    const doc = await Doc.create({ title: 'soft' })
    await Doc.delete(doc.id)
    // excluded from default scope…
    assert.strictEqual(await Doc.find(doc.id), null)
    // …but still present with trashed
    const trashed = await Doc.query().withTrashed().get()
    assert.strictEqual(trashed.length, 1)
    assert.notStrictEqual(trashed[0]!.deletedAt, null)
  })

  it('restore(id) clears deletedAt', async () => {
    const doc = await Doc.create({ title: 'soft' })
    await Doc.delete(doc.id)
    await Doc.restore(doc.id)
    const found = await Doc.find(doc.id)
    assert.ok(found)
    assert.strictEqual(found!.deletedAt, null)
  })

  it('forceDelete(id) permanently removes even a soft-delete model', async () => {
    const doc = await Doc.create({ title: 'soft' })
    await Doc.forceDelete(doc.id)
    const trashed = await Doc.query().withTrashed().get()
    assert.strictEqual(trashed.length, 0)
  })

  it('onlyTrashed returns just the soft-deleted rows', async () => {
    const a = await Doc.create({ title: 'live' })
    const b = await Doc.create({ title: 'gone' })
    await Doc.delete(b.id)
    const only = await Doc.query().onlyTrashed().get()
    assert.deepStrictEqual(only.map(d => d.id), [b.id])
    assert.ok(a) // a stays live
  })
})

describe('native write — instance save() round-trip', () => {
  it('new instance .save() inserts; mutate + .save() updates', async () => {
    const post = new Post()
    post.title = 'viaSave'
    post.views = 1
    post.published = 0
    await post.save()
    assert.strictEqual(typeof post.id, 'number')

    post.title = 'viaSaveEdited'
    await post.save()
    const found = await Post.find(post.id)
    assert.strictEqual(found!.title, 'viaSaveEdited')
    assert.strictEqual(await Post.count(), 1)
  })
})

describe('native upsert — Model.upsert() end-to-end (SQLite RETURNING)', () => {
  it('inserts new rows and returns the affected count', async () => {
    const n = await User.upsert(
      [{ email: 'a@x.com', name: 'Ada' }, { email: 'b@x.com', name: 'Bob' }],
      'email', ['name'],
    )
    assert.strictEqual(n, 2)
    assert.strictEqual(await User.count(), 2)
    assert.strictEqual((await User.where('email', 'a@x.com').first())!.name, 'Ada')
  })

  it('updates only the listed columns on a unique conflict (no duplicate row)', async () => {
    await User.create({ email: 'a@x.com', name: 'Ada', visits: 1 })
    await User.upsert([{ email: 'a@x.com', name: 'Ada Lovelace', visits: 99 }], 'email', ['name'])
    const row = (await User.where('email', 'a@x.com').first())!
    assert.strictEqual(await User.count(), 1)
    assert.strictEqual(row.name, 'Ada Lovelace')
    assert.strictEqual(row.visits, 1) // not in update list → unchanged
  })

  it('default update set overwrites every non-unique inserted column', async () => {
    await User.create({ email: 'a@x.com', name: 'Ada', visits: 1 })
    await User.upsert([{ email: 'a@x.com', name: 'Ada2', visits: 5 }], 'email')
    const row = (await User.where('email', 'a@x.com').first())!
    assert.strictEqual(row.name, 'Ada2')
    assert.strictEqual(row.visits, 5)
  })

  it('empty update list → DO NOTHING (insert-or-ignore)', async () => {
    await User.create({ email: 'a@x.com', name: 'Original', visits: 7 })
    await User.upsert([{ email: 'a@x.com', name: 'Ignored', visits: 0 }], 'email', [])
    const row = (await User.where('email', 'a@x.com').first())!
    assert.strictEqual(row.name, 'Original')
    assert.strictEqual(row.visits, 7)
    assert.strictEqual(await User.count(), 1)
  })

  it('mixes insert + update in one call', async () => {
    await User.create({ email: 'a@x.com', name: 'Ada', visits: 1 })
    await User.upsert(
      [{ email: 'a@x.com', name: 'Ada New' }, { email: 'c@x.com', name: 'Cleo' }],
      'email', ['name'],
    )
    assert.strictEqual(await User.count(), 2)
    assert.strictEqual((await User.where('email', 'a@x.com').first())!.name, 'Ada New')
    assert.strictEqual((await User.where('email', 'c@x.com').first())!.name, 'Cleo')
  })

  it('conflicts on a composite uniqueBy', async () => {
    await Membership.upsert([{ userId: 1, teamId: 2, role: 'member' }], ['userId', 'teamId'], ['role'])
    await Membership.upsert([{ userId: 1, teamId: 2, role: 'admin' }], ['userId', 'teamId'], ['role'])
    const rows = await Membership.all()
    assert.strictEqual(rows.length, 1)
    assert.strictEqual((rows[0] as Membership).role, 'admin')
  })

  it('applies write-time casts (boolean) and no-ops on an empty rows array', async () => {
    assert.strictEqual(await User.upsert([], 'email'), 0)
    await User.upsert([{ email: 'a@x.com', name: 'Ada', active: true }], 'email', ['active'])
    const row = (await User.where('email', 'a@x.com').first())!
    // Write cast serialized `true` → integer 1 (the hydrated instance carries the
    // raw DB int; the boolean cast resolves on toJSON()).
    assert.strictEqual((row as unknown as { active: number }).active, 1)
    assert.strictEqual((row.toJSON() as Record<string, unknown>)['active'], true)
  })
})
