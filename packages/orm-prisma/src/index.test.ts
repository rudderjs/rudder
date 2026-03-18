import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { prisma, database, type PrismaConfig, type DatabaseConfig } from './index.js'

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
    update:     async () => ({}),
    delete:     async () => undefined,
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

describe('database() factory', () => {
  it('is a function', () => {
    assert.strictEqual(typeof database, 'function')
  })

  it('returns a constructor (class)', () => {
    const Provider = database()
    assert.strictEqual(typeof Provider, 'function')
  })

  it('works with a full DatabaseConfig', () => {
    const cfg: DatabaseConfig = {
      default: 'sqlite',
      connections: {
        sqlite: { driver: 'sqlite', url: 'file:./test.db' },
      },
    }
    assert.doesNotThrow(() => database(cfg))
  })

  it('each call to database() returns a different class', () => {
    const A = database()
    const B = database()
    assert.notStrictEqual(A, B)
  })
})
