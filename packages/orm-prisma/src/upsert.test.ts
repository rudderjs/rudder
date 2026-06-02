import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from './index.js'

// PrismaQueryBuilder isn't exported, so we exercise `upsert` through a fake
// PrismaClient that captures the per-row upsert args and proves the batch runs
// inside one $transaction. (Prisma has no portable bulk ON CONFLICT, so the
// adapter maps each row to delegate.upsert and batches them.)

interface UpsertArg { where: Record<string, unknown>; create: Record<string, unknown>; update: Record<string, unknown> }

function makeCapturingClient() {
  const calls: UpsertArg[] = []
  let txBatches = 0
  const delegate = {
    findMany:   async () => [],
    findFirst:  async () => null,
    findUnique: async () => null,
    count:      async () => 0,
    create:     async () => ({}),
    createMany: async () => ({ count: 0 }),
    update:     async () => ({}),
    updateMany: async () => ({ count: 0 }),
    delete:     async () => undefined,
    deleteMany: async () => ({ count: 0 }),
    upsert:     async (arg: UpsertArg) => { calls.push(arg); return arg.create },
  }
  const fakeClient = {
    user: delegate,
    $connect:     async () => {},
    $disconnect:  async () => {},
    // Loose signature so the fake satisfies PrismaClient's index signature.
    $transaction: async (...args: unknown[]) => { txBatches++; return Promise.all(args[0] as Promise<unknown>[]) },
  }
  return { fakeClient, calls, batches: () => txBatches }
}

describe('PrismaQueryBuilder — upsert', () => {
  it('maps each row to a single-column where + create + scoped update, batched in one $transaction', async () => {
    const { fakeClient, calls, batches } = makeCapturingClient()
    const adapter = await prisma({ client: fakeClient }).create()
    const n = await adapter.query('user').upsert!(
      [{ email: 'a@x.com', name: 'Ada', visits: 1 }, { email: 'b@x.com', name: 'Bob', visits: 2 }],
      ['email'],
      ['name'],
    )
    assert.strictEqual(n, 2)
    assert.strictEqual(batches(), 1, 'one transaction for the whole batch')
    assert.strictEqual(calls.length, 2)
    assert.deepEqual(calls[0]!.where, { email: 'a@x.com' })
    assert.deepEqual(calls[0]!.create, { email: 'a@x.com', name: 'Ada', visits: 1 })
    assert.deepEqual(calls[0]!.update, { name: 'Ada' }) // only the update columns
  })

  it('builds a compound-unique where for a composite uniqueBy', async () => {
    const { fakeClient, calls } = makeCapturingClient()
    const adapter = await prisma({ client: fakeClient }).create()
    await adapter.query('user').upsert!(
      [{ userId: 1, teamId: 2, role: 'admin' }],
      ['userId', 'teamId'],
      ['role'],
    )
    assert.deepEqual(calls[0]!.where, { userId_teamId: { userId: 1, teamId: 2 } })
    assert.deepEqual(calls[0]!.update, { role: 'admin' })
  })

  it('empty rows array is a no-op returning 0', async () => {
    const { fakeClient, calls } = makeCapturingClient()
    const adapter = await prisma({ client: fakeClient }).create()
    assert.strictEqual(await adapter.query('user').upsert!([], ['email'], ['name']), 0)
    assert.strictEqual(calls.length, 0)
  })
})
