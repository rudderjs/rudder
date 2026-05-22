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
  it('emits AND: [flat, group] with the group recursively flattened to Laravel-parity OR-of-alternatives', async () => {
    const { fakeClient, getLastWhere } = makeClient()
    const adapter = await prisma({ client: fakeClient }).create()

    await (adapter.query<unknown>('user') as QueryBuilder<unknown>)
      .where('status', 'active')
      .whereGroup(g => g.where('priority', 'high').orWhere('starred', true))
      .get()

    const where = getLastWhere()
    // The inner group's `where('priority').orWhere('starred')` produces a
    // top-level `OR: [{ priority }, { starred }]` shape (each .orWhere()
    // is its own alternative, not constrained by the prior AND). The
    // outer .where('status') stays in the AND chain.
    assert.deepEqual(where, {
      AND: [
        { status: 'active' },
        { OR: [{ priority: 'high' }, { starred: true }] },
      ],
    })
  })
})

// ─── Single OR-rooted group ──────────────────────────────────────────────────

describe('PrismaQueryBuilder.orWhereGroup — single OR group', () => {
  it('emits OR: [andSide, ...orGroups] — the group is a top-level alternative to the prior AND chain', async () => {
    const { fakeClient, getLastWhere } = makeClient()
    const adapter = await prisma({ client: fakeClient }).create()

    await (adapter.query<unknown>('user') as QueryBuilder<unknown>)
      .where('status', 'active')
      .orWhereGroup(g => g.where('priority', 'high').where('starred', true))
      .get()

    const where = getLastWhere()
    // Laravel: `WHERE status='active' OR (priority='high' AND starred=true)`.
    // Previously this came out as `{ status: 'active', OR: [...] }` which
    // Prisma read as `status='active' AND (priority AND starred)` — the OR
    // was constrained by the prior AND, the wrong precedence. The new
    // shape is the same OR alternatives form bare `.orWhere()` produces.
    // The inner group's two AND'd wheres stay flat (Object.assign) when
    // there are no group-of-groups — same column-collision posture as the
    // legacy shape; multi-element AND chains across columns flatten safely.
    assert.deepEqual(where, {
      OR: [
        { status: 'active' },
        { priority: 'high', starred: true },
      ],
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
  it('produces (A AND (B OR (C AND D))) — Laravel-parity at every level', async () => {
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
    // Outer .where('a').whereGroup(g1) → AND chain of (a, g1).
    // Inner g1 has .where('b').orWhereGroup(g2) → Laravel-parity OR
    // alternatives: { OR: [{ b }, <g2-filter>] }. g2's two ANDs flatten.
    assert.deepEqual(where, {
      AND: [
        { a: 1 },
        { OR: [{ b: 2 }, { c: 3, d: 4 }] },
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

// ─── Laravel-parity where+orWhere precedence (2026-05-22 breaking) ───────────

describe('PrismaQueryBuilder — where + orWhere precedence (Laravel parity)', () => {
  it('plain where + orWhere emits OR-of-alternatives — each .orWhere() escapes the prior AND', async () => {
    // The canonical Phase 3 example from
    // docs/plans/2026-05-21-framework-orm-correctness.md. Before this
    // change, Prisma emitted `{ status: 'active', OR: [{ admin: true }] }`
    // which read as `status='active' AND admin=true` — the orWhere was
    // constrained by the prior AND. Laravel / Drizzle parity is
    // `status='active' OR admin=true`, expressed via
    // `{ OR: [{ status }, { admin }] }`.
    const { fakeClient, getLastWhere } = makeClient()
    const adapter = await prisma({ client: fakeClient }).create()

    await (adapter.query<unknown>('user') as QueryBuilder<unknown>)
      .where('status', 'active')
      .orWhere('admin', true)
      .get()

    assert.deepEqual(getLastWhere(), {
      OR: [{ status: 'active' }, { admin: true }],
    })
  })

  it('multi-where + orWhere — the AND chain becomes one OR alternative; column collisions survive', async () => {
    const { fakeClient, getLastWhere } = makeClient()
    const adapter = await prisma({ client: fakeClient }).create()

    await (adapter.query<unknown>('user') as QueryBuilder<unknown>)
      .where('status', 'active')
      .where('priority', 'high')
      .orWhere('priority', 'low')
      .get()

    // The two .where('priority', ...) sit in the AND chain and would
    // collide under Object.assign — the AND-array form preserves both.
    // The .orWhere becomes its own OR alternative.
    assert.deepEqual(getLastWhere(), {
      OR: [
        { AND: [{ status: 'active' }, { priority: 'high' }] },
        { priority: 'low' },
      ],
    })
  })

  it('multiple .orWhere() calls each become a top-level OR alternative', async () => {
    const { fakeClient, getLastWhere } = makeClient()
    const adapter = await prisma({ client: fakeClient }).create()

    await (adapter.query<unknown>('user') as QueryBuilder<unknown>)
      .where('status', 'active')
      .orWhere('admin', true)
      .orWhere('priority', 'high')
      .get()

    assert.deepEqual(getLastWhere(), {
      OR: [
        { status: 'active' },
        { admin: true },
        { priority: 'high' },
      ],
    })
  })

  it('orWhere-only chain emits a bare OR — no spurious AND wrapper', async () => {
    const { fakeClient, getLastWhere } = makeClient()
    const adapter = await prisma({ client: fakeClient }).create()

    await (adapter.query<unknown>('user') as QueryBuilder<unknown>)
      .orWhere('admin', true)
      .orWhere('priority', 'high')
      .get()

    assert.deepEqual(getLastWhere(), {
      OR: [{ admin: true }, { priority: 'high' }],
    })
  })

  it('AND-only chain (no .orWhere) keeps the legacy flat shape — unaffected by Phase 3', async () => {
    // Pin the unchanged behaviour: queries with no .orWhere() / no
    // .orWhereGroup() must not get rewrapped in an OR array. Apps that
    // never reached for the OR forms see no shape change at all.
    const { fakeClient, getLastWhere } = makeClient()
    const adapter = await prisma({ client: fakeClient }).create()

    await (adapter.query<unknown>('user') as QueryBuilder<unknown>)
      .where('status', 'active')
      .where('priority', 'high')
      .get()

    // Legacy Object.assign-spread shape. No OR alternatives → no shape
    // change relative to the pre-Phase-3 emitter.
    assert.deepEqual(getLastWhere(), {
      status: 'active',
      priority: 'high',
    })
  })

  it('soft-delete filter joins the AND alternative (not wrapped outside)', async () => {
    // The soft-delete scope contributes to the AND chain, so it lives
    // inside the AND alternative of the OR when an .orWhere() is present.
    // Matches Drizzle's posture (see packages/orm-drizzle/src/index.ts —
    // softExpr is pushed into andExprs, not wrapped around the result).
    // Apps that need soft-delete to always apply should not mix .orWhere()
    // with soft-deleted models; the Phase 3 plan flags this as a follow-up.
    const { fakeClient, getLastWhere } = makeClient()
    const adapter = await prisma({ client: fakeClient }).create()

    const qb = adapter.query<unknown>('user') as QueryBuilder<unknown> & { _enableSoftDeletes(): unknown }
    qb._enableSoftDeletes()
    await qb.where('status', 'active').orWhere('admin', true).get()

    assert.deepEqual(getLastWhere(), {
      OR: [
        { AND: [{ status: 'active' }, { deletedAt: null }] },
        { admin: true },
      ],
    })
  })
})
