// Cross-adapter transaction() conformance for the Prisma adapter (gap §8 #1).
//
// Prisma's interactive transaction (`prisma.$transaction(async (tx) => …)`) hands
// the callback a SEPARATE transaction client. The adapter re-binds to it so every
// Model.* and DB.* call inside the callback runs on that one connection — never on
// the root client. We drive this against a fake PrismaClient that records which
// client object each operation hit, plus the raw SQL for nested SAVEPOINTs (no
// real database, matching the rest of this package's unit tests).

import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { Model, ModelRegistry, transaction } from '@rudderjs/orm'
import { DB } from '@rudderjs/database'
// Side effect: importing the adapter entry registers the DB facade bridge +
// transaction runner (`import '@rudderjs/orm/db-bridge'` at the top of index.ts).
import { prisma, type PrismaConfig } from './index.js'

// The fake clients are structural stand-ins; `PrismaConfig.client`'s index
// signature rejects extra `$`-method shapes, so cast at the boundary.
type FakeClient = NonNullable<PrismaConfig['client']>

// ── Op log shared by the root + transaction fake clients ──
interface Op { client: 'root' | 'tx'; kind: string; detail?: string }

function makeDelegate(client: 'root' | 'tx', log: Op[], seq: { n: number }) {
  return {
    findMany:   async () => [],
    findFirst:  async () => null,
    findUnique: async () => null,
    count:      async () => 0,
    create:     async (args: { data: Record<string, unknown> }) => {
      log.push({ client, kind: 'create', detail: String(args.data['owner']) })
      return { id: (seq.n += 1), ...args.data }
    },
    update:     async (args: { data: Record<string, unknown> }) => ({ ...args.data }),
    delete:     async () => undefined,
    deleteMany: async () => ({ count: 0 }),
    createMany: async () => ({ count: 0 }),
    updateMany: async () => ({ count: 0 }),
  }
}

function makeRawSurface(client: 'root' | 'tx', log: Op[]) {
  return {
    $queryRawUnsafe: async (_sql: string) => [] as unknown[],
    $executeRawUnsafe: async (sql: string) => {
      log.push({ client, kind: 'exec', detail: sql })
      return 1
    },
  }
}

function makeFakeClient(log: Op[]) {
  const seq = { n: 0 }
  // The transaction client handed to the $transaction callback.
  const txClient = {
    account: makeDelegate('tx', log, seq),
    ...makeRawSurface('tx', log),
  }
  const root = {
    account: makeDelegate('root', log, seq),
    ...makeRawSurface('root', log),
    $connect:    async () => {},
    $disconnect: async () => {},
    $transaction: async <R>(fn: (tx: typeof txClient) => Promise<R>): Promise<R> => {
      log.push({ client: 'root', kind: '$transaction:begin' })
      return fn(txClient)
    },
  }
  return { root, txClient }
}

class Account extends Model {
  static override table = 'account' // Prisma delegate name
  id!: number
  owner!: string
}

let log: Op[]

beforeEach(async () => {
  log = []
  ModelRegistry.reset()
  const { root } = makeFakeClient(log)
  ModelRegistry.set(await prisma({ client: root as unknown as FakeClient }).create())
})

describe('Prisma transaction() — Model + DB.* join one connection', () => {
  it('routes every write inside transaction() to the transaction client', async () => {
    await transaction(async () => {
      await Account.create({ owner: 'via-model' })
      await DB.insert('insert into accounts (owner) values (?)', ['via-db'])
    })

    // A real $transaction opened, and NOTHING ran on the root client inside it.
    assert.ok(log.some((o) => o.kind === '$transaction:begin'))
    const writes = log.filter((o) => o.kind === 'create' || o.kind === 'exec')
    assert.equal(writes.length, 2)
    assert.ok(writes.every((o) => o.client === 'tx'), 'all writes hit the tx client')
  })

  it('returns the callback value', async () => {
    const out = await transaction(async () => {
      await Account.create({ owner: 'x' })
      return 'done'
    })
    assert.equal(out, 'done')
  })
})

describe('Prisma transaction() — rollback', () => {
  it('re-throws when the callback rejects (Prisma rolls the tx back)', async () => {
    await assert.rejects(
      transaction(async () => {
        await Account.create({ owner: 'doomed' })
        throw new Error('boom')
      }),
      /boom/,
    )
    // The write was attempted on the tx client; nothing leaked to root.
    assert.ok(log.some((o) => o.kind === 'create' && o.client === 'tx'))
    assert.ok(!log.some((o) => o.kind === 'create' && o.client === 'root'))
  })
})

describe('Prisma transaction() — nesting maps to SAVEPOINT', () => {
  it('brackets a nested transaction with SAVEPOINT / RELEASE on commit', async () => {
    await transaction(async () => {
      await Account.create({ owner: 'outer' })
      await transaction(async () => {
        await Account.create({ owner: 'inner' })
      })
    })

    const sql = log.filter((o) => o.kind === 'exec').map((o) => o.detail ?? '')
    assert.equal(sql.length, 2)
    assert.match(sql[0] ?? '', /^SAVEPOINT /)
    assert.match(sql[1] ?? '', /^RELEASE SAVEPOINT /)
    // SAVEPOINT + RELEASE name the same savepoint.
    assert.equal(sql[0]?.replace('SAVEPOINT ', ''), sql[1]?.replace('RELEASE SAVEPOINT ', ''))
  })

  it('rolls a caught nested transaction back to its savepoint, outer continues', async () => {
    await transaction(async () => {
      await Account.create({ owner: 'kept' })
      await assert.rejects(
        transaction(async () => {
          await Account.create({ owner: 'discarded' })
          throw new Error('inner boom')
        }),
        /inner boom/,
      )
    })

    const sql = log.filter((o) => o.kind === 'exec').map((o) => o.detail ?? '')
    assert.match(sql[0] ?? '', /^SAVEPOINT /)
    assert.match(sql[1] ?? '', /^ROLLBACK TO SAVEPOINT /)
    assert.equal(sql[0]?.replace('SAVEPOINT ', ''), sql[1]?.replace('ROLLBACK TO SAVEPOINT ', ''))
  })
})
