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
    comments: { type: 'hasMany' as const, model: () => Comment, foreignKey: 'postId' },
  }
  id!: number
  userId!: number
  title!: string
  published!: number
  views!: number
}

class Comment extends Model {
  static override table = 'comments'
  id!: number
  postId!: number
}

let driver: Driver

async function seed(): Promise<void> {
  await driver.execute(`CREATE TABLE countries (id INTEGER PRIMARY KEY, name TEXT)`, [])
  await driver.execute(`CREATE TABLE users (id INTEGER PRIMARY KEY, countryId INTEGER, name TEXT)`, [])
  await driver.execute(`CREATE TABLE posts (id INTEGER PRIMARY KEY, userId INTEGER, title TEXT, published INTEGER, views INTEGER)`, [])
  await driver.execute(`CREATE TABLE comments (id INTEGER PRIMARY KEY, postId INTEGER)`, [])

  // US(1): users 1,2.  UK(2): user 3.  FR(3): no users.
  // DE(4): user 4 with ZERO posts — the fan-out false-positive trap (an
  // intermediate row must NOT imply far-row existence).
  for (const [id, name] of [[1, 'US'], [2, 'UK'], [3, 'FR'], [4, 'DE']] as Array<[number, string]>) {
    await driver.execute(`INSERT INTO countries (id, name) VALUES (?, ?)`, [id, name])
  }
  for (const [id, countryId, name] of [[1, 1, 'Ada'], [2, 1, 'Alan'], [3, 2, 'Grace'], [4, 4, 'Klaus']] as Array<[number, number, string]>) {
    await driver.execute(`INSERT INTO users (id, countryId, name) VALUES (?, ?, ?)`, [id, countryId, name])
  }
  // user1 → posts 1,2 ; user2 → post 3 ; user3 → post 4 ; user4 → none.
  const posts: Array<[number, number, string, number, number]> = [
    [1, 1, 'A1', 1, 10],
    [2, 1, 'A2', 0, 20],
    [3, 2, 'B1', 1, 30],
    [4, 3, 'C1', 1, 40],
  ]
  for (const p of posts) await driver.execute(`INSERT INTO posts (id, userId, title, published, views) VALUES (?, ?, ?, ?, ?)`, p)
  // Post 1 has a comment; the rest none.
  await driver.execute(`INSERT INTO comments (id, postId) VALUES (1, 1)`, [])
  // Expected: US.posts = [1,2,3]; UK.posts = [4]; FR.posts = []; DE.posts = [].
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

describe('hasManyThrough — whereHas / whereDoesntHave', () => {
  const names = async (q: { get(): Promise<Model[]> }): Promise<string[]> =>
    (await q.get()).map(c => (c as Country).name).sort()

  it('whereHas matches parents whose FAR rows exist', async () => {
    assert.deepStrictEqual(await names(Country.whereHas('posts')), ['UK', 'US'])
  })

  it('an intermediate with zero far rows does NOT satisfy whereHas (fan-out trap)', async () => {
    // DE has a user but no posts — a bare intermediate row must not count.
    const found = await names(Country.whereHas('posts'))
    assert.ok(!found.includes('DE'))
  })

  it('whereDoesntHave matches parents with no far rows — including via-intermediate-only', async () => {
    assert.deepStrictEqual(await names(Country.whereDoesntHave('posts')), ['DE', 'FR'])
  })

  it('the constrain callback applies to the FAR table (Laravel semantics)', async () => {
    // Only US has an unpublished post.
    assert.deepStrictEqual(await names(Country.whereHas('posts', q => q.where('published', 0))), ['US'])
    // Published posts exist in US and UK.
    assert.deepStrictEqual(await names(Country.whereHas('posts', q => q.where('published', 1))), ['UK', 'US'])
  })

  it('works on hasOneThrough too', async () => {
    assert.deepStrictEqual(await names(Country.whereHas('firstPost')), ['UK', 'US'])
    assert.deepStrictEqual(await names(Country.whereDoesntHave('firstPost')), ['DE', 'FR'])
  })

  it('honors explicit key overrides', async () => {
    assert.deepStrictEqual(await names(Country.whereHas('explicitPosts')), ['UK', 'US'])
  })

  it('has(relation, op, n) counts FAR rows, not intermediates', async () => {
    // US reaches 3 posts via 2 users — `>= 3` only matches if the far rows
    // are counted (an intermediate count would cap US at 2).
    assert.deepStrictEqual(await names(Country.has('posts', '>=', 3)), ['US'])
    assert.deepStrictEqual(await names(Country.has('posts', '>=', 1)), ['UK', 'US'])
    assert.deepStrictEqual(await names(Country.has('posts', '=', 0)), ['DE', 'FR'])
  })

  it('count comparison composes with a far-table constraint', async () => {
    // Published posts: US has 2 (1,3), UK has 1 (4).
    assert.deepStrictEqual(await names(Country.has('posts', '>=', 2, q => q.where('published', 1))), ['US'])
  })

  it('nested dot-path with a through level (posts.comments)', async () => {
    // Only post 1 (US, via user 1) has a comment.
    assert.deepStrictEqual(await names(Country.whereHas('posts.comments')), ['US'])
    assert.deepStrictEqual(await names(Country.whereDoesntHave('posts.comments')), ['DE', 'FR', 'UK'])
  })

  it('related() throws when the local key is unset on an unsaved parent', () => {
    const c = new Country()
    assert.throws(() => c.related('posts'), /is null\/undefined/)
  })

  it('recorded sugar round-trips: whereIn + whereBetween constraints execute on the far table', async () => {
    // whereIn lowers to IN — titles A1 (US) and C1 (UK).
    assert.deepStrictEqual(
      await names(Country.whereHas('posts', q => q.whereIn('title', ['A1', 'C1']))),
      ['UK', 'US'],
    )
    // whereBetween lowers to >= / <= — views 20 and 30 are US-only (UK's post has 40).
    assert.deepStrictEqual(
      await names(Country.whereHas('posts', q => q.whereBetween('views', [15, 35]))),
      ['US'],
    )
  })
})

describe('hasManyThrough — withCount / withAggregate', () => {
  const byName = async (q: { get(): Promise<Model[]> }): Promise<Map<string, Record<string, unknown>>> =>
    new Map((await q.get()).map(c => [(c as Country).name, c as unknown as Record<string, unknown>]))

  it('withCount counts FAR rows per parent (not intermediates)', async () => {
    const m = await byName(Country.withCount('posts'))
    assert.strictEqual(m.get('US')!['postsCount'], 3) // 2 users → 3 posts: must be 3, not 2
    assert.strictEqual(m.get('UK')!['postsCount'], 1)
    assert.strictEqual(m.get('FR')!['postsCount'], 0)
    assert.strictEqual(m.get('DE')!['postsCount'], 0) // user with zero posts
  })

  it('withExists is false for an intermediate with zero far rows', async () => {
    const m = await byName(Country.withExists('posts'))
    assert.strictEqual(m.get('US')!['postsExists'], true)
    assert.strictEqual(m.get('DE')!['postsExists'], false)
    assert.strictEqual(m.get('FR')!['postsExists'], false)
  })

  it('withSum sees EVERY far row (no per-intermediate collapse)', async () => {
    const m = await byName(Country.withSum('posts', 'views'))
    assert.strictEqual(m.get('US')!['postsSumViews'], 60) // 10+20+30 across both users
    assert.strictEqual(m.get('UK')!['postsSumViews'], 40)
    assert.strictEqual(m.get('FR')!['postsSumViews'], 0)
  })

  it('withCount accepts a far-table constraint', async () => {
    const m = await byName(Country.withCount({ posts: (q) => q.where('published', 1) }))
    assert.strictEqual(m.get('US')!['postsCount'], 2)
    assert.strictEqual(m.get('UK')!['postsCount'], 1)
  })

  it('works on hasOneThrough (counts 0/1-or-more)', async () => {
    const m = await byName(Country.withCount('firstPost'))
    assert.strictEqual(m.get('US')!['firstPostCount'], 3) // same far reach as posts
    assert.strictEqual(m.get('DE')!['firstPostCount'], 0)
  })
})
