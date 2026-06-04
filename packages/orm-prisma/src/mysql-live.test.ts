// ─── PrismaAdapter — LIVE MySQL round-trip tests ───────────────────────────
//
// Audit P0-2 (docs/plans/2026-06-05-data-layer-test-audit.md) — the MySQL half
// of the orm-prisma live pair; see pg-live.test.ts for the client-generation
// rationale. Connects through @prisma/adapter-mariadb (MySQL wire-compatible;
// the same adapter PrismaAdapter.make's url path uses). Parsed options instead
// of a URL string so we can set allowPublicKeyRetrieval — MySQL 8's default
// caching_sha2_password auth needs it over a non-TLS connection (the CI
// service container).
//
//   MYSQL_TEST_URL=mysql://root:rudder@127.0.0.1:3306/rudder_native_mysql_test pnpm --filter @rudderjs/orm-prisma test

import { describe, it, test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import type { OrmAdapter, TransactionIsolationLevel } from '@rudderjs/contracts'
import { Model, ModelRegistry, transaction } from '@rudderjs/orm'
import { DB } from '@rudderjs/database'
// Side effect: registers the DB facade bridge + transaction runner.
import { prisma, type PrismaConfig } from './index.js'

const MYSQL_URL = process.env['MYSQL_TEST_URL']

const TABLE = 'pr_live_accounts' // pr_live_* — distinct from rudder_* / dz_* live tables

type LiveClient = NonNullable<PrismaConfig['client']> & {
  $executeRawUnsafe(sql: string): Promise<number>
  $disconnect(): Promise<void>
}

type PrismaClientCtor = new (opts: { adapter: unknown }) => unknown

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

if (!MYSQL_URL) {
  test('PrismaAdapter mysql live tests (skipped — set MYSQL_TEST_URL to run)', { skip: true }, () => {})
} else {
  describe('PrismaAdapter (live mysql)', () => {
    let client: LiveClient

    before(async () => {
      // dist-test/mysql-live.test.js → ../fixtures/live/mysql (tsc rootDir is src).
      const schemaPath = fileURLToPath(new URL('../fixtures/live/mysql/schema.prisma', import.meta.url))
      const require_ = createRequire(import.meta.url)
      const prismaCli = require_.resolve('prisma/build/index.js')
      execFileSync(process.execPath, [prismaCli, 'generate', `--schema=${schemaPath}`], {
        stdio: 'pipe',
        env: { ...process.env, CHECKPOINT_DISABLE: '1' },
      })

      const clientUrl = new URL('../fixtures/live/mysql/client/index.js', import.meta.url)
      const mod = (await import(clientUrl.href)) as {
        PrismaClient?: PrismaClientCtor
        default?: { PrismaClient?: PrismaClientCtor }
      }
      const PrismaClient = mod.PrismaClient ?? mod.default?.PrismaClient
      assert.ok(PrismaClient, 'generated client exposes PrismaClient')

      const { PrismaMariaDb } = await import('@prisma/adapter-mariadb')
      const u = new URL(MYSQL_URL)
      client = new PrismaClient({
        adapter: new PrismaMariaDb({
          host:     u.hostname,
          port:     u.port ? Number(u.port) : 3306,
          user:     decodeURIComponent(u.username),
          password: decodeURIComponent(u.password),
          database: u.pathname.replace(/^\//, ''),
          allowPublicKeyRetrieval: true,
        }),
      }) as LiveClient

      await client.$executeRawUnsafe(`DROP TABLE IF EXISTS ${TABLE}`)
      await client.$executeRawUnsafe(
        `CREATE TABLE ${TABLE} (
           id INT AUTO_INCREMENT PRIMARY KEY,
           name VARCHAR(191) NOT NULL UNIQUE,
           active TINYINT(1) NOT NULL DEFAULT 1,
           age INT NOT NULL DEFAULT 0
         )`,
      )

      ModelRegistry.reset()
      ModelRegistry.set(await prisma({ client, driver: 'mysql' }).create())
    })

    after(async () => {
      await client.$executeRawUnsafe(`DROP TABLE IF EXISTS ${TABLE}`)
      await client.$disconnect()
    })

    beforeEach(async () => {
      await client.$executeRawUnsafe(`TRUNCATE TABLE ${TABLE}`)
    })

    it('create() inserts and returns the AUTO_INCREMENT id', async () => {
      const a = await Account.create({ name: 'Ada', active: true, age: 36 })
      assert.ok(a instanceof Account)
      assert.strictEqual(typeof a.id, 'number')
      assert.strictEqual(a.name, 'Ada')
      assert.strictEqual(a.age, 36)
    })

    it('TINYINT(1) round-trips as a JS boolean through the client', async () => {
      // The Prisma schema types `active` as Boolean → mysql TINYINT(1); the
      // client converts on read. This is the mysql-specific type seam the
      // sqlite unit tests can't see.
      const created = await Account.create({ name: 'Bool', active: false, age: 1 })
      const found = await Account.find(created.id)
      assert.strictEqual(found?.active, false)
      await adapter().query('prLiveAccount').update(created.id, { active: true })
      assert.strictEqual((await Account.find(created.id))?.active, true)
    })

    it('round-trips a read back through find()', async () => {
      const created = await Account.create({ name: 'Grace', active: false, age: 85 })
      const found = await Account.find(created.id)
      assert.strictEqual(found?.name, 'Grace')
      assert.strictEqual(found?.age, 85)
    })

    it('update() and delete() work via the adapter query builder', async () => {
      const a = await Account.create({ name: 'Linus', active: true, age: 30 })
      await adapter().query('prLiveAccount').update(a.id, { age: 31 })
      assert.strictEqual((await Account.find(a.id))?.age, 31)
      await adapter().query('prLiveAccount').delete(a.id)
      assert.strictEqual(await Account.find(a.id), null)
    })

    it('applies the TINYINT(1) default(1) at the DB level', async () => {
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
      // `SELECT @@transaction_isolation` is the WRONG probe on mysql: the
      // un-scoped SET TRANSACTION form is one-shot and BEGIN consumes it, so
      // the variable reports the session default inside the transaction even
      // though the transaction IS running at the requested level. Read the
      // ACTIVE transaction's level from the performance schema instead — the
      // transaction instrument is enabled by default on MySQL 8 (the CI
      // image). Same probe as the native engine's transaction-isolation suite.
      const ACTIVE_LEVEL_SQL =
        'SELECT ISOLATION_LEVEL AS iso FROM performance_schema.events_transactions_current ' +
        "WHERE THREAD_ID = PS_CURRENT_THREAD_ID() AND STATE = 'ACTIVE'"

      // events_transactions_current reports space-separated upper-case
      // ('REPEATABLE READ').
      const mysqlName = (level: TransactionIsolationLevel): string => level.toUpperCase()

      async function activeLevel(): Promise<string> {
        const rows = await DB.select(ACTIVE_LEVEL_SQL)
        assert.equal(rows.length, 1, 'expected one ACTIVE instrumented transaction on this thread')
        return String(rows[0]?.['iso'])
      }

      const ALL_LEVELS: TransactionIsolationLevel[] = [
        'read uncommitted', 'read committed', 'repeatable read', 'serializable',
      ]

      for (const level of ALL_LEVELS) {
        it(`'${level}' is in effect inside the transaction`, async () => {
          const seen = await transaction(async () => activeLevel(), { isolationLevel: level })
          assert.strictEqual(seen, mysqlName(level))
        })
      }

      it('does not leak the level past the transaction', async () => {
        const defaultLevel = await transaction(async () => activeLevel())
        await transaction(async () => {}, { isolationLevel: 'serializable' })
        const seen = await transaction(async () => activeLevel())
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
