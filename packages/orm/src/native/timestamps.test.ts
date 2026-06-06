// Automatic `createdAt` / `updatedAt` stamping (`static timestamps`) — E2E on
// the NATIVE engine.
//
// Found by dogfooding (playground-native conversion, 2026-06-06): on Prisma the
// schema's `@default(now())` / `@updatedAt` silently stamped timestamps; the
// native engine has no schema defaults unless the migration adds them, and the
// Model layer never stamped — so every `Model.create()` wrote NULL timestamps.
// These tests pin the Laravel-parity behavior: create stamps both, update/save
// bumps `updatedAt`, and the stamping is schema-gated (a table without the
// columns is silently skipped — never an unknown-column insert).

import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { Model, ModelRegistry } from '../index.js'
import { NativeAdapter, BetterSqlite3Driver, type Driver } from '@rudderjs/database/native'

class Post extends Model {
  static override table = 'posts'
  id!:        number
  title!:     string
  createdAt!: string | null
  updatedAt!: string | null
}

// Table WITHOUT timestamp columns — stamping must skip it entirely.
class Tag extends Model {
  static override table = 'tags'
  id!:   number
  name!: string
}

// Explicit opt-out on a table that HAS the columns.
class AuditEvent extends Model {
  static override table = 'audit_events'
  static override timestamps = false
  id!:        number
  kind!:      string
  createdAt!: string | null
  updatedAt!: string | null
}

let driver: Driver

beforeEach(async () => {
  driver = await BetterSqlite3Driver.open({ filename: ':memory:' })
  await driver.execute(`CREATE TABLE posts        (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, createdAt TEXT, updatedAt TEXT)`, [])
  await driver.execute(`CREATE TABLE tags         (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL)`, [])
  await driver.execute(`CREATE TABLE audit_events (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, createdAt TEXT, updatedAt TEXT)`, [])
  ModelRegistry.reset()
  ModelRegistry.set(await NativeAdapter.make({ driverInstance: driver }))
})

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

describe('automatic timestamps — native sqlite E2E', () => {
  it('create() stamps createdAt + updatedAt as ISO-8601 UTC', async () => {
    const post = await Post.create({ title: 'hello' })
    assert.match(String(post.createdAt), ISO)
    assert.match(String(post.updatedAt), ISO)
    assert.strictEqual(post.createdAt, post.updatedAt)
  })

  it('explicitly-passed timestamps are respected on create()', async () => {
    const fixed = '2020-01-01T00:00:00.000Z'
    const post = await Post.create({ title: 'fixed', createdAt: fixed })
    assert.strictEqual(post.createdAt, fixed)
    assert.match(String(post.updatedAt), ISO)     // not passed → stamped
  })

  it('Model.update() bumps updatedAt and preserves createdAt', async () => {
    const post = await Post.create({ title: 'v1' })
    const createdAt = post.createdAt
    await new Promise((r) => setTimeout(r, 5))

    const updated = await Post.update(post.id, { title: 'v2' })
    assert.strictEqual(updated.createdAt, createdAt)
    assert.notStrictEqual(updated.updatedAt, createdAt)
    assert.ok(String(updated.updatedAt) > String(createdAt))
  })

  it('Model.update() respects an explicitly-passed updatedAt (backfill)', async () => {
    const post = await Post.create({ title: 'v1' })
    const fixed = '2019-06-06T12:00:00.000Z'
    const updated = await Post.update(post.id, { title: 'v2', updatedAt: fixed })
    assert.strictEqual(updated.updatedAt, fixed)
  })

  it('save() bumps updatedAt even though the payload carries the old value', async () => {
    const post = await Post.create({ title: 'v1' })
    const before = post.updatedAt
    await new Promise((r) => setTimeout(r, 5))

    post.title = 'v2'
    await post.save()
    assert.notStrictEqual(post.updatedAt, before)
    assert.ok(String(post.updatedAt) > String(before))
  })

  it('save() on a new instance (insert path) stamps both columns', async () => {
    const post = new (Post as unknown as new () => Post)()
    post.title = 'fresh'
    await post.save()
    assert.match(String(post.createdAt), ISO)
    assert.match(String(post.updatedAt), ISO)
  })

  it('a table without timestamp columns is silently skipped', async () => {
    const tag = await Tag.create({ name: 'sql' })   // would throw unknown-column if stamped
    assert.strictEqual(tag.name, 'sql')
    const rows = await driver.execute(`SELECT * FROM tags WHERE id = ?`, [tag.id])
    assert.deepStrictEqual(Object.keys(rows[0]!).sort(), ['id', 'name'])
  })

  it('static timestamps = false opts out on a table that HAS the columns', async () => {
    const ev = await AuditEvent.create({ kind: 'login' })
    assert.strictEqual(ev.createdAt, null)
    assert.strictEqual(ev.updatedAt, null)
  })

  it('firstOrCreate routes through create() and stamps', async () => {
    const post = await Post.firstOrCreate({ title: 'unique-row' })
    assert.match(String(post.createdAt), ISO)
  })

  it('bulk updateAll() does NOT stamp (pure data-plane)', async () => {
    const post = await Post.create({ title: 'bulk' })
    const before = post.updatedAt
    await new Promise((r) => setTimeout(r, 5))
    await Post.where('id', post.id).updateAll({ title: 'bulk2' })
    const fresh = await Post.findOrFail(post.id)
    assert.strictEqual(fresh.updatedAt, before)
  })
})
