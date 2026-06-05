// `Schema.table(...)` ALTER paths against LIVE Postgres + MySQL — audit P2-11.
//
// The alter compiler had only compile-shape tests (sqlite-rooted) and the
// sqlite-execution suites; the pg/mysql statements never ran on a real server.
// This suite drives the full supported op set — rename column, add column
// (incl. mysql positional AFTER), add/drop index, ADD/DROP FOREIGN KEY (fixed
// in this PR: FKs were silently dropped on alter; mysql DROP INDEX lacked its
// mandatory `ON <table>`), drop column — and verifies each against the live
// catalog (hasColumn / inspectTable).
//
// Gated on PG_TEST_URL / MYSQL_TEST_URL (CI's orm-pg / orm-mysql jobs).

import { describe, it, test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { PostgresDriver } from '../drivers/postgres.js'
import { MysqlDriver } from '../drivers/mysql.js'
import { PgDialect } from '../dialect-pg.js'
import { MysqlDialect } from '../dialect-mysql.js'
import type { Dialect } from '../dialect.js'
import type { Driver } from '../driver.js'
import { SchemaBuilder } from './schema-builder.js'
import { inspectTable } from './inspect.js'

const PG_URL = process.env['PG_TEST_URL']
const MYSQL_URL = process.env['MYSQL_TEST_URL']

const PARENT = 'rudder_alter_authors'
const TABLE  = 'rudder_alter_books'

function defineScenario(ctx: () => { driver: Driver; dialect: Dialect; schema: SchemaBuilder }): void {
  it('renames, adds, indexes, constrains, and drops live', async () => {
    const { driver, dialect, schema } = ctx()

    // Baseline pair: a parent and the table under alteration.
    await schema.create(PARENT, (t) => { t.id(); t.string('name') })
    await schema.create(TABLE, (t) => { t.id(); t.string('titel'); t.integer('age') })

    // 1. RENAME COLUMN — fix the typo'd column.
    await schema.table(TABLE, (t) => t.renameColumn('titel', 'title'))
    assert.strictEqual(await schema.hasColumn(TABLE, 'title'), true)
    assert.strictEqual(await schema.hasColumn(TABLE, 'titel'), false)

    // 2. ADD COLUMN + per-column index; mysql also proves positional AFTER.
    await schema.table(TABLE, (t) => {
      const col = t.string('isbn').nullable().index()
      if (dialect.name === 'mysql') col.after('title')
    })
    assert.strictEqual(await schema.hasColumn(TABLE, 'isbn'), true)
    let info = (await inspectTable(driver, dialect, TABLE))!
    assert.ok(info.indexes.some(i => i.name === `${TABLE}_isbn_index`), 'isbn index must exist')
    if (dialect.name === 'mysql') {
      // Positional ADD: isbn sits right after title.
      const cols = info.columns.map(c => c.name)
      assert.strictEqual(cols[cols.indexOf('title') + 1], 'isbn')
    }

    // 3. ADD FOREIGN KEY on an existing table (fixed: was silently dropped).
    await schema.table(TABLE, (t) => t.foreignId('authorId').nullable().constrained(PARENT))
    info = (await inspectTable(driver, dialect, TABLE))!
    const fk = info.foreignKeys.find(f => f.columns.includes('authorId'))
    assert.ok(fk, 'FK on authorId must exist after the alter')
    assert.strictEqual(fk!.foreignTable, PARENT)

    // ... and the constraint actually enforces.
    await driver.execute(`INSERT INTO ${dialect.quoteId(PARENT)} (name) VALUES ('Ada')`, [])
    // An orphan authorId must violate the added FK.
    await assert.rejects(
      driver.execute(
        `INSERT INTO ${dialect.quoteId(TABLE)} (title, ${dialect.quoteId('authorId')}) VALUES ('ghost', 999999)`,
        [],
      ),
    )

    // 4. DROP FOREIGN KEY (pg DROP CONSTRAINT / mysql DROP FOREIGN KEY).
    await schema.table(TABLE, (t) => t.dropForeign(['authorId']))
    info = (await inspectTable(driver, dialect, TABLE))!
    assert.ok(!info.foreignKeys.some(f => f.columns.includes('authorId')), 'FK must be gone')

    // 5. DROP INDEX (mysql requires the table-scoped form — fixed).
    await schema.table(TABLE, (t) => t.dropIndex(`${TABLE}_isbn_index`))
    info = (await inspectTable(driver, dialect, TABLE))!
    assert.ok(!info.indexes.some(i => i.name === `${TABLE}_isbn_index`), 'isbn index must be gone')

    // 6. CHANGE COLUMN (7.4b) — int → bigint, NOT NULL → nullable, gains a
    // default. pg = one comma-joined ALTER COLUMN; mysql = MODIFY full spec.
    await schema.table(TABLE, (t) => t.bigInteger('age').nullable().default(18).change())
    info = (await inspectTable(driver, dialect, TABLE))!
    const aged = info.columns.find(c => c.name === 'age')
    assert.ok(aged, 'age column still present after change')
    assert.match(aged!.type.toLowerCase(), /bigint|int8/)
    assert.strictEqual(aged!.notNull, false)
    assert.ok(String(aged!.dflt).includes('18'), `default must carry 18, got ${String(aged!.dflt)}`)
    // ... and the new default actually applies.
    await driver.execute(`INSERT INTO ${dialect.quoteId(TABLE)} (title) VALUES ('defaulted')`, [])
    const defaulted = await driver.execute(
      `SELECT age FROM ${dialect.quoteId(TABLE)} WHERE title = 'defaulted'`, [])
    assert.strictEqual(Number(defaulted[0]?.['age']), 18)

    // 7. DROP COLUMN.
    await schema.table(TABLE, (t) => t.dropColumn('age'))
    assert.strictEqual(await schema.hasColumn(TABLE, 'age'), false)
  })
}

interface LiveCase {
  label:   string
  url:     string | undefined
  envName: string
  open:    (url: string) => Promise<Driver>
  dialect: () => Dialect
}

const CASES: LiveCase[] = [
  { label: 'pg', url: PG_URL, envName: 'PG_TEST_URL', open: (url) => PostgresDriver.open({ url }), dialect: () => new PgDialect() },
  { label: 'mysql', url: MYSQL_URL, envName: 'MYSQL_TEST_URL', open: (url) => MysqlDriver.open({ url }), dialect: () => new MysqlDialect() },
]

for (const c of CASES) {
  if (!c.url) {
    test(`alter paths ${c.label} live tests (skipped — set ${c.envName} to run)`, { skip: true }, () => {})
    continue
  }
  describe(`Schema.table ALTER paths (live ${c.label})`, () => {
    let driver: Driver
    let schema: SchemaBuilder
    const dialect = c.dialect()

    before(async () => {
      driver = await c.open(c.url!)
      schema = new SchemaBuilder(driver, dialect)
      await schema.dropIfExists(TABLE)
      await schema.dropIfExists(PARENT)
    })

    after(async () => {
      await schema.dropIfExists(TABLE).catch(() => {})
      await schema.dropIfExists(PARENT).catch(() => {})
      await driver.close()
    })

    defineScenario(() => ({ driver, dialect, schema }))
  })
}
