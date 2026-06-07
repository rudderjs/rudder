// Through relations (hasOneThrough / hasManyThrough) on the Prisma adapter.
//
// whereHas rides the SAME deferred 2-step lookup as pivots (far rows by
// constraint → intermediates by far keys → parents IN list) — set semantics,
// so the intermediate→related fan-out can't skew it. Aggregates DO care:
// `fanOut: true` routes `_runBatchAggregate` onto the fan-out path that
// aggregates over FAR rows bucketed per parent — the 1:1 pivot path counts
// pivot rows (existence implied by a bare intermediate) and looks related
// rows up by a unique key (collapsing a citizen's many essays onto one).
//
// Topology: nation → citizen → essay.
//   N1: citizens 10,11 → essays 100,101 (c10) + 102 (c11)  — 2 intermediates, 3 far rows
//   N2: citizen 12 → no essays                              — the false-positive trap

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from './index.js'
import type { AggregateRequest, RelationExistencePredicate, QueryBuilder } from '@rudderjs/contracts'

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
    nation:  makeDelegate('nation'),
    citizen: makeDelegate('citizen'),
    essay:   makeDelegate('essay'),
    $connect:    async () => {},
    $disconnect: async () => {},
  }
  return { fakeClient, calls }
}

/** The predicate / join shape `@rudderjs/orm` emits for `Nation.whereHas('essays')`. */
const throughBlock = { pivotTable: 'citizen', foreignPivotKey: 'nationId', relatedPivotKey: 'id', fanOut: true }

describe('PrismaQueryBuilder.whereRelationExists — through relation (deferred 2-step)', () => {
  it('runs essay.findMany → citizen.findMany → nation.findMany IN list', async () => {
    const { fakeClient, calls } = makeRecorder({
      essay:   [{ id: 100, citizenId: 10 }, { id: 102, citizenId: 11 }],
      citizen: [{ id: 10, nationId: 1 }, { id: 11, nationId: 1 }],
    })
    const adapter = await prisma({ client: fakeClient }).create()

    const predicate: RelationExistencePredicate = {
      relation: 'essays', exists: true, relatedTable: 'essay',
      parentColumn: 'id', relatedColumn: 'citizenId',
      constraintWheres: [{ column: 'published', operator: '=', value: true }],
      through: throughBlock,
    }
    await (adapter.query<unknown>('nation') as QueryBuilder<unknown>)
      .whereRelationExists(predicate).get()

    // Step 1: FAR rows by constraint (Laravel semantics — constraint targets essays).
    const essayCall = calls.find(c => c.method === 'essay.findMany')!
    assert.deepEqual(essayCall.args['where'], { published: true })

    // Step 2: intermediates whose key is among the far rows' FK values.
    const citizenCall = calls.find(c => c.method === 'citizen.findMany')!
    assert.deepEqual(citizenCall.args['where'], { id: { in: [10, 11] } })

    // Step 3: parents IN the intermediates' parent-FK values.
    const nationCall = calls.find(c => c.method === 'nation.findMany')!
    const where = nationCall.args['where'] as { id?: { in?: unknown[] } }
    assert.deepEqual(where.id, { in: [1, 1] })
  })

  it('whereDoesntHave produces NOT IN', async () => {
    const { fakeClient, calls } = makeRecorder({
      essay:   [{ id: 100, citizenId: 10 }],
      citizen: [{ id: 10, nationId: 1 }],
    })
    const adapter = await prisma({ client: fakeClient }).create()

    const predicate: RelationExistencePredicate = {
      relation: 'essays', exists: false, relatedTable: 'essay',
      parentColumn: 'id', relatedColumn: 'citizenId',
      constraintWheres: [], through: throughBlock,
    }
    await (adapter.query<unknown>('nation') as QueryBuilder<unknown>)
      .whereRelationExists(predicate).get()

    const nationCall = calls.find(c => c.method === 'nation.findMany')!
    const where = nationCall.args['where'] as { id?: { notIn?: unknown[] } }
    assert.deepEqual(where.id, { notIn: [1] })
  })
})

describe('PrismaQueryBuilder.withAggregate — through relation (fanOut)', () => {
  const seed = {
    nation:  [{ id: 1 }, { id: 2 }],
    citizen: [
      { id: 10, nationId: 1 },
      { id: 11, nationId: 1 },
      { id: 12, nationId: 2 }, // citizen with ZERO essays
    ],
    essay: [
      { id: 100, citizenId: 10, views: 10 },
      { id: 101, citizenId: 10, views: 20 },
      { id: 102, citizenId: 11, views: 30 },
    ],
  }
  const joinShape = {
    relatedTable: 'essay', parentColumn: 'id', relatedColumn: 'citizenId',
    through: throughBlock,
  }

  it('count counts FAR rows per parent, not intermediates', async () => {
    const { fakeClient } = makeRecorder(structuredClone(seed))
    const adapter = await prisma({ client: fakeClient }).create()

    const req: AggregateRequest = {
      relation: 'essays', fn: 'count', alias: 'essaysCount',
      joinShape, constraintWheres: [],
    }
    const rows = await (adapter.query<unknown>('nation') as QueryBuilder<unknown>)
      .withAggregate([req]).get() as Array<Record<string, unknown>>

    assert.equal(rows[0]!['essaysCount'], 3) // 2 citizens → 3 essays: must be 3, not 2
    assert.equal(rows[1]!['essaysCount'], 0) // a bare intermediate contributes nothing
  })

  it('exists is false for an intermediate with zero far rows', async () => {
    const { fakeClient } = makeRecorder(structuredClone(seed))
    const adapter = await prisma({ client: fakeClient }).create()

    const req: AggregateRequest = {
      relation: 'essays', fn: 'exists', alias: 'essaysExists',
      joinShape, constraintWheres: [],
    }
    const rows = await (adapter.query<unknown>('nation') as QueryBuilder<unknown>)
      .withAggregate([req]).get() as Array<Record<string, unknown>>

    assert.equal(rows[0]!['essaysExists'], true)
    assert.equal(rows[1]!['essaysExists'], false) // pivot fast path would say true
  })

  it('sum sees EVERY far row — no per-intermediate unique-key collapse', async () => {
    const { fakeClient } = makeRecorder(structuredClone(seed))
    const adapter = await prisma({ client: fakeClient }).create()

    const req: AggregateRequest = {
      relation: 'essays', fn: 'sum', alias: 'essaysSumViews', column: 'views',
      joinShape, constraintWheres: [],
    }
    const rows = await (adapter.query<unknown>('nation') as QueryBuilder<unknown>)
      .withAggregate([req]).get() as Array<Record<string, unknown>>

    assert.equal(rows[0]!['essaysSumViews'], 60) // 10+20+30 (collapse would lose essay 100 or 101)
    assert.equal(rows[1]!['essaysSumViews'], 0)
  })

  it('queries the far table once, filtered to the parents\' intermediates', async () => {
    const { fakeClient, calls } = makeRecorder(structuredClone(seed))
    const adapter = await prisma({ client: fakeClient }).create()

    const req: AggregateRequest = {
      relation: 'essays', fn: 'count', alias: 'essaysCount',
      joinShape, constraintWheres: [{ column: 'published', operator: '=', value: true }],
    }
    await (adapter.query<unknown>('nation') as QueryBuilder<unknown>)
      .withAggregate([req]).get()

    const essayCalls = calls.filter(c => c.method === 'essay.findMany')
    assert.equal(essayCalls.length, 1)
    const where = essayCalls[0]!.args['where'] as Record<string, unknown>
    assert.deepEqual(where['citizenId'], { in: [10, 11, 12] })
    assert.equal(where['published'], true)
  })
})
