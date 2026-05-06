import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from './index.js'
import type { RelationExistencePredicate, QueryBuilder } from '@rudderjs/contracts'

// ─── Capturing client ────────────────────────────────────────────────────────
//
// Each delegate captures the args passed to findMany/findFirst/count so we
// can inspect the where/include shape the adapter built.

interface CapturedCall { method: string; args: Record<string, unknown> }

function makeRecorder(seed: Record<string, unknown[]> = {}) {
  const calls: CapturedCall[] = []
  const tableRows: Record<string, unknown[]> = seed

  const makeDelegate = (table: string) => ({
    findMany: async (args: Record<string, unknown> = {}) => {
      calls.push({ method: `${table}.findMany`, args })
      return tableRows[table] ?? []
    },
    findFirst: async (args: Record<string, unknown> = {}) => {
      calls.push({ method: `${table}.findFirst`, args })
      return null
    },
    findUnique: async (args: Record<string, unknown> = {}) => {
      calls.push({ method: `${table}.findUnique`, args })
      return null
    },
    count: async (args: Record<string, unknown> = {}) => {
      calls.push({ method: `${table}.count`, args })
      return 0
    },
    create:     async () => ({}),
    createMany: async () => ({ count: 0 }),
    update:     async () => ({}),
    updateMany: async () => ({ count: 0 }),
    delete:     async () => undefined,
    deleteMany: async () => ({ count: 0 }),
  })

  const fakeClient = {
    user:     makeDelegate('user'),
    post:     makeDelegate('post'),
    role:     makeDelegate('role'),
    role_user: makeDelegate('role_user'),
    image:    makeDelegate('image'),
    tag:      makeDelegate('tag'),
    taggable: makeDelegate('taggable'),
    $connect:    async () => {},
    $disconnect: async () => {},
  }
  return { fakeClient, calls }
}

// ─── Direct relation (some / none) ───────────────────────────────────────────

describe('PrismaQueryBuilder.whereRelationExists — direct relation', () => {
  it('builds {posts: {some: ...}} for exists=true with no constraint', async () => {
    const { fakeClient, calls } = makeRecorder()
    const adapter = await prisma({ client: fakeClient }).create()

    const predicate: RelationExistencePredicate = {
      relation:        'posts',
      exists:          true,
      relatedTable:    'post',
      parentColumn:    'id',
      relatedColumn:   'authorId',
      constraintWheres: [],
    }
    const q = adapter.query<unknown>('user') as QueryBuilder<unknown>
    await q.whereRelationExists(predicate).get()

    const [call] = calls.filter(c => c.method === 'user.findMany')
    assert.deepEqual(call!.args['where'], { posts: { some: {} } })
  })

  it('builds {posts: {none: ...}} for exists=false', async () => {
    const { fakeClient, calls } = makeRecorder()
    const adapter = await prisma({ client: fakeClient }).create()

    const predicate: RelationExistencePredicate = {
      relation: 'posts', exists: false, relatedTable: 'post',
      parentColumn: 'id', relatedColumn: 'authorId', constraintWheres: [],
    }
    const q = adapter.query<unknown>('user') as QueryBuilder<unknown>
    await q.whereRelationExists(predicate).get()

    assert.deepEqual(calls[0]!.args['where'], { posts: { none: {} } })
  })

  it('flattens constraintWheres into the inner some-filter', async () => {
    const { fakeClient, calls } = makeRecorder()
    const adapter = await prisma({ client: fakeClient }).create()

    const predicate: RelationExistencePredicate = {
      relation: 'posts', exists: true, relatedTable: 'post',
      parentColumn: 'id', relatedColumn: 'authorId',
      constraintWheres: [
        { column: 'published', operator: '=',  value: true },
        { column: 'viewCount', operator: '>=', value: 10 },
      ],
    }
    const q = adapter.query<unknown>('user') as QueryBuilder<unknown>
    await q.whereRelationExists(predicate).get()

    assert.deepEqual(calls[0]!.args['where'], {
      posts: { some: { published: true, viewCount: { gte: 10 } } },
    })
  })
})

// ─── Pivot path (2-step) ─────────────────────────────────────────────────────

describe('PrismaQueryBuilder.whereRelationExists — pivot (belongsToMany)', () => {
  it('runs role.findMany → role_user.findMany → user.findMany IN list', async () => {
    const { fakeClient, calls } = makeRecorder({
      role:      [{ id: 7 }, { id: 9 }],
      role_user: [{ userId: 1, roleId: 7 }, { userId: 5, roleId: 9 }],
    })
    const adapter = await prisma({ client: fakeClient }).create()

    const predicate: RelationExistencePredicate = {
      relation: 'roles', exists: true, relatedTable: 'role',
      parentColumn: 'id', relatedColumn: 'id',
      constraintWheres: [{ column: 'name', operator: '=', value: 'admin' }],
      through: { pivotTable: 'role_user', foreignPivotKey: 'userId', relatedPivotKey: 'roleId' },
    }
    const q = adapter.query<unknown>('user') as QueryBuilder<unknown>
    await q.whereRelationExists(predicate).get()

    // Step 1: role.findMany with constraint
    const roleCall = calls.find(c => c.method === 'role.findMany')!
    assert.deepEqual(roleCall.args['where'], { name: 'admin' })

    // Step 2: role_user.findMany with relatedPivotKey IN [7, 9]
    const pivotCall = calls.find(c => c.method === 'role_user.findMany')!
    assert.deepEqual(pivotCall.args['where'], { roleId: { in: [7, 9] } })

    // Step 3: user.findMany with id IN [1, 5]
    const userCall = calls.find(c => c.method === 'user.findMany')!
    const where = userCall.args['where'] as { id?: { in?: unknown[] } }
    assert.deepEqual(where.id, { in: [1, 5] })
  })

  it('exists=false produces NOT IN', async () => {
    const { fakeClient, calls } = makeRecorder({
      role: [{ id: 7 }],
      role_user: [{ userId: 1, roleId: 7 }],
    })
    const adapter = await prisma({ client: fakeClient }).create()

    const predicate: RelationExistencePredicate = {
      relation: 'roles', exists: false, relatedTable: 'role',
      parentColumn: 'id', relatedColumn: 'id', constraintWheres: [],
      through: { pivotTable: 'role_user', foreignPivotKey: 'userId', relatedPivotKey: 'roleId' },
    }
    const q = adapter.query<unknown>('user') as QueryBuilder<unknown>
    await q.whereRelationExists(predicate).get()

    const userCall = calls.find(c => c.method === 'user.findMany')!
    const where = userCall.args['where'] as { id?: { notIn?: unknown[] } }
    assert.deepEqual(where.id, { notIn: [1] })
  })
})

// ─── Polymorphic without through ─────────────────────────────────────────────

describe('PrismaQueryBuilder.whereRelationExists — morphMany', () => {
  it('queries related with extraEquals + constraint, then IN', async () => {
    const { fakeClient, calls } = makeRecorder({
      image: [{ imageableId: 3 }, { imageableId: 7 }],
    })
    const adapter = await prisma({ client: fakeClient }).create()

    const predicate: RelationExistencePredicate = {
      relation: 'images', exists: true, relatedTable: 'image',
      parentColumn: 'id', relatedColumn: 'imageableId',
      constraintWheres: [{ column: 'kind', operator: '=', value: 'avatar' }],
      extraEquals: { imageableType: 'Article' },
    }
    const q = adapter.query<unknown>('article' /* not seeded — outer call goes to article delegate */) as QueryBuilder<unknown>
    // We don't have an article delegate in the recorder; this still exercises
    // the deferred lookup. The outer query call will fall through to a
    // missing delegate — to keep this test focussed on the deferred path,
    // assert on the image delegate calls before letting the outer call fail.
    let outerError: unknown = null
    try { await q.whereRelationExists(predicate).get() } catch (e) { outerError = e }

    const imageCall = calls.find(c => c.method === 'image.findMany')!
    assert.deepEqual(imageCall.args['where'], { kind: 'avatar', imageableType: 'Article' })
    // Outer fails because no `article` delegate is registered — that's fine,
    // the deferred-resolution behaviour is what we're testing.
    assert.ok(outerError, 'outer call against missing delegate should error')
  })
})

// ─── withConstrained ─────────────────────────────────────────────────────────

describe('PrismaQueryBuilder.withConstrained', () => {
  it('produces include: { rel: { where } }', async () => {
    const { fakeClient, calls } = makeRecorder()
    const adapter = await prisma({ client: fakeClient }).create()

    const q = adapter.query<unknown>('user') as QueryBuilder<unknown>
    await q.withConstrained!('posts', [{ column: 'published', operator: '=', value: true }]).get()

    const call = calls.find(c => c.method === 'user.findMany')!
    assert.deepEqual(call.args['include'], { posts: { where: { published: true } } })
  })
})
