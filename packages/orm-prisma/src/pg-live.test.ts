// ─── PrismaAdapter — LIVE Postgres round-trip tests ────────────────────────
//
// Audit P0-2 (docs/plans/2026-06-05-data-layer-test-audit.md): orm-prisma was
// the only adapter with ZERO live-database coverage — every other suite in
// this package drives a fake PrismaClient. This suite mirrors the native
// engine's drivers/postgres.test.ts shape (Model round-trip: create / find /
// update / delete / upsert / increment / transaction / isolation) against a
// real Postgres through a REAL generated Prisma client + @prisma/adapter-pg.
//
// Client generation: the before() hook runs `prisma generate` over
// fixtures/live/pg/schema.prisma into a gitignored ./client dir, then
// dynamic-imports it. Prisma 7 generation is engine-free (pure TS + bundled
// wasm compiler), so this is offline-safe and takes a few seconds. Chosen over
// committing a prebuilt client because generated code pins the
// @prisma/client-runtime contract of the version that emitted it — a committed
// client goes stale on every Prisma bump and fails in ways unrelated to what
// this suite tests.
//
// Gated on PG_TEST_URL — same convention as every live suite:
//   PG_TEST_URL=postgres://localhost:5432/rudder_native_pg_test pnpm --filter @rudderjs/orm-prisma test

import { describe, it, test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import type { OrmAdapter, TransactionIsolationLevel } from '@rudderjs/contracts'
import { Model, ModelRegistry, transaction } from '@rudderjs/orm'
import { DB } from '@rudderjs/database'
// Side effect: importing the adapter entry registers the DB facade bridge +
// transaction runner (`import '@rudderjs/orm/db-bridge'` at the top of index.ts).
import { prisma, type PrismaConfig } from './index.js'

const PG_URL = process.env['PG_TEST_URL']

const TABLE = 'pr_live_accounts' // pr_live_* — distinct from rudder_* / dz_* live tables

type PrismaClientCtor = NonNullable<PrismaConfig['PrismaClient']>

/** The created adapter, widened to the teardown/raw seams the suite drives. */
type LiveAdapter = OrmAdapter & {
  affectingStatement(sql: string, bindings: readonly unknown[]): Promise<number>
  disconnect(): Promise<void>
}

class Account extends Model {
  static override table = 'prLiveAccount' // Prisma delegate name (NOT the @@map'd SQL name)
  id!: number
  name!: string
  active!: boolean
  age!: number
}

function adapter(): OrmAdapter {
  const a = ModelRegistry.get()
  assert.ok(a, 'expected a registered adapter')
  return a
}

if (!PG_URL) {
  test('PrismaAdapter pg live tests (skipped — set PG_TEST_URL to run)', { skip: true }, () => {})
} else {
  describe('PrismaAdapter (live pg)', () => {
    let live: LiveAdapter

    before(async () => {
      // dist-test/pg-live.test.js → ../fixtures/live/pg (tsc rootDir is src).
      const schemaPath = fileURLToPath(new URL('../fixtures/live/pg/schema.prisma', import.meta.url))
      const require_ = createRequire(import.meta.url)
      const prismaCli = require_.resolve('prisma/build/index.js')
      execFileSync(process.execPath, [prismaCli, 'generate', `--schema=${schemaPath}`], {
        stdio: 'pipe',
        env: { ...process.env, CHECKPOINT_DISABLE: '1' },
      })

      const clientUrl = new URL('../fixtures/live/pg/client/index.js', import.meta.url)
      const mod = (await import(clientUrl.href)) as {
        PrismaClient?: PrismaClientCtor
        default?: { PrismaClient?: PrismaClientCtor }
      }
      const PrismaClient = mod.PrismaClient ?? mod.default?.PrismaClient
      assert.ok(PrismaClient, 'generated client exposes PrismaClient')

      // Drive the REAL make() construction path (PrismaClient class + driver +
      // url → @prisma/adapter-pg over a pg Pool) — the same code an app's
      // config/database.ts goes through, so adapter-construction regressions
      // surface here, not just against hand-built clients.
      live = (await prisma({
        PrismaClient,
        driver: 'postgresql',
        url: PG_URL,
        connectionName: `pr-live-pg-${process.pid}`,
      }).create()) as LiveAdapter

      await live.affectingStatement(`DROP TABLE IF EXISTS ${TABLE}`, [])
      await live.affectingStatement(
        `CREATE TABLE ${TABLE} (
           id SERIAL PRIMARY KEY,
           name TEXT NOT NULL UNIQUE,
           active BOOLEAN NOT NULL DEFAULT true,
           age INTEGER NOT NULL DEFAULT 0
         )`,
        [],
      )

      ModelRegistry.reset()
      ModelRegistry.set(live)
    })

    after(async () => {
      await live.affectingStatement(`DROP TABLE IF EXISTS ${TABLE}`, []).catch(() => {})
      await live.disconnect()
    })

    beforeEach(async () => {
      await live.affectingStatement(`TRUNCATE ${TABLE} RESTART IDENTITY`, [])
    })

    it('create() inserts and returns the serial-generated id', async () => {
      const a = await Account.create({ name: 'Ada', active: true, age: 36 })
      assert.ok(a instanceof Account)
      assert.strictEqual(typeof a.id, 'number')
      assert.strictEqual(a.name, 'Ada')
      assert.strictEqual(a.active, true) // pg boolean round-trips as JS boolean
      assert.strictEqual(a.age, 36)
    })

    it('round-trips a read back through find()', async () => {
      const created = await Account.create({ name: 'Grace', active: false, age: 85 })
      const found = await Account.find(created.id)
      assert.strictEqual(found?.name, 'Grace')
      assert.strictEqual(found?.active, false)
      assert.strictEqual(found?.age, 85)
    })

    it('update() and delete() work via the adapter query builder', async () => {
      const a = await Account.create({ name: 'Linus', active: true, age: 30 })
      await adapter().query('prLiveAccount').update(a.id, { age: 31 })
      assert.strictEqual((await Account.find(a.id))?.age, 31)
      await adapter().query('prLiveAccount').delete(a.id)
      assert.strictEqual(await Account.find(a.id), null)
    })

    it('applies the boolean default(true) at the DB level', async () => {
      await Account.create({ name: 'Defaulted', age: 1 })
      const row = await Account.where('name', 'Defaulted').first()
      assert.strictEqual(row?.active, true)
    })

    it('upsert() inserts then updates through the real delegate', async () => {
      await Account.create({ name: 'Ada', active: true, age: 1 })
      const n = await Account.upsert(
        [{ name: 'Ada', active: false, age: 99 }, { name: 'Cleo', active: true, age: 5 }],
        'name', ['age'],
      )
      assert.strictEqual(n, 2) // 1 updated + 1 inserted
      const ada = (await Account.where('name', 'Ada').first())!
      assert.strictEqual(ada.age, 99)      // age in update list → overwritten
      assert.strictEqual(ada.active, true) // active not in update list → unchanged
      assert.strictEqual((await Account.where('name', 'Cleo').first())!.age, 5)
    })

    it('increment()/decrement() apply atomic ops on the real database', async () => {
      const a = await Account.create({ name: 'Counter', active: true, age: 10 })
      await adapter().query('prLiveAccount').increment(a.id, 'age', 5)
      assert.strictEqual((await Account.find(a.id))?.age, 15)
      await adapter().query('prLiveAccount').decrement(a.id, 'age', 3)
      assert.strictEqual((await Account.find(a.id))?.age, 12)
    })

    describe('transactions ($transaction interactive)', () => {
      it('commits on success', async () => {
        await transaction(async () => {
          await Account.create({ name: 'Committed', active: true, age: 1 })
        })
        assert.ok(await Account.where('name', 'Committed').first())
      })

      it('rolls back on throw', async () => {
        await assert.rejects(transaction(async () => {
          await Account.create({ name: 'RolledBack', active: true, age: 1 })
          throw new Error('boom')
        }), /boom/)
        assert.strictEqual(await Account.where('name', 'RolledBack').first(), null)
      })

      it('nested savepoint rolls back the inner only', async () => {
        await transaction(async () => {
          await Account.create({ name: 'Outer', active: true, age: 1 })
          await assert.rejects(transaction(async () => {
            await Account.create({ name: 'Inner', active: true, age: 1 })
            throw new Error('inner boom')
          }), /inner boom/)
        })
        assert.ok(await Account.where('name', 'Outer').first(), 'outer should persist')
        assert.strictEqual(await Account.where('name', 'Inner').first(), null, 'inner should roll back')
      })
    })

    describe('isolation levels (pass-through to $transaction)', () => {
      // The adapter maps lowercase-ANSI levels to Prisma's PascalCase enum —
      // this is the seam that had never run against a database that accepts
      // isolation levels (the sqlite unit tests throw by design).
      const ALL_LEVELS: TransactionIsolationLevel[] = [
        'read uncommitted', 'read committed', 'repeatable read', 'serializable',
      ]

      for (const level of ALL_LEVELS) {
        it(`'${level}' is in effect inside the transaction`, async () => {
          const seen = await transaction(async () => {
            const rows = await DB.select('SHOW TRANSACTION ISOLATION LEVEL')
            return String(rows[0]?.['transaction_isolation'])
          }, { isolationLevel: level })
          assert.strictEqual(seen, level)
        })
      }

      it('does not leak the level past the transaction', async () => {
        const defaultLevel = await transaction(async () => {
          const rows = await DB.select('SHOW TRANSACTION ISOLATION LEVEL')
          return String(rows[0]?.['transaction_isolation'])
        })
        await transaction(async () => {}, { isolationLevel: 'serializable' })
        const seen = await transaction(async () => {
          const rows = await DB.select('SHOW TRANSACTION ISOLATION LEVEL')
          return String(rows[0]?.['transaction_isolation'])
        })
        assert.strictEqual(seen, defaultLevel)
      })

      it('a nested transaction rejects an isolation level', async () => {
        await transaction(async () => {
          await assert.rejects(
            transaction(async () => {}, { isolationLevel: 'serializable' }),
            /isolationLevel cannot be set on a nested transaction/,
          )
        })
      })
    })
  })
}
