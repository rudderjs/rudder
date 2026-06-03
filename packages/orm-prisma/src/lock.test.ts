// Pessimistic locking on the Prisma adapter — throws with a raw-transaction
// pointer. Prisma's query API has no FOR UPDATE / FOR SHARE clause, and a
// silent no-op would be a correctness bug for job-queue-style reservations
// (the read MUST block concurrent reservers). No DB connection needed — the
// throw is synchronous at the QB layer.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from './index.js'

function makeClient() {
  const delegate = {
    findMany: async () => [], findFirst: async () => null, findUnique: async () => null,
    count: async () => 0, create: async () => ({}), createMany: async () => ({ count: 0 }),
    update: async () => ({}), updateMany: async () => ({ count: 0 }),
    delete: async () => undefined, deleteMany: async () => ({ count: 0 }),
  }
  return { user: delegate, $connect: async () => {}, $disconnect: async () => {} }
}

describe('Prisma adapter — pessimistic locking throws with a raw-transaction pointer', () => {
  it('lockForUpdate throws', async () => {
    const adapter = await prisma({ client: makeClient() }).create()
    const q = adapter.query('user')
    assert.throws(() => q.lockForUpdate!(), /lockForUpdate\(\) is not supported.*FOR UPDATE.*DB\.transaction/s)
  })

  it('sharedLock throws', async () => {
    const adapter = await prisma({ client: makeClient() }).create()
    const q = adapter.query('user')
    assert.throws(() => q.sharedLock!(), /sharedLock\(\) is not supported.*FOR SHARE/s)
  })
})
