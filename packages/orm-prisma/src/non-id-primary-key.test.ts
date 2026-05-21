import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from './index.js'

// Captures the most-recent `where` arg passed to the Prisma delegate by each
// mutation method. The PrismaQueryBuilder hardcoded `where: { id }` on every
// mutation path before Phase 2 — so a model with `static primaryKey = 'uuid'`
// silently wrote to / read from the wrong column. With Phase 2 the adapter
// reads `opts.primaryKey` (threaded from Model) and emits `where: { [pk]: id }`.

interface Captures {
  lastFindFirst:  { where?: Record<string, unknown>; include?: unknown }
  lastUpdate:     { where?: Record<string, unknown>; data?: Record<string, unknown> }
  lastDelete:     { where?: Record<string, unknown> }
}

function makeCapturingClient() {
  const captures: Captures = {
    lastFindFirst: {},
    lastUpdate:    {},
    lastDelete:    {},
  }
  const delegate = {
    findFirst:  async (args: typeof captures.lastFindFirst) => { captures.lastFindFirst = args; return null },
    findMany:   async () => [],
    findUnique: async () => null,
    count:      async () => 0,
    create:     async ({ data }: { data: unknown }) => data,
    createMany: async () => ({ count: 0 }),
    update:     async (args: typeof captures.lastUpdate) => { captures.lastUpdate = args; return args.data ?? {} },
    updateMany: async () => ({ count: 0 }),
    delete:     async (args: typeof captures.lastDelete) => { captures.lastDelete = args; return undefined },
    deleteMany: async () => ({ count: 0 }),
  }
  // Don't annotate — `prisma({ client })` expects a PrismaClient shape; the
  // object-literal type inferred here is the loosest form `prisma()` accepts
  // for test fakes (matches what the LIKE / operator tests in index.test.ts do).
  const client = { thing: delegate, $connect: async () => undefined, $disconnect: async () => undefined }
  return { client, captures }
}

describe('PrismaAdapter — non-id primaryKey threading', () => {
  it('find() targets the configured primaryKey column, not "id"', async () => {
    const { client, captures } = makeCapturingClient()
    const adapter = await prisma({ client }).create()

    await adapter.query('thing', { primaryKey: 'uuid' }).find('x-1')

    // Composed wheres branch is skipped (no .where chained), so the adapter
    // emits the bare PK match — confirm it uses { uuid: id } not { id }.
    assert.deepEqual(captures.lastFindFirst.where, { uuid: 'x-1' })
  })

  it('find() composes the configured primaryKey with prior wheres', async () => {
    const { client, captures } = makeCapturingClient()
    const adapter = await prisma({ client }).create()

    await adapter.query('thing', { primaryKey: 'uuid' })
      .where('tenantId', 'a')
      .find('x-2')

    assert.deepEqual(
      captures.lastFindFirst.where,
      { AND: [{ uuid: 'x-2' }, { tenantId: 'a' }] },
    )
  })

  it('update() targets the configured primaryKey column', async () => {
    const { client, captures } = makeCapturingClient()
    const adapter = await prisma({ client }).create()

    await adapter.query('thing', { primaryKey: 'uuid' }).update('x-3', { name: 'updated' })

    assert.deepEqual(captures.lastUpdate.where, { uuid: 'x-3' })
    assert.deepEqual(captures.lastUpdate.data,  { name: 'updated' })
  })

  it('delete() targets the configured primaryKey column (non-soft-delete path)', async () => {
    const { client, captures } = makeCapturingClient()
    const adapter = await prisma({ client }).create()

    await adapter.query('thing', { primaryKey: 'uuid' }).delete('x-4')

    assert.deepEqual(captures.lastDelete.where, { uuid: 'x-4' })
  })

  it('restore() targets the configured primaryKey column', async () => {
    const { client, captures } = makeCapturingClient()
    const adapter = await prisma({ client }).create()

    await adapter.query('thing', { primaryKey: 'uuid' }).restore('x-5')

    assert.deepEqual(captures.lastUpdate.where, { uuid: 'x-5' })
    assert.deepEqual(captures.lastUpdate.data,  { deletedAt: null })
  })

  it('forceDelete() targets the configured primaryKey column', async () => {
    const { client, captures } = makeCapturingClient()
    const adapter = await prisma({ client }).create()

    await adapter.query('thing', { primaryKey: 'uuid' }).forceDelete('x-6')

    assert.deepEqual(captures.lastDelete.where, { uuid: 'x-6' })
  })

  it('increment() targets the configured primaryKey column', async () => {
    const { client, captures } = makeCapturingClient()
    const adapter = await prisma({ client }).create()

    await adapter.query('thing', { primaryKey: 'uuid' }).increment('x-7', 'viewCount', 1)

    assert.deepEqual(captures.lastUpdate.where, { uuid: 'x-7' })
    assert.deepEqual(captures.lastUpdate.data,  { viewCount: { increment: 1 } })
  })

  it('decrement() targets the configured primaryKey column', async () => {
    const { client, captures } = makeCapturingClient()
    const adapter = await prisma({ client }).create()

    await adapter.query('thing', { primaryKey: 'uuid' }).decrement('x-8', 'stock', 2)

    assert.deepEqual(captures.lastUpdate.where, { uuid: 'x-8' })
    assert.deepEqual(captures.lastUpdate.data,  { stock: { decrement: 2 } })
  })

  it('defaults to "id" when no primaryKey opts are passed (back-compat)', async () => {
    const { client, captures } = makeCapturingClient()
    const adapter = await prisma({ client }).create()

    // Adapters that haven't been threaded yet (or test fakes) call query(table)
    // with no opts — the adapter should fall back to the historical 'id' column.
    await adapter.query('thing').find(42)

    assert.deepEqual(captures.lastFindFirst.where, { id: 42 })
  })
})
