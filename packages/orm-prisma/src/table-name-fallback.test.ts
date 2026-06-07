// SQL-table-name → delegate fallback.
//
// `static table` historically had to be the Prisma DELEGATE name (camelCase
// model name) because the adapter does `prisma[table]` — but on the native
// engine the same field is the literal SQL table name, so one package model
// couldn't run on both adapters (cashier-paddle was the trigger:
// docs/plans/2026-06-07-cashier-paddle-native-engine.md). Models may now carry
// the real SQL name: when no delegate property matches, the adapter resolves
// through the client's runtime datamodel (`_runtimeDataModel.models`) — the
// model whose `dbName` (`@@map`; `null` = unmapped, model name IS the table)
// equals the requested table wins, delegate = lower-camelCased model name.
// Direct delegate-name lookups stay the fast path (back-compat).

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { prisma, type PrismaConfig } from './index.js'
import type { QueryBuilder } from '@rudderjs/contracts'

function makeDelegate() {
  const calls: Array<{ method: string; args: unknown }> = []
  return {
    calls,
    delegate: {
      findMany:   async (args: unknown = {}) => { calls.push({ method: 'findMany', args }); return [] as unknown[] },
      findFirst:  async () => null,
      findUnique: async () => null,
      count:      async () => 0,
      create:     async (args: unknown = {}) => { calls.push({ method: 'create', args }); return {} },
      createMany: async () => ({ count: 0 }),
      update:     async (args: unknown = {}) => { calls.push({ method: 'update', args }); return {} },
      updateMany: async () => ({ count: 0 }),
      delete:     async () => undefined,
      deleteMany: async () => ({ count: 0 }),
    },
  }
}

/** A fake generated client: `paddleCustomer` delegate whose model is
 *  `@@map`'d to `paddle_customers`, plus an unmapped `User` model. */
function makeClient() {
  const paddleCustomer = makeDelegate()
  const user = makeDelegate()
  // `_runtimeDataModel` isn't part of the adapter's structural PrismaClient
  // type (its delegate index signature can't admit it) — cast like a real
  // generated client would be.
  const fakeClient = {
    paddleCustomer: paddleCustomer.delegate,
    user:           user.delegate,
    $connect:    async () => {},
    $disconnect: async () => {},
    _runtimeDataModel: {
      models: {
        PaddleCustomer: { dbName: 'paddle_customers' },
        User:           { dbName: null },
      },
    },
  } as unknown as NonNullable<PrismaConfig['client']>
  return { fakeClient, paddleCustomer, user }
}

describe('PrismaQueryBuilder — SQL-table-name → delegate fallback', () => {
  it('resolves an @@map SQL name to its delegate', async () => {
    const { fakeClient, paddleCustomer } = makeClient()
    const adapter = await prisma({ client: fakeClient }).create()

    await (adapter.query<unknown>('paddle_customers') as QueryBuilder<unknown>)
      .where('billableId', '7')
      .get()

    assert.strictEqual(paddleCustomer.calls.length, 1)
    assert.strictEqual(paddleCustomer.calls[0]!.method, 'findMany')
    assert.deepEqual(
      (paddleCustomer.calls[0]!.args as { where?: unknown }).where,
      { billableId: '7' },
    )
  })

  it('direct delegate-name lookup keeps working (historical contract)', async () => {
    const { fakeClient, paddleCustomer } = makeClient()
    const adapter = await prisma({ client: fakeClient }).create()

    await (adapter.query<unknown>('paddleCustomer') as QueryBuilder<unknown>).get()
    assert.strictEqual(paddleCustomer.calls.length, 1)
  })

  it('an unmapped model resolves by its model name (dbName null → name IS the table)', async () => {
    const { fakeClient, user } = makeClient()
    const adapter = await prisma({ client: fakeClient }).create()

    await (adapter.query<unknown>('User') as QueryBuilder<unknown>).get()
    assert.strictEqual(user.calls.length, 1)
  })

  it('writes route through the resolved delegate too', async () => {
    const { fakeClient, paddleCustomer } = makeClient()
    const adapter = await prisma({ client: fakeClient }).create()

    await (adapter.query<unknown>('paddle_customers') as QueryBuilder<unknown>)
      .create({ billableId: '7' } as Record<string, unknown>)
    assert.strictEqual(paddleCustomer.calls.at(-1)!.method, 'create')
  })

  it('repeated lookups hit the per-client cache (still correct on the 2nd call)', async () => {
    const { fakeClient, paddleCustomer } = makeClient()
    const adapter = await prisma({ client: fakeClient }).create()

    await (adapter.query<unknown>('paddle_customers') as QueryBuilder<unknown>).get()
    await (adapter.query<unknown>('paddle_customers') as QueryBuilder<unknown>).get()
    assert.strictEqual(paddleCustomer.calls.length, 2)
  })

  it('no match → clear error mentioning the @@map check', async () => {
    const { fakeClient } = makeClient()
    const adapter = await prisma({ client: fakeClient }).create()

    await assert.rejects(
      (adapter.query<unknown>('nonexistent_things') as QueryBuilder<unknown>).get(),
      /no delegate for table "nonexistent_things".*@@map/s,
    )
  })

  it('a client WITHOUT _runtimeDataModel (older fakes) still errors clearly', async () => {
    const bare = {
      user: makeDelegate().delegate,
      $connect: async () => {}, $disconnect: async () => {},
    }
    const adapter = await prisma({ client: bare }).create()

    await assert.rejects(
      (adapter.query<unknown>('paddle_customers') as QueryBuilder<unknown>).get(),
      /no delegate for table "paddle_customers"/,
    )
  })
})
