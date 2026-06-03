import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { prisma, type PrismaConfig } from './index.js'

/** Build an adapter through the public provider and expose its live client. */
async function makeAdapter(cfg: PrismaConfig): Promise<{ prisma: unknown }> {
  return (await prisma(cfg).create()) as unknown as { prisma: unknown }
}

// ─── Dev HMR: PrismaClient reuse across re-boots ───────────
//
// Regression for the "wedged empty ORM path" residual in
// docs/plans/2026-05-24-hmr-reboot-window-serves-half-booted-responses.md.
//
// Before the fix, every dev re-boot ran PrismaAdapter.make() → built a fresh
// PrismaClient + opened a new driver connection, never disconnecting the old
// one. These tests pin the lifecycle contract that closes that leak:
//   1. same connection signature  → reuse the live client (no new connection)
//   2. changed signature          → fresh client + disconnect the superseded one
//   3. an app-supplied config.client opts out of the cache entirely
//
// We inject a fake PrismaClient constructor via `config.PrismaClient` so make()
// builds without a generated client or running DB. The sqlite driver adapter
// still constructs against an in-memory url (cache misses only) — cheap, no file.

const CACHE_KEY = '__rudderjs_prisma_client__'
const G = globalThis as Record<string, unknown>

const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

/** A counting fake PrismaClient class: records construction + $disconnect calls. */
function fakePrismaClientClass() {
  const built: Array<{ disconnected: boolean }> = []
  class FakeClient {
    disconnected = false
    constructor(public opts: Record<string, unknown>) { built.push(this) }
    async $connect(): Promise<void> {}
    async $disconnect(): Promise<void> { this.disconnected = true }
    [k: string]: unknown
  }
  return { FakeClient: FakeClient as unknown as NonNullable<PrismaConfig['PrismaClient']>, built }
}

describe('PrismaAdapter.make — dev HMR client reuse', () => {
  beforeEach(() => { delete G[CACHE_KEY] })

  it('reuses one client across re-boots with the same connection signature', async () => {
    const { FakeClient, built } = fakePrismaClientClass()
    const cfg: PrismaConfig = { driver: 'sqlite', url: ':memory:', PrismaClient: FakeClient }

    const a1 = await makeAdapter(cfg)
    const a2 = await makeAdapter(cfg) // simulates the next dev re-boot

    assert.equal(built.length, 1, 'second re-boot must NOT build a new PrismaClient')
    assert.strictEqual(a2.prisma, a1.prisma, 'both adapters wrap the same live client')
  })

  it('builds a fresh client and disconnects the superseded one when the signature changes', async () => {
    const { FakeClient, built } = fakePrismaClientClass()

    // The provider always passes the connection NAME (multi-connection: the
    // cache keys per name so a config edit disposes only that connection's
    // superseded client — the leak-fix lifecycle this test pins lives on the
    // named/provider path). Unnamed standalone make() keys by signature and
    // has no supersede semantics — see connections.test.ts.
    const a1 = await makeAdapter({ driver: 'sqlite', url: ':memory:', connectionName: 'main', PrismaClient: FakeClient })
    const a2 = await makeAdapter({ driver: 'sqlite', url: 'file:./other.db', connectionName: 'main', PrismaClient: FakeClient })
    await settle() // the superseded $disconnect() is fire-and-forget on a microtask

    assert.equal(built.length, 2, 'a changed connection url builds a new client')
    assert.notStrictEqual(a2.prisma, a1.prisma, 'the new adapter wraps a different client')
    assert.equal((built[0] as { disconnected: boolean }).disconnected, true, 'old client was disconnected')
    assert.equal((built[1] as { disconnected: boolean }).disconnected, false, 'new client stays connected')
  })

  it('does not cache or reuse an app-supplied config.client', async () => {
    const clientA = { $connect: async () => {}, $disconnect: async () => {} } as unknown as NonNullable<PrismaConfig['client']>
    const clientB = { $connect: async () => {}, $disconnect: async () => {} } as unknown as NonNullable<PrismaConfig['client']>

    const a1 = await makeAdapter({ client: clientA })
    const a2 = await makeAdapter({ client: clientB })

    assert.strictEqual(a1.prisma, clientA, 'passes through the supplied client untouched')
    assert.strictEqual(a2.prisma, clientB, 'a second supplied client is not replaced by a cached one')
    assert.equal(G[CACHE_KEY], undefined, 'config.client path leaves the reuse cache empty')
  })
})
