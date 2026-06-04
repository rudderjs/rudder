// hasOneThrough / hasManyThrough conformance — real better-sqlite3 via the
// native adapter, end-to-end through the Model API (lazy related() + eager with()).
//
// Topology: Country → User → Post.
//   countries.id = users.countryId   (firstKey)
//   users.id     = posts.userId      (secondKey)

import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { Model, ModelRegistry } from './index.js'
import { NativeAdapter } from '@rudderjs/database/native'
import { BetterSqlite3Driver } from '@rudderjs/database/native'
import type { Driver } from '@rudderjs/database/native'

// ── Models ───────────────────────────────────────────────────
class Country extends Model {
  static override table = 'countries'
  static override relations = {
    posts:     { type: 'hasManyThrough' as const, model: () => Post, through: () => User },
    firstPost: { type: 'hasOneThrough'  as const, model: () => Post, through: () => User },
    // Same relation with explicit keys — exercises the override path.
    explicitPosts: {
      type: 'hasManyThrough' as const, model: () => Post, through: () => User,
      firstKey: 'countryId', secondKey: 'userId', localKey: 'id', secondLocalKey: 'id',
    },
  }
  id!: number
  name!: string
}

class User extends Model {
  static override table = 'users'
  id!: number
  countryId!: number
  name!: string
}

class Post extends Model {
  static override table = 'posts'
  static override relations = {
    // Inverse through (for the whereHas-rejection case).
    countryViaUser: { type: 'hasManyThrough' as const, model: () => Country, through: () => User },
  }
  id!: number
  userId!: number
  title!: string
  published!: number
}

let driver: Driver

async function seed(): Promise<void> {
  await driver.execute(`CREATE TABLE countries (id INTEGER PRIMARY KEY, name TEXT)`, [])
  await driver.execute(`CREATE TABLE users (id INTEGER PRIMARY KEY, countryId INTEGER, name TEXT)`, [])
  await driver.execute(`CREATE TABLE posts (id INTEGER PRIMARY KEY, userId INTEGER, title TEXT, published INTEGER)`, [])

  // US(1): users 1,2.  UK(2): user 3.  FR(3): no users.
  for (const [id, name] of [[1, 'US'], [2, 'UK'], [3, 'FR']] as Array<[number, string]>) {
    await driver.execute(`INSERT INTO countries (id, name) VALUES (?, ?)`, [id, name])
  }
  for (const [id, countryId, name] of [[1, 1, 'Ada'], [2, 1, 'Alan'], [3, 2, 'Grace']] as Array<[number, number, string]>) {
    await driver.execute(`INSERT INTO users (id, countryId, name) VALUES (?, ?, ?)`, [id, countryId, name])
  }
  // user1 → posts 1,2 ; user2 → post 3 ; user3 → post 4.
  const posts: Array<[number, number, string, number]> = [
    [1, 1, 'A1', 1],
    [2, 1, 'A2', 0],
    [3, 2, 'B1', 1],
    [4, 3, 'C1', 1],
  ]
  for (const p of posts) await driver.execute(`INSERT INTO posts (id, userId, title, published) VALUES (?, ?, ?, ?)`, p)
  // Expected: US.posts = [1,2,3]; UK.posts = [4]; FR.posts = [].
}

before(async () => { driver = await BetterSqlite3Driver.open({ filename: ':memory:' }); await seed() })
after(async () => { await driver.close() })
beforeEach(async () => { ModelRegistry.reset(); ModelRegistry.set(await NativeAdapter.make({ driverInstance: driver })) })

describe('hasManyThrough — lazy related()', () => {
  it('walks the intermediate to fetch the distant rows', async () => {
    const us = await Country.find(1)
    const posts = await us!.related('posts').orderBy('id').get()
    assert.deepStrictEqual(posts.map(p => (p as Post).id), [1, 2, 3])
  })

  it('returns the single country\'s reach (UK → one user → one post)', async () => {
    const uk = await Country.find(2)
    const posts = await uk!.related('posts').get()
    assert.deepStrictEqual(posts.map(p => (p as Post).id), [4])
  })

  it('is empty when the parent has no intermediate rows', async () => {
    const fr = await Country.find(3)
    const posts = await fr!.related('posts').get()
    assert.deepStrictEqual(posts, [])
  })

  it('composes a constraint onto the distant query', async () => {
    const us = await Country.find(1)
    const published = await us!.related('posts').where('published', 1).orderBy('id').get()
    assert.deepStrictEqual(published.map(p => (p as Post).id), [1, 3])
  })

  it('hydrates real Model instances', async () => {
    const us = await Country.find(1)
    const first = await us!.related('posts').orderBy('id').first()
    assert.ok(first instanceof Post)
  })

  it('honors explicit key overrides identically to the defaults', async () => {
    const us = await Country.find(1)
    const posts = await us!.related('explicitPosts').orderBy('id').get()
    assert.deepStrictEqual(posts.map(p => (p as Post).id), [1, 2, 3])
  })
})

describe('hasOneThrough — lazy related()', () => {
  it('fetches a single distant row via .first()', async () => {
    const us = await Country.find(1)
    const post = await us!.related('firstPost').orderBy('id').first()
    assert.ok(post instanceof Post)
    assert.strictEqual((post as Post).id, 1)
  })

  it('is null when the parent reaches nothing', async () => {
    const fr = await Country.find(3)
    const post = await fr!.related('firstPost').first()
    assert.strictEqual(post, null)
  })
})

describe('hasManyThrough — eager with()', () => {
  it('batch-loads the relation onto every parent', async () => {
    const countries = await Country.with('posts').orderBy('id').get()
    const byId = new Map(countries.map(c => [(c as Country).id, c]))
    const ids = (c: Model): number[] => (c as unknown as { posts: Post[] }).posts.map(p => p.id).sort((a, b) => a - b)
    assert.deepStrictEqual(ids(byId.get(1)!), [1, 2, 3])
    assert.deepStrictEqual(ids(byId.get(2)!), [4])
    assert.deepStrictEqual(ids(byId.get(3)!), [])
  })

  it('eager-loaded children are Model instances', async () => {
    const [us] = await Country.with('posts').where('id', 1).get()
    const posts = (us as unknown as { posts: Post[] }).posts
    assert.ok(posts.every(p => p instanceof Post))
  })
})

describe('hasOneThrough — eager with()', () => {
  it('attaches a single row (or null) per parent', async () => {
    const countries = await Country.with('firstPost').orderBy('id').get()
    const byId = new Map(countries.map(c => [(c as Country).id, c]))
    const one = (c: Model): Post | null => (c as unknown as { firstPost: Post | null }).firstPost
    assert.ok(one(byId.get(1)!) instanceof Post)
    assert.ok(one(byId.get(2)!) instanceof Post)
    assert.strictEqual(one(byId.get(3)!), null)
  })
})

describe('through relations — unsupported paths throw clearly', () => {
  it('whereHas on a through relation throws a descriptive error', () => {
    assert.throws(() => Post.whereHas('countryViaUser'), /through relation .* is not supported yet/)
  })

  it('withCount on a through relation throws a descriptive error', () => {
    assert.throws(() => Country.withCount('posts'), /through relation .* is not supported yet/)
  })

  it('related() throws when the local key is unset on an unsaved parent', () => {
    const c = new Country()
    assert.throws(() => c.related('posts'), /is null\/undefined/)
  })
})
