// Nested whereHas on the Prisma adapter — PR C of the nested-callback plan
// (docs/plans/2026-06-07-nested-callback-where-has.md), v1-throw posture:
//
//   - ALL-DIRECT chains (every level schema-declared) compose as native
//     nested `some`/`none` filters — Prisma's easiest case.
//   - A pivot/morph/through level is legal ONLY at the OUTERMOST position:
//     its deferred 2-step lookup's related filter carries the direct-chain
//     children as `some`/`none` legs.
//   - A non-direct level at any DEEPER position throws the mixed-chain error
//     at build time (the innermost-first hybrid is a documented follow-up).
//
// The capturing client pins the exact `where` shapes handed to Prisma.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from './index.js'
import type { QueryBuilder, RelationExistencePredicate } from '@rudderjs/contracts'

interface CapturedCall { method: string; args: Record<string, unknown> }

function makeRecorder(seed: Record<string, unknown[]> = {}) {
  const calls: CapturedCall[] = []
  const tableRows: Record<string, unknown[]> = seed

  const makeDelegate = (table: string) => ({
    findMany: async (args: Record<string, unknown> = {}) => {
      calls.push({ method: `${table}.findMany`, args })
      return tableRows[table] ?? []
    },
    findFirst:  async () => null,
    findUnique: async () => null,
    count:      async () => 0,
    create:     async () => ({}),
    createMany: async () => ({ count: 0 }),
    update:     async () => ({}),
    updateMany: async () => ({ count: 0 }),
    delete:     async () => undefined,
    deleteMany: async () => ({ count: 0 }),
  })

  const fakeClient = {
    user:      makeDelegate('user'),
    post:      makeDelegate('post'),
    comment:   makeDelegate('comment'),
    role:      makeDelegate('role'),
    role_user: makeDelegate('role_user'),
    image:     makeDelegate('image'),
    $connect:    async () => {},
    $disconnect: async () => {},
  }
  return { fakeClient, calls }
}

const direct = (over: Partial<RelationExistencePredicate> & Pick<RelationExistencePredicate, 'relation' | 'relatedTable' | 'parentColumn' | 'relatedColumn'>): RelationExistencePredicate =>
  ({ exists: true, constraintWheres: [], ...over })

describe('PrismaQueryBuilder — nested whereHas, all-direct chains', () => {
  it('two levels with constraints at BOTH levels → nested some filters', async () => {
    const { fakeClient, calls } = makeRecorder()
    const adapter = await prisma({ client: fakeClient }).create()

    const p = direct({
      relation: 'posts', relatedTable: 'post', parentColumn: 'id', relatedColumn: 'authorId',
      constraintWheres: [{ column: 'published', operator: '=', value: true }],
      nested: [direct({
        relation: 'comments', relatedTable: 'comment', parentColumn: 'id', relatedColumn: 'postId',
        constraintWheres: [{ column: 'approved', operator: '=', value: true }],
      })],
    })
    await (adapter.query<unknown>('user') as QueryBuilder<unknown>).whereRelationExists(p).get()

    const call = calls.find(c => c.method === 'user.findMany')!
    assert.deepEqual(call.args['where'], {
      posts: { some: { published: true, comments: { some: { approved: true } } } },
    })
  })

  it('inner whereDoesntHave → nested none', async () => {
    const { fakeClient, calls } = makeRecorder()
    const adapter = await prisma({ client: fakeClient }).create()

    const p = direct({
      relation: 'posts', relatedTable: 'post', parentColumn: 'id', relatedColumn: 'authorId',
      nested: [direct({
        relation: 'comments', relatedTable: 'comment', parentColumn: 'id', relatedColumn: 'postId',
        exists: false,
      })],
    })
    await (adapter.query<unknown>('user') as QueryBuilder<unknown>).whereRelationExists(p).get()

    assert.deepEqual(calls.find(c => c.method === 'user.findMany')!.args['where'], {
      posts: { some: { comments: { none: {} } } },
    })
  })

  it('outer whereDoesntHave with an inner whereHas → none wrapping some', async () => {
    const { fakeClient, calls } = makeRecorder()
    const adapter = await prisma({ client: fakeClient }).create()

    const p = direct({
      relation: 'posts', relatedTable: 'post', parentColumn: 'id', relatedColumn: 'authorId',
      exists: false,
      nested: [direct({ relation: 'comments', relatedTable: 'comment', parentColumn: 'id', relatedColumn: 'postId' })],
    })
    await (adapter.query<unknown>('user') as QueryBuilder<unknown>).whereRelationExists(p).get()

    assert.deepEqual(calls.find(c => c.method === 'user.findMany')!.args['where'], {
      posts: { none: { comments: { some: {} } } },
    })
  })

  it('dot-paths (singular nested) produce the same shape as callback arrays', async () => {
    const { fakeClient, calls } = makeRecorder()
    const adapter = await prisma({ client: fakeClient }).create()

    const p = direct({
      relation: 'posts', relatedTable: 'post', parentColumn: 'id', relatedColumn: 'authorId',
      nested: direct({ relation: 'comments', relatedTable: 'comment', parentColumn: 'id', relatedColumn: 'postId' }),
    })
    await (adapter.query<unknown>('user') as QueryBuilder<unknown>).whereRelationExists(p).get()

    assert.deepEqual(calls.find(c => c.method === 'user.findMany')!.args['where'], {
      posts: { some: { comments: { some: {} } } },
    })
  })

  it('sibling children on DISTINCT relations spread flat', async () => {
    const { fakeClient, calls } = makeRecorder()
    const adapter = await prisma({ client: fakeClient }).create()

    const p = direct({
      relation: 'posts', relatedTable: 'post', parentColumn: 'id', relatedColumn: 'authorId',
      nested: [
        direct({ relation: 'comments', relatedTable: 'comment', parentColumn: 'id', relatedColumn: 'postId' }),
        direct({ relation: 'images', relatedTable: 'image', parentColumn: 'id', relatedColumn: 'postId', exists: false }),
      ],
    })
    await (adapter.query<unknown>('user') as QueryBuilder<unknown>).whereRelationExists(p).get()

    assert.deepEqual(calls.find(c => c.method === 'user.findMany')!.args['where'], {
      posts: { some: { comments: { some: {} }, images: { none: {} } } },
    })
  })

  it('SAME-relation siblings survive via the collision-safe AND array', async () => {
    const { fakeClient, calls } = makeRecorder()
    const adapter = await prisma({ client: fakeClient }).create()

    const p = direct({
      relation: 'posts', relatedTable: 'post', parentColumn: 'id', relatedColumn: 'authorId',
      nested: [
        direct({
          relation: 'comments', relatedTable: 'comment', parentColumn: 'id', relatedColumn: 'postId',
          constraintWheres: [{ column: 'approved', operator: '=', value: true }],
        }),
        direct({
          relation: 'comments', relatedTable: 'comment', parentColumn: 'id', relatedColumn: 'postId',
          constraintWheres: [{ column: 'author', operator: '=', value: 'eve' }],
        }),
      ],
    })
    await (adapter.query<unknown>('user') as QueryBuilder<unknown>).whereRelationExists(p).get()

    assert.deepEqual(calls.find(c => c.method === 'user.findMany')!.args['where'], {
      posts: { some: { AND: [
        { comments: { some: { approved: true } } },
        { comments: { some: { author: 'eve' } } },
      ] } },
    })
  })

  it('three levels deep', async () => {
    const { fakeClient, calls } = makeRecorder()
    const adapter = await prisma({ client: fakeClient }).create()

    const p = direct({
      relation: 'posts', relatedTable: 'post', parentColumn: 'id', relatedColumn: 'authorId',
      nested: [direct({
        relation: 'comments', relatedTable: 'comment', parentColumn: 'id', relatedColumn: 'postId',
        nested: [direct({
          relation: 'reactions', relatedTable: 'reaction', parentColumn: 'id', relatedColumn: 'commentId',
          constraintWheres: [{ column: 'kind', operator: '=', value: 'up' }],
        })],
      })],
    })
    await (adapter.query<unknown>('user') as QueryBuilder<unknown>).whereRelationExists(p).get()

    assert.deepEqual(calls.find(c => c.method === 'user.findMany')!.args['where'], {
      posts: { some: { comments: { some: { reactions: { some: { kind: 'up' } } } } } },
    })
  })
})

describe('PrismaQueryBuilder — nested whereHas, non-direct OUTERMOST level', () => {
  it('pivot outermost: the 2-step related filter carries the direct-chain children', async () => {
    const { fakeClient, calls } = makeRecorder({
      role:      [{ id: 7 }],
      role_user: [{ userId: 1, roleId: 7 }],
    })
    const adapter = await prisma({ client: fakeClient }).create()

    const p: RelationExistencePredicate = {
      relation: 'roles', exists: true, relatedTable: 'role',
      parentColumn: 'id', relatedColumn: 'id',
      constraintWheres: [{ column: 'name', operator: '=', value: 'editor' }],
      through: { pivotTable: 'role_user', foreignPivotKey: 'userId', relatedPivotKey: 'roleId' },
      nested: [direct({
        relation: 'grants', relatedTable: 'grant', parentColumn: 'id', relatedColumn: 'roleId',
        constraintWheres: [{ column: 'action', operator: '=', value: 'edit' }],
      })],
    }
    await (adapter.query<unknown>('user') as QueryBuilder<unknown>).whereRelationExists(p).get()

    // Step A: related rows by constraint + nested some leg.
    const roleCall = calls.find(c => c.method === 'role.findMany')!
    assert.deepEqual(roleCall.args['where'], {
      name: 'editor',
      grants: { some: { action: 'edit' } },
    })
    // Step B/C unchanged: pivot walk → parents IN.
    const userCall = calls.find(c => c.method === 'user.findMany')!
    assert.deepEqual((userCall.args['where'] as { id?: unknown }).id, { in: [1] })
  })

  it('polymorphic outermost: the related filter carries children alongside the discriminator', async () => {
    const { fakeClient, calls } = makeRecorder({ image: [{ imageableId: 9 }] })
    const adapter = await prisma({ client: fakeClient }).create()

    const p: RelationExistencePredicate = {
      relation: 'images', exists: true, relatedTable: 'image',
      parentColumn: 'id', relatedColumn: 'imageableId',
      constraintWheres: [],
      extraEquals: { imageableType: 'Post' },
      nested: [direct({ relation: 'tags', relatedTable: 'tag', parentColumn: 'id', relatedColumn: 'imageId' })],
    }
    await (adapter.query<unknown>('post') as QueryBuilder<unknown>).whereRelationExists(p).get()

    const imageCall = calls.find(c => c.method === 'image.findMany')!
    assert.deepEqual(imageCall.args['where'], {
      tags: { some: {} },
      imageableType: 'Post',
    })
  })
})

describe('PrismaQueryBuilder — nested whereHas, mixed-chain rejection (v1 posture)', () => {
  const pivotChild = (): RelationExistencePredicate => ({
    relation: 'roles', exists: true, relatedTable: 'role',
    parentColumn: 'id', relatedColumn: 'id', constraintWheres: [],
    through: { pivotTable: 'role_user', foreignPivotKey: 'userId', relatedPivotKey: 'roleId' },
  })

  it('a pivot child under a direct parent throws at build time', async () => {
    const { fakeClient } = makeRecorder()
    const adapter = await prisma({ client: fakeClient }).create()

    const p = direct({
      relation: 'posts', relatedTable: 'post', parentColumn: 'id', relatedColumn: 'authorId',
      nested: [pivotChild()],
    })
    assert.throws(
      () => (adapter.query<unknown>('user') as QueryBuilder<unknown>).whereRelationExists(p),
      /relation "roles" is a pivot\/polymorphic\/through relation below the top level/,
    )
  })

  it('a pivot child under a pivot parent throws too (non-direct only allowed outermost)', async () => {
    const { fakeClient } = makeRecorder()
    const adapter = await prisma({ client: fakeClient }).create()

    const p: RelationExistencePredicate = { ...pivotChild(), relation: 'outerRoles', nested: [pivotChild()] }
    assert.throws(
      () => (adapter.query<unknown>('user') as QueryBuilder<unknown>).whereRelationExists(p),
      /below the top level/,
    )
  })

  it('a morph child two levels down throws (validation recurses)', async () => {
    const { fakeClient } = makeRecorder()
    const adapter = await prisma({ client: fakeClient }).create()

    const p = direct({
      relation: 'posts', relatedTable: 'post', parentColumn: 'id', relatedColumn: 'authorId',
      nested: [direct({
        relation: 'comments', relatedTable: 'comment', parentColumn: 'id', relatedColumn: 'postId',
        nested: [{
          relation: 'images', exists: true, relatedTable: 'image',
          parentColumn: 'id', relatedColumn: 'imageableId', constraintWheres: [],
          extraEquals: { imageableType: 'Comment' },
        }],
      })],
    })
    assert.throws(
      () => (adapter.query<unknown>('user') as QueryBuilder<unknown>).whereRelationExists(p),
      /relation "images" is a pivot\/polymorphic\/through relation below the top level/,
    )
  })
})
