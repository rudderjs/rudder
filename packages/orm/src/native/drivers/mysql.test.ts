// ─── MysqlDriver — LIVE round-trip tests ───────────────────
//
// Gated on MYSQL_TEST_URL: when unset (most local runs / CI without a mysql
// service) a single skipped placeholder registers and nothing connects. When
// set, the full suite runs against a real MySQL, exercising the dialect + driver
// end-to-end through the same Model surface the SQLite/Postgres conformance
// tests use — the dialect-agnostic Model suite IS the conformance suite.
//
// MySQL has no RETURNING, so this proves the query builder's no-RETURNING write
// path (insertId on create, re-SELECT on update/increment) against a real server.
//
//   docker run --rm -e MYSQL_ROOT_PASSWORD=rudder -e MYSQL_DATABASE=rudder_native_mysql_test -p 3306:3306 mysql:8
//   MYSQL_TEST_URL="mysql://root:rudder@localhost:3306/rudder_native_mysql_test" pnpm --filter @rudderjs/orm test

import { describe, it, test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import type { OrmAdapter } from '@rudderjs/contracts'
import { Model, ModelRegistry } from '../../index.js'
import { NativeAdapter } from '@rudderjs/database/native'
import { MysqlDriver } from '@rudderjs/database/native'
import { MysqlDialect } from '@rudderjs/database/native'
import { SchemaBuilder } from '@rudderjs/database/native'
import { Blueprint } from '@rudderjs/database/native'

const MYSQL_URL = process.env['MYSQL_TEST_URL']

class Account extends Model {
  static override table = 'rudder_mysql_accounts'
  // tinyint(1) round-trips as 0/1 — a boolean cast surfaces it as a JS boolean.
  static override casts = { active: 'boolean' as const }
  id!: number
  name!: string
  active!: boolean
  age!: number
}

/** The registered adapter, narrowed to non-null for the live tests. */
function adapter(): OrmAdapter {
  const a = ModelRegistry.get()
  assert.ok(a, 'expected a registered adapter')
  return a
}

if (!MYSQL_URL) {
  test('MysqlDriver live tests (skipped — set MYSQL_TEST_URL to run)', { skip: true }, () => {})
} else {
  describe('MysqlDriver (live)', () => {
    let driver: MysqlDriver
    let schema: SchemaBuilder

    before(async () => {
      driver = await MysqlDriver.open({ url: MYSQL_URL })
      schema = new SchemaBuilder(driver, new MysqlDialect())
    })

    after(async () => {
      await schema.dropIfExists('rudder_mysql_accounts')
      await driver.close()
    })

    beforeEach(async () => {
      // Rebuild the table through the REAL mysql DDL compiler each test — proves
      // the emitted CREATE TABLE / column types are valid MySQL, not just well-shaped.
      await schema.dropIfExists('rudder_mysql_accounts')
      await schema.create('rudder_mysql_accounts', (t: Blueprint) => {
        t.id()
        t.string('name').unique()   // unique → upsert ON DUPLICATE KEY target
        t.boolean('active').default(true)
        t.integer('age').default(0)
      })
      ModelRegistry.reset()
      ModelRegistry.set(await NativeAdapter.make({ driverInstance: driver, dialect: new MysqlDialect() }))
    })

    it('connects and runs raw SQL', async () => {
      const rows = await driver.execute('select 1 as one', [])
      assert.strictEqual(Number(rows[0]?.['one']), 1)
    })

    it('SchemaBuilder.create built a real table (hasTable / hasColumn)', async () => {
      assert.strictEqual(await schema.hasTable('rudder_mysql_accounts'), true)
      assert.strictEqual(await schema.hasColumn('rudder_mysql_accounts', 'name'), true)
      assert.strictEqual(await schema.hasColumn('rudder_mysql_accounts', 'nope'), false)
    })

    it('create() inserts and returns the AUTO_INCREMENT id (no RETURNING)', async () => {
      const a = await Account.create({ name: 'Ada', active: true, age: 36 })
      assert.ok(a instanceof Account)
      assert.strictEqual(typeof a.id, 'number')
      assert.ok(a.id > 0)
      assert.strictEqual(a.name, 'Ada')
      assert.strictEqual(a.active, true)
      assert.strictEqual(a.age, 36)
    })

    it('round-trips a read back through find()', async () => {
      const created = await Account.create({ name: 'Grace', active: false, age: 85 })
      const found = await Account.find(created.id)
      assert.strictEqual(found?.name, 'Grace')
      assert.strictEqual(found?.active, false)  // tinyint(1) 0 → boolean false via cast
      assert.strictEqual(found?.age, 85)
    })

    it('update() and delete() work via the adapter query builder (re-SELECT path)', async () => {
      const a = await Account.create({ name: 'Linus', active: true, age: 30 })
      const updated = await adapter().query<Account>('rudder_mysql_accounts').update(a.id, { age: 31 })
      assert.strictEqual(Number(updated.age), 31)             // returned via re-SELECT
      assert.strictEqual((await Account.find(a.id))?.age, 31)
      await adapter().query('rudder_mysql_accounts').delete(a.id)
      assert.strictEqual(await Account.find(a.id), null)
    })

    it('upsert() inserts then updates on ON DUPLICATE KEY (real mysql, no RETURNING)', async () => {
      await Account.create({ name: 'Ada', active: true, age: 1 })
      // MySQL counts 1 per insert + 2 per ON DUPLICATE KEY update, so assert on
      // resulting data, not the affected-rows number (documented quirk).
      await Account.upsert(
        [{ name: 'Ada', active: false, age: 99 }, { name: 'Cleo', active: true, age: 5 }],
        'name', ['age'],
      )
      const ada = (await Account.where('name', 'Ada').first())!
      assert.strictEqual(Number(ada.age), 99)        // age in update list → overwritten
      assert.strictEqual(ada.active, true)           // active not in update list → unchanged
      assert.strictEqual(Number((await Account.where('name', 'Cleo').first())!.age), 5)
      assert.strictEqual(await Account.count(), 2)    // 1 updated, 1 inserted — no dupes
    })

    it('increment() re-SELECTs the updated row', async () => {
      const a = await Account.create({ name: 'Counter', active: true, age: 1 })
      const bumped = await adapter().query<Account>('rudder_mysql_accounts').increment(a.id, 'age', 5)
      assert.strictEqual(Number(bumped.age), 6)
    })

    it('applies the boolean default(true) at the DB level', async () => {
      // Insert without `active` → the mysql DEFAULT 1 (rendered by booleanLiteral) applies.
      await adapter().query('rudder_mysql_accounts').create({ name: 'Defaulted', age: 1 })
      const row = await Account.where('name', 'Defaulted').first()
      assert.strictEqual(row?.active, true)
    })

    describe('transactions', () => {
      it('commits on success', async () => {
        await adapter().transaction!(async (tx) => {
          await tx.query('rudder_mysql_accounts').create({ name: 'Committed', active: true, age: 1 })
        })
        assert.ok(await Account.where('name', 'Committed').first())
      })

      it('rolls back on throw', async () => {
        await assert.rejects(adapter().transaction!(async (tx) => {
          await tx.query('rudder_mysql_accounts').create({ name: 'RolledBack', active: true, age: 1 })
          throw new Error('boom')
        }))
        assert.strictEqual(await Account.where('name', 'RolledBack').first(), null)
      })

      it('nested savepoint rolls back the inner only', async () => {
        await adapter().transaction!(async (tx) => {
          await tx.query('rudder_mysql_accounts').create({ name: 'Outer', active: true, age: 1 })
          await assert.rejects(tx.transaction!(async (inner) => {
            await inner.query('rudder_mysql_accounts').create({ name: 'Inner', active: true, age: 1 })
            throw new Error('inner boom')
          }))
        })
        assert.ok(await Account.where('name', 'Outer').first(), 'outer should persist')
        assert.strictEqual(await Account.where('name', 'Inner').first(), null, 'inner should roll back')
      })
    })

    describe('MySQL-specific column types compile + execute', () => {
      it('creates a table with json / datetime / char(36) / decimal / blob', async () => {
        await schema.dropIfExists('rudder_mysql_types')
        await schema.create('rudder_mysql_types', (t: Blueprint) => {
          t.id()
          t.json('meta')
          t.timestamp('seen_at').nullable()
          t.uuid('ext_id').nullable()
          t.decimal('amount', 12, 2).nullable()
          t.binary('blob').nullable()
        })
        // Confirm mysql accepted the emitted types by reading information_schema.
        const cols = await driver.execute(
          `select column_name, data_type from information_schema.columns ` +
          `where table_schema = DATABASE() and table_name = ? order by column_name`,
          ['rudder_mysql_types'],
        )
        const byName = new Map(cols.map((c) => [String(c['column_name'] ?? c['COLUMN_NAME']), String(c['data_type'] ?? c['DATA_TYPE'])]))
        assert.strictEqual(byName.get('meta'), 'json')
        assert.strictEqual(byName.get('seen_at'), 'timestamp')
        assert.strictEqual(byName.get('ext_id'), 'char')
        assert.strictEqual(byName.get('amount'), 'decimal')
        assert.strictEqual(byName.get('blob'), 'blob')
        assert.strictEqual(byName.get('id'), 'bigint')
        await schema.dropIfExists('rudder_mysql_types')
      })
    })
  })
}
