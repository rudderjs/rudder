// lean() — read terminals return plain adapter records instead of hydrated
// Model instances. End-to-end against a real in-memory native better-sqlite3
// adapter (same harness as where-sugar.test.ts), so the hydration-bypass is
// exercised for real, not stubbed.

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { Model, ModelRegistry } from './index.js'
import { NativeAdapter, BetterSqlite3Driver } from '@rudderjs/database/native'
import type { Driver } from '@rudderjs/database/native'

class User extends Model {
  static override table = 'users'
  static override timestamps = false
  static override relations = {
    posts: { type: 'hasMany' as const, model: () => Post, foreignKey: 'userId' },
  }
  id!: number
  name!: string
  role!: string | null
  posts?: Post[]
}
class Post extends Model {
  static override table = 'posts'
  static override timestamps = false
  id!: number
  userId!: number
  title!: string
}

let driver: Driver

beforeEach(async () => {
  driver = await BetterSqlite3Driver.open({ filename: ':memory:' })
  await driver.execute(`CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, role TEXT)`, [])
  await driver.execute(`CREATE TABLE posts (id INTEGER PRIMARY KEY AUTOINCREMENT, userId INTEGER, title TEXT)`, [])
  ModelRegistry.reset()
  ModelRegistry.set(await NativeAdapter.make({ driverInstance: driver }))
  for (const [name, role] of [['Ada', 'admin'], ['Alan', 'user'], ['Grace', null]] as const) {
    await User.create({ name, role })
  }
  await Post.create({ userId: 1, title: 'first' })
  await Post.create({ userId: 1, title: 'second' })
})

afterEach(async () => { await driver.close() })

describe('lean() — get/first/find', () => {
  it('get() returns plain records, not Model instances', async () => {
    const rows = await User.query().orderBy('id').lean().get()
    assert.equal(rows.length, 3)
    for (const r of rows) assert.equal(r instanceof Model, false)
  })

  it('lean rows carry the same data as hydrated instances', async () => {
    const hydrated = await User.query().orderBy('id').get()
    const lean = await User.query().orderBy('id').lean().get()
    // JSON round-trip drops the hydrated instance's declared-but-unset fields
    // (e.g. `posts: undefined`), comparing pure data.
    assert.deepEqual(
      JSON.parse(JSON.stringify(lean)),
      JSON.parse(JSON.stringify(hydrated)),
    )
  })

  it('lean rows have no instance methods', async () => {
    const [row] = await User.query().lean().get()
    assert.equal(typeof (row as { save?: unknown }).save, 'undefined')
    assert.equal(typeof (row as { toJSON?: unknown }).toJSON, 'undefined')
  })

  it('first() is lean too', async () => {
    const u = await User.query().where('name', 'Ada').lean().first()
    assert.ok(u)
    assert.equal(u instanceof Model, false)
    assert.equal((u as User).name, 'Ada')
  })

  it('find() is lean too', async () => {
    const u = await User.query().lean().find(2)
    assert.ok(u)
    assert.equal(u instanceof Model, false)
    assert.equal((u as User).id, 2)
  })

  it('composes with where chains and order', async () => {
    const rows = await User.query().whereNotNull('role').orderBy('id').lean().get()
    assert.deepEqual(rows.map((r) => (r as User).name), ['Ada', 'Alan'])
    for (const r of rows) assert.equal(r instanceof Model, false)
  })
})

describe('lean() — entry points', () => {
  it('Model.lean() static works', async () => {
    const rows = await User.lean().orderBy('id').get()
    assert.equal(rows.length, 3)
    assert.equal(rows[0] instanceof Model, false)
  })

  it('lean() can appear anywhere in the chain', async () => {
    const a = await User.query().lean().where('role', 'admin').get()
    const b = await User.query().where('role', 'admin').lean().get()
    assert.deepEqual(a.map((r) => (r as User).name), b.map((r) => (r as User).name))
    assert.equal(a[0] instanceof Model, false)
  })
})

describe('lean() — eager-load guard', () => {
  it('throws when combined with .with()', async () => {
    await assert.rejects(
      () => User.query().lean().with('posts').get(),
      /cannot be combined with eager loading/,
    )
  })

  it('allows withCount — it is an in-SQL aggregate, not relation stitching', async () => {
    // withCount adds a subquery to the SELECT, so the plain lean row carries the
    // alias directly. Unlike .with(), it needs no hydrated instance to stitch.
    const rows = await User.query().where('id', 1).lean().withCount('posts').get()
    assert.equal(rows[0] instanceof Model, false)
    assert.equal((rows[0] as User & { postsCount: number }).postsCount, 2)
  })

  it('hydrated eager loading still works without lean (control)', async () => {
    const users = await User.query().where('id', 1).with('posts').get()
    assert.equal(users[0]!.posts!.length, 2)
    assert.equal(users[0] instanceof Model, true)
  })
})
