// ─── PostgresDriver — LIVE round-trip tests ────────────────
//
// Gated on PG_TEST_URL: when unset (most local runs / CI without a pg service)
// a single skipped placeholder registers and nothing connects. When set, the
// full suite runs against a real Postgres, exercising the dialect + driver
// end-to-end through the same Model surface the SQLite conformance tests use —
// the dialect-agnostic Model suite IS the conformance suite (cross-phase rule 1).
//
//   createdb rudder_native_pg_test
//   PG_TEST_URL=postgres://localhost:5432/rudder_native_pg_test pnpm --filter @rudderjs/orm test

import { describe, it, test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import type { OrmAdapter } from '@rudderjs/contracts'
import { Model, ModelRegistry } from '../../index.js'
import { NativeAdapter } from '../adapter.js'
import { PostgresDriver } from './postgres.js'
import { PgDialect } from '../dialect-pg.js'
import { SchemaBuilder } from '../schema/schema-builder.js'
import { Blueprint } from '../schema/blueprint.js'

const PG_URL = process.env['PG_TEST_URL']

class Account extends Model {
  static override table = 'rudder_pg_accounts'
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

if (!PG_URL) {
  test('PostgresDriver live tests (skipped — set PG_TEST_URL to run)', { skip: true }, () => {})
} else {
  describe('PostgresDriver (live)', () => {
    let driver: PostgresDriver
    let schema: SchemaBuilder

    before(async () => {
      driver = await PostgresDriver.open({ url: PG_URL })
      schema = new SchemaBuilder(driver, new PgDialect())
    })

    after(async () => {
      await schema.dropIfExists('rudder_pg_accounts')
      await driver.close()
    })

    beforeEach(async () => {
      // Rebuild the table through the REAL pg DDL compiler each test — proves the
      // emitted CREATE TABLE / column types are valid Postgres, not just well-shaped.
      await schema.dropIfExists('rudder_pg_accounts')
      await schema.create('rudder_pg_accounts', (t: Blueprint) => {
        t.id()
        t.string('name').unique()   // unique → upsert conflict target
        t.boolean('active').default(true)
        t.integer('age').default(0)
      })
      ModelRegistry.reset()
      ModelRegistry.set(await NativeAdapter.make({ driverInstance: driver, dialect: new PgDialect() }))
    })

    it('connects and runs raw SQL', async () => {
      const rows = await driver.execute('select 1 as one', [])
      assert.strictEqual(Number(rows[0]?.['one']), 1)
    })

    it('SchemaBuilder.create built a real table (hasTable / hasColumn)', async () => {
      assert.strictEqual(await schema.hasTable('rudder_pg_accounts'), true)
      assert.strictEqual(await schema.hasColumn('rudder_pg_accounts', 'name'), true)
      assert.strictEqual(await schema.hasColumn('rudder_pg_accounts', 'nope'), false)
    })

    it('create() inserts and returns the bigserial-generated id', async () => {
      const a = await Account.create({ name: 'Ada', active: true, age: 36 })
      assert.ok(a instanceof Account)
      assert.strictEqual(typeof a.id, 'number')
      assert.strictEqual(a.name, 'Ada')
      assert.strictEqual(a.active, true)   // pg boolean round-trips as JS boolean
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
      await adapter().query('rudder_pg_accounts').update(a.id, { age: 31 })
      assert.strictEqual((await Account.find(a.id))?.age, 31)
      await adapter().query('rudder_pg_accounts').delete(a.id)
      assert.strictEqual(await Account.find(a.id), null)
    })

    it('upsert() inserts then updates on ON CONFLICT (real pg)', async () => {
      await Account.create({ name: 'Ada', active: true, age: 1 })
      const n = await Account.upsert(
        [{ name: 'Ada', active: false, age: 99 }, { name: 'Cleo', active: true, age: 5 }],
        'name', ['age'],
      )
      assert.strictEqual(n, 2)                 // 1 updated + 1 inserted, RETURNING both
      const ada = (await Account.where('name', 'Ada').first())!
      assert.strictEqual(ada.age, 99)          // age in update list → overwritten
      assert.strictEqual(ada.active, true)     // active not in update list → unchanged
      assert.strictEqual((await Account.where('name', 'Cleo').first())!.age, 5)
    })

    it('applies the boolean default(true) at the DB level', async () => {
      // Insert without `active` → the pg DEFAULT true (rendered by booleanLiteral) applies.
      await adapter().query('rudder_pg_accounts').create({ name: 'Defaulted', age: 1 })
      const row = await Account.where('name', 'Defaulted').first()
      assert.strictEqual(row?.active, true)
    })

    describe('transactions', () => {
      it('commits on success', async () => {
        await adapter().transaction!(async (tx) => {
          await tx.query('rudder_pg_accounts').create({ name: 'Committed', active: true, age: 1 })
        })
        assert.ok(await Account.where('name', 'Committed').first())
      })

      it('rolls back on throw', async () => {
        await assert.rejects(adapter().transaction!(async (tx) => {
          await tx.query('rudder_pg_accounts').create({ name: 'RolledBack', active: true, age: 1 })
          throw new Error('boom')
        }))
        assert.strictEqual(await Account.where('name', 'RolledBack').first(), null)
      })

      it('nested savepoint rolls back the inner only', async () => {
        await adapter().transaction!(async (tx) => {
          await tx.query('rudder_pg_accounts').create({ name: 'Outer', active: true, age: 1 })
          await assert.rejects(tx.transaction!(async (inner) => {
            await inner.query('rudder_pg_accounts').create({ name: 'Inner', active: true, age: 1 })
            throw new Error('inner boom')
          }))
        })
        assert.ok(await Account.where('name', 'Outer').first(), 'outer should persist')
        assert.strictEqual(await Account.where('name', 'Inner').first(), null, 'inner should roll back')
      })
    })

    describe('Postgres-specific column types compile + execute', () => {
      it('creates a table with jsonb / timestamptz / uuid / numeric / bytea', async () => {
        await schema.dropIfExists('rudder_pg_types')
        await schema.create('rudder_pg_types', (t: Blueprint) => {
          t.id()
          t.json('meta')
          t.timestamp('seen_at').nullable()
          t.uuid('ext_id').nullable()
          t.decimal('amount', 12, 2).nullable()
          t.binary('blob').nullable()
        })
        // Confirm pg accepted the emitted types by reading the catalog.
        const cols = await driver.execute(
          `select column_name, data_type from information_schema.columns where table_name = $1 order by column_name`,
          ['rudder_pg_types'],
        )
        const byName = new Map(cols.map((c) => [String(c['column_name']), String(c['data_type'])]))
        assert.strictEqual(byName.get('meta'), 'jsonb')
        assert.strictEqual(byName.get('seen_at'), 'timestamp with time zone')
        assert.strictEqual(byName.get('ext_id'), 'uuid')
        assert.strictEqual(byName.get('amount'), 'numeric')
        assert.strictEqual(byName.get('blob'), 'bytea')
        assert.strictEqual(byName.get('id'), 'bigint') // bigserial → bigint storage
        await schema.dropIfExists('rudder_pg_types')
      })
    })

    describe('bound string timestamps store verbatim (TZ regression)', () => {
      // porsager's default `date` type serializer round-trips every bound value
      // through `new Date(x).toISOString()` — a plain 'YYYY-MM-DD HH:MM:SS'
      // string parsed as MACHINE-LOCAL time, so bound string timestamps stored
      // TZ-shifted on any non-UTC machine (CI is UTC, which hid it). The driver
      // overrides the type so strings pass through verbatim. This pins it:
      // the assertions compare SERVER-SIDE text, so they fail on a shift
      // regardless of the machine's TZ.
      it('a bound string lands in a TIMESTAMP column unshifted', async () => {
        await driver.execute(`DROP TABLE IF EXISTS rudder_pg_tz_regress`, [])
        await driver.execute(`CREATE TABLE rudder_pg_tz_regress (ts TIMESTAMP, d DATE)`, [])
        await driver.execute(
          `INSERT INTO rudder_pg_tz_regress (ts, d) VALUES ($1, $2)`,
          ['2026-01-20 11:20:45', '2026-01-15'],
        )
        const rows = await driver.execute(
          `SELECT ts::text AS ts, d::text AS d FROM rudder_pg_tz_regress`, [],
        )
        assert.strictEqual(rows[0]!['ts'], '2026-01-20 11:20:45')
        assert.strictEqual(rows[0]!['d'], '2026-01-15')
        await driver.execute(`DROP TABLE rudder_pg_tz_regress`, [])
      })

      it('a Date object still stores the same instant in TIMESTAMPTZ', async () => {
        await driver.execute(`DROP TABLE IF EXISTS rudder_pg_tz_regress2`, [])
        await driver.execute(`CREATE TABLE rudder_pg_tz_regress2 (tstz TIMESTAMPTZ)`, [])
        await driver.execute(
          `INSERT INTO rudder_pg_tz_regress2 (tstz) VALUES ($1)`,
          [new Date('2026-01-20T09:20:45.000Z')],
        )
        const rows = await driver.execute(
          `SELECT (tstz AT TIME ZONE 'UTC')::text AS u FROM rudder_pg_tz_regress2`, [],
        )
        assert.strictEqual(rows[0]!['u'], '2026-01-20 09:20:45')
        await driver.execute(`DROP TABLE rudder_pg_tz_regress2`, [])
      })
    })
  })
}
