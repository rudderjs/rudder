// Named connections on the Prisma adapter (multi-connection Task 4).
//
// The provider registers a LAZY ConnectionManager factory per connection it
// claims (skipping other-engine connections), the dev-HMR client cache keys
// per connection name, and read/write-split config fails loudly at boot with
// a pointer to @prisma/extension-read-replicas.

import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { ConfigRepository, setConfigRepository } from '@rudderjs/core'
import type { Application } from '@rudderjs/core'
import { ModelRegistry, ConnectionManager } from '@rudderjs/orm'
import { DatabaseProvider, prisma, type PrismaConfig } from './index.js'

const CACHE_KEY = '__rudderjs_prisma_client__'
const G = globalThis as Record<string, unknown>
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

/** Build an adapter through the public provider factory. */
async function makeAdapter(cfg: PrismaConfig): Promise<{ prisma: unknown }> {
  return (await prisma(cfg).create()) as unknown as { prisma: unknown }
}

/** A counting fake PrismaClient class: records construction + $disconnect calls. */
function fakePrismaClientClass() {
  const built: Array<{ disconnected: boolean; opts: Record<string, unknown> }> = []
  class FakeClient {
    disconnected = false
    constructor(public opts: Record<string, unknown>) { built.push(this) }
    async $connect(): Promise<void> {}
    async $disconnect(): Promise<void> { this.disconnected = true }
    [k: string]: unknown
  }
  return { FakeClient: FakeClient as unknown as NonNullable<PrismaConfig['PrismaClient']>, built }
}

function fakeApp(): Application {
  return { instance: () => {} } as unknown as Application
}

beforeEach(() => {
  delete G[CACHE_KEY]
  delete G['__rudderjs_orm_connections__']
  ModelRegistry.reset()
})

describe('PrismaAdapter.make — per-connection client cache', () => {
  it('two NAMED connections coexist (neither evicts the other)', async () => {
    const { FakeClient, built } = fakePrismaClientClass()

    const a = await makeAdapter({ driver: 'sqlite', url: 'file:a.db', connectionName: 'a', PrismaClient: FakeClient })
    const b = await makeAdapter({ driver: 'sqlite', url: 'file:b.db', connectionName: 'b', PrismaClient: FakeClient })
    await settle()

    assert.equal(built.length, 2)
    assert.notStrictEqual(a.prisma, b.prisma)
    assert.equal(built[0]!.disconnected, false, "'b' must not evict 'a' (the old single-slot cache did)")
  })

  it('a config edit supersedes ONLY that connection (per-name dispose)', async () => {
    const { FakeClient, built } = fakePrismaClientClass()

    await makeAdapter({ driver: 'sqlite', url: 'file:a.db', connectionName: 'a', PrismaClient: FakeClient })
    await makeAdapter({ driver: 'sqlite', url: 'file:b.db', connectionName: 'b', PrismaClient: FakeClient })
    // Re-boot with a changed url for 'a' (HMR config edit).
    await makeAdapter({ driver: 'sqlite', url: 'file:a2.db', connectionName: 'a', PrismaClient: FakeClient })
    await settle()

    assert.equal(built.length, 3)
    assert.equal(built[0]!.disconnected, true, "superseded 'a' client disconnected")
    assert.equal(built[1]!.disconnected, false, "'b' untouched")
  })

  it('same name + unchanged signature reuses the live client (re-boot fast path)', async () => {
    const { FakeClient, built } = fakePrismaClientClass()
    const cfg: PrismaConfig = { driver: 'sqlite', url: 'file:a.db', connectionName: 'a', PrismaClient: FakeClient }

    const first  = await makeAdapter(cfg)
    const second = await makeAdapter(cfg)

    assert.equal(built.length, 1)
    assert.strictEqual(second.prisma, first.prisma)
  })
})

describe('Prisma DatabaseProvider — named-connection factories', () => {
  it('registers lazy factories for claimed connections; default opens eagerly through the manager', async () => {
    const { FakeClient, built } = fakePrismaClientClass()
    setConfigRepository(new ConfigRepository({ database: {
      default: 'main',
      connections: {
        main:      { driver: 'sqlite', url: 'file:main.db' },
        reporting: { driver: 'sqlite', url: 'file:reporting.db' },
        // Claimed by the native engine — must NOT be registered here.
        nativeOne: { engine: 'native', driver: 'pg', url: 'postgres://x' },
      },
      PrismaClient: FakeClient,
    } }))

    await new DatabaseProvider(fakeApp()).boot()

    assert.equal(ConnectionManager.defaultName(), 'main')
    assert.deepEqual(ConnectionManager.names().sort(), ['main', 'reporting'])
    assert.strictEqual(ConnectionManager.peek('main'), ModelRegistry.get(), 'default shared with Models')
    assert.equal(ConnectionManager.peek('reporting'), null, 'named connection stays lazy')
    assert.equal(built.length, 1, 'exactly one client built at boot')

    const reporting = await ConnectionManager.ensure('reporting')
    assert.ok(reporting, 'named connection resolves an adapter')
    assert.notStrictEqual(reporting, ModelRegistry.get())
    assert.equal(built.length, 2, 'named connection opened on first use')
  })

  it('read/write-split config on a Prisma connection throws at boot with the extension pointer', async () => {
    const { FakeClient } = fakePrismaClientClass()
    setConfigRepository(new ConfigRepository({ database: {
      default: 'main',
      connections: {
        main: { driver: 'sqlite', url: 'file:main.db', read: { url: 'file:r.db' } },
      },
      PrismaClient: FakeClient,
    } }))

    await assert.rejects(
      new DatabaseProvider(fakeApp()).boot(),
      /read\/write splitting is not supported on the Prisma adapter.*@prisma\/extension-read-replicas/s,
    )
  })

})
