// Optimistic locking (`static version`) — Prisma adapter.
//
// The versioned update path is pure Model layer, built on the
// `where().updateAll()` / `increment` contract primitives. Prisma maps those
// to `updateMany` (count-returning, where-scoped) and `update` with
// `{ increment }` — so the stale-write check works on Prisma with no adapter
// change. These tests drive the Model layer against a capturing fake client
// (this package's pattern — no DB needed) and pin the delegate calls.

import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { Model, ModelRegistry, ModelNotFoundError, OptimisticLockError } from '@rudderjs/orm'
import { prisma } from './index.js'

class Doc extends Model {
  static override table = 'doc'
  static override version = true
  id!: number
  title!: string
  version!: number
}

interface Calls {
  updateMany: Array<{ where?: Record<string, unknown>; data: Record<string, unknown> }>
  update:     Array<Record<string, unknown>>
  create:     Array<Record<string, unknown>>
}

function makeFakeClient(opts: {
  updateManyCount?: number
  row?: Record<string, unknown> | null
} = {}) {
  const calls: Calls = { updateMany: [], update: [], create: [] }
  const delegate = {
    findMany:   async () => [],
    findFirst:  async () => opts.row ?? null,
    findUnique: async () => opts.row ?? null,
    count:      async () => 0,
    create:     async (args: { data: Record<string, unknown> }) => { calls.create.push(args.data); return { id: 1, ...args.data } },
    createMany: async () => ({ count: 0 }),
    update:     async (args: Record<string, unknown>) => { calls.update.push(args); return opts.row ?? {} },
    updateMany: async (args: { where?: Record<string, unknown>; data: Record<string, unknown> }) => {
      calls.updateMany.push(args)
      return { count: opts.updateManyCount ?? 1 }
    },
    delete:     async () => undefined,
    deleteMany: async () => ({ count: 0 }),
  }
  const fakeClient = { doc: delegate, $connect: async () => {}, $disconnect: async () => {} }
  return { fakeClient, calls }
}

beforeEach(() => ModelRegistry.reset())

describe('optimistic locking — Prisma adapter', () => {
  it('create() stamps version 1', async () => {
    const { fakeClient, calls } = makeFakeClient()
    ModelRegistry.set(await prisma({ client: fakeClient }).create())

    await Doc.create({ title: 'draft' })
    assert.deepStrictEqual(calls.create, [{ title: 'draft', version: 1 }])
  })

  it('a versioned update routes through updateMany with the pk + version filter', async () => {
    const { fakeClient, calls } = makeFakeClient({
      updateManyCount: 1,
      row: { id: 1, title: 'new', version: 4 },
    })
    ModelRegistry.set(await prisma({ client: fakeClient }).create())

    const updated = await Doc.update(1, { title: 'new', version: 3 })

    assert.strictEqual(calls.updateMany.length, 1)
    assert.deepStrictEqual(calls.updateMany[0]?.where, { id: 1, version: 3 })
    assert.deepStrictEqual(calls.updateMany[0]?.data, { title: 'new', version: 4 })
    assert.strictEqual(updated.version, 4)
  })

  it('a stale write (count 0, row present) throws OptimisticLockError', async () => {
    const { fakeClient } = makeFakeClient({
      updateManyCount: 0,
      row: { id: 1, title: 'theirs', version: 5 },
    })
    ModelRegistry.set(await prisma({ client: fakeClient }).create())

    await assert.rejects(
      Doc.update(1, { title: 'mine', version: 3 }),
      (err: unknown) => {
        assert.ok(err instanceof OptimisticLockError)
        assert.strictEqual(err.code, 'OPTIMISTIC_LOCK')
        assert.strictEqual(err.expectedVersion, 3)
        assert.strictEqual(err.actualVersion, 5)
        return true
      },
    )
  })

  it('a stale write against a vanished row throws ModelNotFoundError', async () => {
    const { fakeClient } = makeFakeClient({ updateManyCount: 0, row: null })
    ModelRegistry.set(await prisma({ client: fakeClient }).create())

    await assert.rejects(Doc.update(1, { title: 'mine', version: 3 }), ModelNotFoundError)
  })

  it('an update without a baseline bumps via the increment primitive', async () => {
    const { fakeClient, calls } = makeFakeClient({ row: { id: 1, title: 'new', version: 8 } })
    ModelRegistry.set(await prisma({ client: fakeClient }).create())

    const updated = await Doc.update(1, { title: 'new' })

    assert.strictEqual(calls.updateMany.length, 0)
    assert.strictEqual(calls.update.length, 1)
    assert.deepStrictEqual(calls.update[0], {
      where: { id: 1 },
      data:  { version: { increment: 1 }, title: 'new' },
    })
    assert.strictEqual(updated.version, 8)
  })
})
