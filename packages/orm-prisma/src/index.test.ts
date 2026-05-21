import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { prisma, DatabaseProvider, type PrismaConfig, type DatabaseConfig } from './index.js'

// Note: tests that actually connect to a database require a generated Prisma
// client and a running DB. These tests verify factory contracts and adapter
// shapes without opening any connections.

// ─── LIKE → Prisma filter mapping ──────────────────────────
// PrismaQueryBuilder is not exported, so we test it via a fake PrismaClient
// that captures the where object passed to findMany.

function makeCapturingClient() {
  let lastWhere: Record<string, unknown> = {}
  const delegate = {
    findMany:   async (args: { where?: Record<string, unknown> }) => { lastWhere = args.where ?? {}; return [] },
    findFirst:  async (args: { where?: Record<string, unknown> }) => { lastWhere = args.where ?? {}; return null },
    findUnique: async (args: { where?: Record<string, unknown> }) => { lastWhere = args.where ?? {}; return null },
    count:      async (args: { where?: Record<string, unknown> }) => { lastWhere = args.where ?? {}; return 0 },
    create:     async () => ({}),
    createMany: async () => ({ count: 0 }),
    update:     async () => ({}),
    updateMany: async () => ({ count: 0 }),
    delete:     async () => undefined,
    deleteMany: async () => ({ count: 0 }),
  }
  const fakeClient = { user: delegate, $connect: async () => {}, $disconnect: async () => {} }
  return { fakeClient, getLastWhere: () => lastWhere }
}

describe('PrismaQueryBuilder — LIKE operator mapping', () => {
  async function buildWhere(pattern: string) {
    const { fakeClient, getLastWhere } = makeCapturingClient()
    const adapter = await prisma({ client: fakeClient }).create()
    await adapter.query('user').where('name', 'LIKE', pattern).get()
    return getLastWhere()
  }

  it('%value% → contains (substring)', async () => {
    const where = await buildWhere('%alice%')
    assert.deepEqual(where['name'], { contains: 'alice' })
  })

  it('value% → startsWith', async () => {
    const where = await buildWhere('ali%')
    assert.deepEqual(where['name'], { startsWith: 'ali' })
  })

  it('%value → endsWith', async () => {
    const where = await buildWhere('%alice')
    assert.deepEqual(where['name'], { endsWith: 'alice' })
  })

  it('value (no %) → equals', async () => {
    const where = await buildWhere('alice')
    assert.deepEqual(where['name'], { equals: 'alice' })
  })
})

describe('PrismaQueryBuilder — NOT LIKE operator mapping', () => {
  async function buildWhere(pattern: string) {
    const { fakeClient, getLastWhere } = makeCapturingClient()
    const adapter = await prisma({ client: fakeClient }).create()
    await (adapter.query('user') as any).where('name', 'NOT LIKE', pattern).get()
    return getLastWhere()
  }

  it('%value% → not.contains (substring)', async () => {
    const where = await buildWhere('%alice%')
    assert.deepEqual(where['name'], { not: { contains: 'alice' } })
  })

  it('value% → not.startsWith', async () => {
    const where = await buildWhere('ali%')
    assert.deepEqual(where['name'], { not: { startsWith: 'ali' } })
  })

  it('%value → not.endsWith', async () => {
    const where = await buildWhere('%alice')
    assert.deepEqual(where['name'], { not: { endsWith: 'alice' } })
  })

  it('value (no %) → not.equals', async () => {
    const where = await buildWhere('alice')
    assert.deepEqual(where['name'], { not: { equals: 'alice' } })
  })
})

describe('PrismaQueryBuilder — other operators', () => {
  async function buildWhere(op: string, value: unknown) {
    const { fakeClient, getLastWhere } = makeCapturingClient()
    const adapter = await prisma({ client: fakeClient }).create()
    await (adapter.query('user') as any).where('age', op, value).get()
    return getLastWhere()
  }

  it('= operator', async () => {
    assert.deepEqual((await buildWhere('=', 30))['age'], 30)
  })

  it('!= operator → not', async () => {
    assert.deepEqual((await buildWhere('!=', 30))['age'], { not: 30 })
  })

  it('> operator → gt', async () => {
    assert.deepEqual((await buildWhere('>', 18))['age'], { gt: 18 })
  })

  it('>= operator → gte', async () => {
    assert.deepEqual((await buildWhere('>=', 18))['age'], { gte: 18 })
  })

  it('< operator → lt', async () => {
    assert.deepEqual((await buildWhere('<', 65))['age'], { lt: 65 })
  })

  it('<= operator → lte', async () => {
    assert.deepEqual((await buildWhere('<=', 65))['age'], { lte: 65 })
  })

  it('IN operator → in', async () => {
    assert.deepEqual((await buildWhere('IN', ['a', 'b']))['age'], { in: ['a', 'b'] })
  })

  it('NOT IN operator → notIn', async () => {
    assert.deepEqual((await buildWhere('NOT IN', ['x']))['age'], { notIn: ['x'] })
  })
})

describe('PrismaQueryBuilder — increment / decrement', () => {
  function makeCapturingUpdateClient() {
    let lastArgs: Record<string, unknown> = {}
    const delegate = {
      findMany:   async () => [],
      findFirst:  async () => null,
      findUnique: async () => null,
      count:      async () => 0,
      create:     async () => ({}),
      createMany: async () => ({ count: 0 }),
      update:     async (args: Record<string, unknown>) => { lastArgs = args; return { id: 1 } },
      updateMany: async () => ({ count: 0 }),
      delete:     async () => undefined,
      deleteMany: async () => ({ count: 0 }),
    }
    const fakeClient = { user: delegate, $connect: async () => {}, $disconnect: async () => {} }
    return { fakeClient, getLastArgs: () => lastArgs }
  }

  it('increment maps to Prisma { increment: n } with default amount of 1', async () => {
    const { fakeClient, getLastArgs } = makeCapturingUpdateClient()
    const adapter = await prisma({ client: fakeClient }).create()
    await adapter.query('user').increment(7, 'count')
    const args = getLastArgs() as { where: { id: number }; data: Record<string, unknown> }
    assert.deepEqual(args.where, { id: 7 })
    assert.deepEqual(args.data, { count: { increment: 1 } })
  })

  it('increment passes amount + extra fields through', async () => {
    const { fakeClient, getLastArgs } = makeCapturingUpdateClient()
    const adapter = await prisma({ client: fakeClient }).create()
    await adapter.query('user').increment(7, 'balance', 25, { lastSeen: 'now' })
    const args = getLastArgs() as { data: Record<string, unknown> }
    assert.deepEqual(args.data, { balance: { increment: 25 }, lastSeen: 'now' })
  })

  it('decrement maps to Prisma { decrement: n }', async () => {
    const { fakeClient, getLastArgs } = makeCapturingUpdateClient()
    const adapter = await prisma({ client: fakeClient }).create()
    await adapter.query('user').decrement(7, 'count', 3)
    const args = getLastArgs() as { data: Record<string, unknown> }
    assert.deepEqual(args.data, { count: { decrement: 3 } })
  })
})

describe('PrismaQueryBuilder — find(id) composes with prior wheres', () => {
  // Regression: find(id) used to call findUnique({ where: { id } }) directly,
  // ignoring the chain. `User.where('tenantId', t).find(5)` returned rows
  // across tenants — cross-tenant data leak by default. find() now uses
  // findFirst with an AND-composed where.

  function makeFindCapturingClient() {
    let lastArgs: { where?: Record<string, unknown>; include?: unknown } = {}
    let findFirstCalls = 0
    let findUniqueCalls = 0
    const delegate = {
      findMany:   async (args: { where?: Record<string, unknown>; include?: unknown }) => { lastArgs = args; return [] },
      findFirst:  async (args: { where?: Record<string, unknown>; include?: unknown }) => {
        findFirstCalls++
        lastArgs = args
        return null
      },
      findUnique: async (args: { where?: Record<string, unknown>; include?: unknown }) => {
        findUniqueCalls++
        lastArgs = args
        return null
      },
      count:      async () => 0,
      create:     async () => ({}),
      createMany: async () => ({ count: 0 }),
      update:     async () => ({}),
      updateMany: async () => ({ count: 0 }),
      delete:     async () => undefined,
      deleteMany: async () => ({ count: 0 }),
    }
    const fakeClient = { user: delegate, $connect: async () => {}, $disconnect: async () => {} }
    return {
      fakeClient,
      getLastArgs:        () => lastArgs,
      getFindFirstCalls:  () => findFirstCalls,
      getFindUniqueCalls: () => findUniqueCalls,
    }
  }

  it('uses findFirst (not findUnique) so wheres can compose', async () => {
    const { fakeClient, getFindFirstCalls, getFindUniqueCalls } = makeFindCapturingClient()
    const adapter = await prisma({ client: fakeClient }).create()
    await adapter.query('user').find(5)

    assert.equal(getFindFirstCalls(),  1)
    assert.equal(getFindUniqueCalls(), 0)
  })

  it('composes prior where() clauses with the PK match', async () => {
    const { fakeClient, getLastArgs } = makeFindCapturingClient()
    const adapter = await prisma({ client: fakeClient }).create()
    await (adapter.query('user') as never as { where: (col: string, v: unknown) => { find: (id: number) => Promise<unknown> } })
      .where('tenantId', 'a')
      .find(5)

    const where = getLastArgs().where as Record<string, unknown>
    // Composed shape: { AND: [{ id: 5 }, { tenantId: 'a' }] }
    assert.ok(Array.isArray(where['AND']))
    const and = where['AND'] as Record<string, unknown>[]
    assert.ok(and.some(clause => clause['id'] === 5),       'PK match in AND chain')
    assert.ok(and.some(clause => clause['tenantId'] === 'a'), 'where clause in AND chain')
  })

  it('plain find(id) with no chain stays as { id } (no needless AND)', async () => {
    const { fakeClient, getLastArgs } = makeFindCapturingClient()
    const adapter = await prisma({ client: fakeClient }).create()
    await adapter.query('user').find(5)

    const where = getLastArgs().where as Record<string, unknown>
    assert.equal(where['id'], 5)
    assert.equal(where['AND'], undefined, 'no AND wrapper when chain is empty')
  })
})

describe('prisma() factory', () => {
  it('is a function', () => {
    assert.strictEqual(typeof prisma, 'function')
  })

  it('returns an object with a create() method', () => {
    const provider = prisma({})
    assert.strictEqual(typeof provider.create, 'function')
  })

  it('works with empty config', () => {
    assert.doesNotThrow(() => prisma({}))
  })

  it('works with sqlite driver', () => {
    const cfg: PrismaConfig = { driver: 'sqlite', url: 'file:./test.db' }
    assert.doesNotThrow(() => prisma(cfg))
  })

  it('works with postgresql driver', () => {
    const cfg: PrismaConfig = { driver: 'postgresql', url: 'postgresql://localhost/test' }
    assert.doesNotThrow(() => prisma(cfg))
  })

  it('works with libsql driver', () => {
    const cfg: PrismaConfig = { driver: 'libsql', url: 'libsql://localhost' }
    assert.doesNotThrow(() => prisma(cfg))
  })

  it('works with a pre-built client', () => {
    const fakeClient = { $connect: async () => {}, $disconnect: async () => {} }
    assert.doesNotThrow(() => prisma({ client: fakeClient }))
  })

  it('each call to prisma() returns a new provider instance', () => {
    const a = prisma({})
    const b = prisma({})
    assert.notStrictEqual(a, b)
  })
})

describe('DatabaseProvider', () => {
  it('is a class', () => {
    assert.strictEqual(typeof DatabaseProvider, 'function')
    assert.strictEqual(DatabaseProvider.name, 'DatabaseProvider')
  })

  it('can be instantiated', () => {
    const _cfg: DatabaseConfig = {
      default: 'sqlite',
      connections: {
        sqlite: { driver: 'sqlite', url: 'file:./test.db' },
      },
    }
    void _cfg
    assert.doesNotThrow(() => new DatabaseProvider({} as never))
  })
})
