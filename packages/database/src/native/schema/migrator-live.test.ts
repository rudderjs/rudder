// Migrator lifecycle against LIVE Postgres + MySQL — audit P2-11.
//
// `migrator.test.ts` proves run/rollback/refresh/fresh state tracking on
// sqlite only; the live DDL the migrations actually execute (and the
// `migrations` state table itself) had never run on pg/mysql. One shared
// lifecycle scenario — run → idempotent re-run → step rollback → re-apply →
// rollbackAll → fresh sweep — driven per dialect, with an FK parent/child
// pair so `dropAllTables()` exercises the FK-safe path (pg `CASCADE`,
// mysql `FOREIGN_KEY_CHECKS=0`) this PR fixes (it read `sqlite_master`
// unconditionally before, so `migrate:fresh` threw on pg/mysql).
//
// Gated on PG_TEST_URL / MYSQL_TEST_URL (CI's orm-pg / orm-mysql jobs).

import { describe, it, test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { NativeAdapter } from '../adapter.js'
import { PostgresDriver } from '../drivers/postgres.js'
import { MysqlDriver } from '../drivers/mysql.js'
import { PgDialect } from '../dialect-pg.js'
import { MysqlDialect } from '../dialect-mysql.js'
import type { Dialect } from '../dialect.js'
import type { Driver } from '../driver.js'
import { Migration } from './migration.js'
import { Schema } from './schema-facade.js'
import { Migrator, type LoadedMigration } from './migrator.js'

const PG_URL = process.env['PG_TEST_URL']
const MYSQL_URL = process.env['MYSQL_TEST_URL']

class CreateAuthors extends Migration {
  async up()   { await Schema.create('rudder_mig_authors', (t) => { t.id(); t.string('name') }) }
  async down() { await Schema.dropIfExists('rudder_mig_authors') }
}
// Child table with a real FK — makes the fresh sweep prove the FK-safe drop.
class CreateBooks extends Migration {
  async up() {
    await Schema.create('rudder_mig_books', (t) => {
      t.id()
      t.string('title')
      t.foreignId('authorId').constrained('rudder_mig_authors')
    })
  }
  async down() { await Schema.dropIfExists('rudder_mig_books') }
}

const authors = (): LoadedMigration => ({ name: '2026_01_01_000000_create_rudder_mig_authors', migration: new CreateAuthors() })
const books   = (): LoadedMigration => ({ name: '2026_01_02_000000_create_rudder_mig_books', migration: new CreateBooks() })

function defineLifecycle(getAdapter: () => NativeAdapter): void {
  it('runs the full lifecycle: run → re-run → rollback → re-apply → rollbackAll → fresh', async () => {
    const adapter = getAdapter()
    const migrator = new Migrator(adapter)
    const schema = adapter.schemaBuilder()

    // run: both tables created, state recorded in batch 1
    const first = await migrator.run([authors(), books()])
    assert.deepStrictEqual(first.applied, [authors().name, books().name])
    assert.strictEqual(first.batch, 1)
    assert.strictEqual(await schema.hasTable('rudder_mig_authors'), true)
    assert.strictEqual(await schema.hasTable('rudder_mig_books'), true)
    assert.deepStrictEqual(await migrator.ran(), [authors().name, books().name])

    // idempotent re-run
    const second = await migrator.run([authors(), books()])
    assert.deepStrictEqual(second.applied, [])

    // step rollback: child reverted, parent intact
    const rolled = await migrator.rollback([authors(), books()], undefined, { step: 1 })
    assert.deepStrictEqual(rolled.reverted, [books().name])
    assert.strictEqual(await schema.hasTable('rudder_mig_books'), false)
    assert.strictEqual(await schema.hasTable('rudder_mig_authors'), true)

    // re-apply lands in a new batch
    const reapplied = await migrator.run([authors(), books()])
    assert.deepStrictEqual(reapplied.applied, [books().name])
    assert.ok(reapplied.batch > 1)

    // rollbackAll (the refresh unwind): everything down, state empty
    const unwound = await migrator.rollbackAll([authors(), books()])
    assert.deepStrictEqual(unwound, [books().name, authors().name])
    assert.deepStrictEqual(await migrator.ran(), [])
    assert.strictEqual(await schema.hasTable('rudder_mig_authors'), false)

    // fresh: re-apply, then dropAllTables sweeps user tables + the state
    // table despite the FK pair (pg CASCADE / mysql FOREIGN_KEY_CHECKS)
    await migrator.run([authors(), books()])
    await migrator.dropAllTables()
    assert.strictEqual(await migrator.installed(), false)
    assert.strictEqual(await schema.hasTable('rudder_mig_authors'), false)
    assert.strictEqual(await schema.hasTable('rudder_mig_books'), false)

    // and the next run rebuilds from a clean slate
    const fresh = await migrator.run([authors(), books()])
    assert.strictEqual(fresh.batch, 1)
    assert.strictEqual(await schema.hasTable('rudder_mig_books'), true)
  })

  it('allTables() lists user tables incl. the migrations state table', async () => {
    const adapter = getAdapter()
    const migrator = new Migrator(adapter)
    await migrator.run([authors()])
    const tables = await adapter.schemaBuilder().allTables()
    assert.ok(tables.includes('migrations'))
    assert.ok(tables.includes('rudder_mig_authors'))
  })
}

// ─── Live blocks ─────────────────────────────────────────────────────────────
//
// `dropAllTables()` sweeps EVERY table visible to the connection, and test
// files in this package run in parallel against the one shared CI database —
// so each dialect gets an ISOLATED namespace: a dedicated schema on pg
// (`search_path` pinned via porsager's connection options; every catalog read
// in SchemaBuilder filters on current_schema()) and a dedicated database on
// mysql (created via a bootstrap connection; information_schema reads filter
// on DATABASE()).

if (!PG_URL) {
  test('migrator lifecycle pg live tests (skipped — set PG_TEST_URL to run)', { skip: true }, () => {})
} else {
  describe('Migrator lifecycle (live pg)', () => {
    const SCHEMA = 'rudder_mig_live'
    let driver: Driver
    let adapter: NativeAdapter

    before(async () => {
      const bootstrap = await PostgresDriver.open({ url: PG_URL })
      await bootstrap.execute(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`, [])
      await bootstrap.execute(`CREATE SCHEMA ${SCHEMA}`, [])
      await bootstrap.close()
      driver = await PostgresDriver.open({
        url: PG_URL,
        options: { connection: { search_path: SCHEMA } },
      })
      adapter = await NativeAdapter.make({ driverInstance: driver, dialect: new PgDialect() })
    })

    after(async () => {
      await driver.execute(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`, []).catch(() => {})
      await driver.close()
    })

    defineLifecycle(() => adapter)
  })
}

if (!MYSQL_URL) {
  test('migrator lifecycle mysql live tests (skipped — set MYSQL_TEST_URL to run)', { skip: true }, () => {})
} else {
  describe('Migrator lifecycle (live mysql)', () => {
    const DB = 'rudder_mig_live'
    let driver: Driver
    let adapter: NativeAdapter

    before(async () => {
      const bootstrap = await MysqlDriver.open({ url: MYSQL_URL })
      await bootstrap.execute(`DROP DATABASE IF EXISTS ${DB}`, [])
      await bootstrap.execute(`CREATE DATABASE ${DB}`, [])
      await bootstrap.close()
      const url = new URL(MYSQL_URL)
      url.pathname = `/${DB}`
      driver = await MysqlDriver.open({ url: url.toString() })
      adapter = await NativeAdapter.make({ driverInstance: driver, dialect: new MysqlDialect() })
    })

    after(async () => {
      await driver.execute(`DROP DATABASE IF EXISTS ${DB}`, []).catch(() => {})
      await driver.close()
    })

    defineLifecycle(() => adapter)
  })
}
