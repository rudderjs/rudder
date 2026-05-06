import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from './index.js'
import type { QueryBuilder } from '@rudderjs/contracts'

// Capturing Prisma client — records the `where` arg passed to findMany.
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

// ─── Single AND-rooted group ─────────────────────────────────────────────────

describe('PrismaQueryBuilder.whereGroup — single AND group', () => {
  it('emits AND: [flat, group] with the group carrying its own OR list', async () => {
    const { fakeClient, getLastWhere } = makeClient()
    const adapter = await prisma({ client: fakeClient }).create()

    await (adapter.query<unknown>('user') as QueryBuilder<unknown>)
      .where('status', 'active')
      .whereGroup(g => g.where('priority', 'high').orWhere('starred', true))
      .get()

    const where = getLastWhere()
    assert.deepEqual(where, {
      AND: [
        { status: 'active' },
        { priority: 'high', OR: [{ starred: true }] },
      ],
    })
  })
})

// ─── Single OR-rooted group ──────────────────────────────────────────────────

describe('PrismaQueryBuilder.orWhereGroup — single OR group', () => {
  it('appends the group filter to the top-level OR list', async () => {
    const { fakeClient, getLastWhere } = makeClient()
    const adapter = await prisma({ client: fakeClient }).create()

    await (adapter.query<unknown>('user') as QueryBuilder<unknown>)
      .where('status', 'active')
      .orWhereGroup(g => g.where('priority', 'high').where('starred', true))
      .get()

    const where = getLastWhere()
    assert.deepEqual(where, {
      status: 'active',
      OR: [{ priority: 'high', starred: true }],
    })
  })
})

// ─── Empty group is a no-op ──────────────────────────────────────────────────

describe('PrismaQueryBuilder.whereGroup — empty group', () => {
  it('drops the empty group from the emitted filter', async () => {
    const { fakeClient, getLastWhere } = makeClient()
    const adapter = await prisma({ client: fakeClient }).create()

    await (adapter.query<unknown>('user') as QueryBuilder<unknown>)
      .where('status', 'active')
      .whereGroup(_g => undefined)
      .get()

    assert.deepEqual(getLastWhere(), { status: 'active' })
  })

  it('drops both an empty whereGroup and orWhereGroup', async () => {
    const { fakeClient, getLastWhere } = makeClient()
    const adapter = await prisma({ client: fakeClient }).create()

    await (adapter.query<unknown>('user') as QueryBuilder<unknown>)
      .where('status', 'active')
      .whereGroup(_g => undefined)
      .orWhereGroup(_g => undefined)
      .get()

    assert.deepEqual(getLastWhere(), { status: 'active' })
  })
})

// ─── Nested 3-level group ────────────────────────────────────────────────────

describe('PrismaQueryBuilder.whereGroup — 3-level nesting', () => {
  it('produces (A AND (B AND (C OR D)))', async () => {
    const { fakeClient, getLastWhere } = makeClient()
    const adapter = await prisma({ client: fakeClient }).create()

    await (adapter.query<unknown>('user') as QueryBuilder<unknown>)
      .where('a', 1)
      .whereGroup(g1 =>
        g1.where('b', 2)
          .orWhereGroup(g2 =>
            g2.where('c', 3).where('d', 4),
          ),
      )
      .get()

    const where = getLastWhere()
    // Top-level AND because of the outer whereGroup.
    // Inner group has `b: 2` flat AND an OR list containing the deepest group.
    assert.deepEqual(where, {
      AND: [
        { a: 1 },
        {
          b: 2,
          OR: [{ c: 3, d: 4 }],
        },
      ],
    })
  })
})

// ─── Sub-builder terminals throw ─────────────────────────────────────────────

describe('PrismaQueryBuilder — sub-builder terminals throw', () => {
  // The terminal methods are async and throw via promise rejection. We
  // capture the returned promise from inside the callback and await it
  // outside the synchronous `whereGroup` invocation.
  async function expectSubTerminalRejects(
    invoke: (sub: QueryBuilder<unknown>) => Promise<unknown>,
  ): Promise<void> {
    const { fakeClient } = makeClient()
    const adapter = await prisma({ client: fakeClient }).create()
    const q = adapter.query<unknown>('user') as QueryBuilder<unknown>
    let captured: Promise<unknown> | null = null
    q.whereGroup((g) => { captured = invoke(g) })
    assert.ok(captured, 'callback did not run')
    await assert.rejects(
      captured as unknown as Promise<unknown>,
      /Sub-builder is for where\* chaining only/,
    )
  }

  it('get() on the sub-builder rejects', async () => {
    await expectSubTerminalRejects((g) => g.get())
  })

  it('first() on the sub-builder rejects', async () => {
    await expectSubTerminalRejects((g) => g.first())
  })

  it('find() on the sub-builder rejects', async () => {
    await expectSubTerminalRejects((g) => g.find(1))
  })

  it('count() on the sub-builder rejects', async () => {
    await expectSubTerminalRejects((g) => g.count())
  })

  it('paginate() on the sub-builder rejects', async () => {
    await expectSubTerminalRejects((g) => g.paginate(1, 10))
  })
})

// ─── Existing behaviour preserved ────────────────────────────────────────────

describe('PrismaQueryBuilder — no groups, existing flat-shape preserved', () => {
  it('plain where + orWhere keeps the spread/OR-array shape', async () => {
    const { fakeClient, getLastWhere } = makeClient()
    const adapter = await prisma({ client: fakeClient }).create()

    await (adapter.query<unknown>('user') as QueryBuilder<unknown>)
      .where('status', 'active')
      .orWhere('admin', true)
      .get()

    assert.deepEqual(getLastWhere(), {
      status: 'active',
      OR: [{ admin: true }],
    })
  })
})
