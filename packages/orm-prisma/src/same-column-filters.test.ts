// Same-column clause survival — historically every multi-clause filter was
// composed via `Object.assign` spread, so two clauses on the SAME column
// (`where('views','>=',10).where('views','<=',20)`, or `whereBetween`'s two
// lowered bounds inside a whereHas constraint) silently clobbered all but the
// last — a silently-wider filter. Collisions now route through Prisma's
// `AND: [...]` array form; distinct-column filters keep the historical flat
// spread byte-identical.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from './index.js'
import type { QueryBuilder, RelationExistencePredicate } from '@rudderjs/contracts'

function makeClient() {
  let lastWhere: Record<string, unknown> = {}
  const delegate = {
    findMany:   async (args: { where?: Record<string, unknown> } = {}) => {
      lastWhere = args.where ?? {}; return []
    },
    findFirst:  async () => null,
    findUnique: async () => null,
    count:      async () => 0,
    create:     async () => ({}),
    createMany: async () => ({ count: 0 }),
    update:     async () => ({}),
    delete:     async () => undefined,
    deleteMany: async () => ({ count: 0 }),
    updateMany: async () => ({ count: 0 }),
  }
  const fakeClient = { user: delegate, $connect: async () => {}, $disconnect: async () => {} }
  return { fakeClient, getLastWhere: () => lastWhere }
}

describe('PrismaQueryBuilder — same-column where clauses', () => {
  it('two clauses on one column survive via AND-array (range filter)', async () => {
    const { fakeClient, getLastWhere } = makeClient()
    const adapter = await prisma({ client: fakeClient }).create()

    await (adapter.query<unknown>('user') as QueryBuilder<unknown>)
      .where('views', '>=', 10)
      .where('views', '<=', 20)
      .get()

    assert.deepEqual(getLastWhere(), {
      AND: [{ views: { gte: 10 } }, { views: { lte: 20 } }],
    })
  })

  it('distinct columns keep the historical flat spread', async () => {
    const { fakeClient, getLastWhere } = makeClient()
    const adapter = await prisma({ client: fakeClient }).create()

    await (adapter.query<unknown>('user') as QueryBuilder<unknown>)
      .where('status', 'active')
      .where('views', '>=', 10)
      .get()

    assert.deepEqual(getLastWhere(), { status: 'active', views: { gte: 10 } })
  })

  it('relation-constraint filters keep same-column bounds (whereBetween in a whereHas callback)', async () => {
    const { fakeClient, getLastWhere } = makeClient()
    const adapter = await prisma({ client: fakeClient }).create()

    const predicate: RelationExistencePredicate = {
      relation: 'posts', exists: true, relatedTable: 'post',
      parentColumn: 'id', relatedColumn: 'authorId',
      // What the orm recorder lowers `whereBetween('views', [10, 20])` to.
      constraintWheres: [
        { column: 'views', operator: '>=', value: 10 },
        { column: 'views', operator: '<=', value: 20 },
      ],
    }
    await (adapter.query<unknown>('user') as QueryBuilder<unknown>)
      .whereRelationExists(predicate)
      .get()

    assert.deepEqual(getLastWhere(), {
      posts: { some: { AND: [{ views: { gte: 10 } }, { views: { lte: 20 } }] } },
    })
  })
})
