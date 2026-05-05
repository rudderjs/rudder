import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from './index.js'
import type { AggregateRequest, QueryBuilder } from '@rudderjs/contracts'

// ─── Capturing client ────────────────────────────────────────────────────────
//
// Mirrors `whereHas.test.ts` — each delegate captures the args passed to the
// adapter so we can inspect the include / where / groupBy shape it built.

interface CapturedCall { method: string; args: Record<string, unknown> }

function makeRecorder(seed: Record<string, unknown[]> = {}) {
  const calls: CapturedCall[] = []
  const tableRows: Record<string, unknown[]> = seed
  const tableGroups: Record<string, Array<Record<string, unknown>>> = (seed['__groups__'] as never) ?? {}

  const makeDelegate = (table: string) => ({
    findMany: async (args: Record<string, unknown> = {}) => {
      calls.push({ method: `${table}.findMany`, args })
      return tableRows[table] ?? []
    },
    findFirst: async (args: Record<string, unknown> = {}) => {
      calls.push({ method: `${table}.findFirst`, args })
      const rows = tableRows[table] ?? []
      return rows[0] ?? null
    },
    findUnique: async (args: Record<string, unknown> = {}) => {
      calls.push({ method: `${table}.findUnique`, args })
      const rows = tableRows[table] ?? []
      return rows[0] ?? null
    },
    count: async (args: Record<string, unknown> = {}) => {
      calls.push({ method: `${table}.count`, args })
      return 0
    },
    aggregate: async (args: Record<string, unknown> = {}) => {
      calls.push({ method: `${table}.aggregate`, args })
      return {}
    },
    groupBy: async (args: Record<string, unknown> = {}) => {
      calls.push({ method: `${table}.groupBy`, args })
      return tableGroups[table] ?? []
    },
    create:     async () => ({}),
    createMany: async () => ({ count: 0 }),
    update:     async () => ({}),
    delete:     async () => undefined,
    deleteMany: async () => ({ count: 0 }),
  })

  const fakeClient = {
    user:      makeDelegate('user'),
    post:      makeDelegate('post'),
    role:      makeDelegate('role'),
    role_user: makeDelegate('role_user'),
    image:     makeDelegate('image'),
    article:   makeDelegate('article'),
    tag:       makeDelegate('tag'),
    taggable:  makeDelegate('taggable'),
    $connect:    async () => {},
    $disconnect: async () => {},
  }
  return { fakeClient, calls }
}

const directCount: AggregateRequest = {
  relation: 'posts',
  fn: 'count',
  alias: 'postsCount',
  joinShape: { relatedTable: 'post', parentColumn: 'id', relatedColumn: 'authorId' },
  constraintWheres: [],
}

// ─── Direct count/exists → _count.select selector ────────────────────────────

describe('PrismaQueryBuilder.withAggregate — direct count via _count.select', () => {
  it('injects { _count: { select: { posts: true } } } in include', async () => {
    const { fakeClient, calls } = makeRecorder({ user: [{ id: 1, _count: { posts: 4 } }] })
    const adapter = await prisma({ client: fakeClient }).create()

    const q = adapter.query<unknown>('user') as QueryBuilder<unknown>
    const rows = await q.withAggregate([directCount]).get() as Array<Record<string, unknown>>

    const userCall = calls.find(c => c.method === 'user.findMany')!
    assert.deepEqual(userCall.args['include'], { _count: { select: { posts: true } } })
    assert.equal(rows[0]!['postsCount'], 4)
    // _count is post-processed away.
    assert.equal('_count' in rows[0]!, false)
  })

  it('exists=true is reported as boolean (count > 0)', async () => {
    const { fakeClient } = makeRecorder({ user: [{ id: 1, _count: { posts: 0 } }, { id: 2, _count: { posts: 3 } }] })
    const adapter = await prisma({ client: fakeClient }).create()

    const req: AggregateRequest = { ...directCount, fn: 'exists', alias: 'postsExists' }
    const q = adapter.query<unknown>('user') as QueryBuilder<unknown>
    const rows = await q.withAggregate([req]).get() as Array<Record<string, unknown>>

    assert.equal(rows[0]!['postsExists'], false)
    assert.equal(rows[1]!['postsExists'], true)
  })

  it('constraintWheres flatten into the inner _count.select.<rel>.where', async () => {
    const { fakeClient, calls } = makeRecorder()
    const adapter = await prisma({ client: fakeClient }).create()

    const req: AggregateRequest = {
      ...directCount,
      constraintWheres: [{ column: 'published', operator: '=', value: true }],
    }
    const q = adapter.query<unknown>('user') as QueryBuilder<unknown>
    await q.withAggregate([req]).get()

    const userCall = calls.find(c => c.method === 'user.findMany')!
    assert.deepEqual(userCall.args['include'], {
      _count: { select: { posts: { where: { published: true } } } },
    })
  })
})

// ─── Polymorphic count → second-batch groupBy ───────────────────────────────

describe('PrismaQueryBuilder.withAggregate — polymorphic count', () => {
  it('runs article.findMany then image.groupBy with the discriminator', async () => {
    const { fakeClient, calls } = makeRecorder({
      article: [{ id: 1 }, { id: 2 }],
      __groups__: { image: [
        { imageableId: 1, _count: { _all: 3 } },
        { imageableId: 2, _count: { _all: 7 } },
      ] },
    } as never)
    const adapter = await prisma({ client: fakeClient }).create()

    const req: AggregateRequest = {
      relation: 'images', fn: 'count', alias: 'imagesCount',
      joinShape: {
        relatedTable: 'image', parentColumn: 'id', relatedColumn: 'imageableId',
        extraEquals: { imageableType: 'Article' },
      },
      constraintWheres: [],
    }
    const q = adapter.query<unknown>('article') as QueryBuilder<unknown>
    const rows = await q.withAggregate([req]).get() as Array<Record<string, unknown>>

    const groupCall = calls.find(c => c.method === 'image.groupBy')!
    const where = groupCall.args['where'] as Record<string, unknown>
    assert.deepEqual(where['imageableId'], { in: [1, 2] })
    assert.equal(where['imageableType'], 'Article')
    assert.deepEqual(groupCall.args['by'], ['imageableId'])
    assert.deepEqual(groupCall.args['_count'], { _all: true })

    assert.equal(rows[0]!['imagesCount'], 3)
    assert.equal(rows[1]!['imagesCount'], 7)
  })
})

// ─── Numeric aggregate → groupBy with _sum/etc. ──────────────────────────────

describe('PrismaQueryBuilder.withAggregate — withSum on hasMany', () => {
  it('issues post.groupBy with _sum: { views: true }', async () => {
    const { fakeClient, calls } = makeRecorder({
      user: [{ id: 1 }, { id: 2 }],
      __groups__: { post: [
        { authorId: 1, _sum: { views: 100 } },
        { authorId: 2, _sum: { views: 25  } },
      ] },
    } as never)
    const adapter = await prisma({ client: fakeClient }).create()

    const req: AggregateRequest = {
      relation: 'posts', fn: 'sum', column: 'views', alias: 'postsSumViews',
      joinShape: { relatedTable: 'post', parentColumn: 'id', relatedColumn: 'authorId' },
      constraintWheres: [],
    }
    const q = adapter.query<unknown>('user') as QueryBuilder<unknown>
    const rows = await q.withAggregate([req]).get() as Array<Record<string, unknown>>

    const groupCall = calls.find(c => c.method === 'post.groupBy')!
    assert.deepEqual(groupCall.args['by'], ['authorId'])
    assert.deepEqual(groupCall.args['_sum'], { views: true })
    assert.equal(rows[0]!['postsSumViews'], 100)
    assert.equal(rows[1]!['postsSumViews'], 25)
  })
})

// ─── _aggregate single-scalar terminal ───────────────────────────────────────

describe('PrismaQueryBuilder._aggregate', () => {
  it('count delegates to delegate.count', async () => {
    const { fakeClient, calls } = makeRecorder()
    const adapter = await prisma({ client: fakeClient }).create()

    const q = adapter.query<unknown>('user') as QueryBuilder<unknown>
    await q.where('teamId', 7)._aggregate('count')

    const call = calls.find(c => c.method === 'user.count')!
    assert.deepEqual(call.args['where'], { teamId: 7 })
  })

  it('sum delegates to delegate.aggregate({ _sum: {col: true} })', async () => {
    const { fakeClient, calls } = makeRecorder()
    const adapter = await prisma({ client: fakeClient }).create()

    const q = adapter.query<unknown>('post') as QueryBuilder<unknown>
    await q._aggregate('sum', 'views')

    const call = calls.find(c => c.method === 'post.aggregate')!
    assert.deepEqual(call.args['_sum'], { views: true })
  })
})
