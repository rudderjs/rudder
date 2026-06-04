// ─── db:show / db:table inspection readers ─────────────────
//
// `inspectDatabase` / `inspectTable` against a REAL in-memory better-sqlite3
// schema (tables, counts, views, indexes incl. the synthesized PRIMARY entry,
// PRAGMA-grouped foreign keys), plus LIVE pg/mysql sections gated on
// PG_TEST_URL / MYSQL_TEST_URL (same harness as pg-introspect.test.ts) proving
// the information_schema / pg_catalog paths: versions, per-table sizes,
// composite-safe FK column pairing, and index grouping.

import { describe, it, test, before, after, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { BetterSqlite3Driver } from '../drivers/better-sqlite3.js'
import { SqliteDialect } from '../dialect.js'
import type { Driver } from '../driver.js'
import { SchemaBuilder } from './schema-builder.js'
import { inspectDatabase, inspectTable, readIndexes, readForeignKeys } from './inspect.js'

// ─── SQLite (in-memory) ────────────────────────────────────

describe('inspectDatabase / inspectTable — sqlite', () => {
  const dialect = new SqliteDialect()
  let driver: Driver
  let schema: SchemaBuilder

  beforeEach(async () => {
    driver = await BetterSqlite3Driver.open({ filename: ':memory:' })
    schema = new SchemaBuilder(driver, dialect)
    await schema.create('users', (t) => {
      t.id()
      t.string('name')
      t.string('email').unique()
    })
    await schema.create('posts', (t) => {
      t.id()
      t.string('title')
      t.integer('userId')
      t.foreign('userId').references('id').on('users').onDelete('cascade')
      t.index('title')
    })
    await driver.execute(`INSERT INTO users (name, email) VALUES (?, ?)`, ['Alice', 'a@x.com'])
    await driver.execute(`INSERT INTO users (name, email) VALUES (?, ?)`, ['Bob', 'b@x.com'])
    await driver.execute(`INSERT INTO posts (title, userId) VALUES (?, ?)`, ['Hello', 1])
  })
  afterEach(async () => { await driver.close() })

  it('lists every user table (migrations included), sorted', async () => {
    await driver.execute(`CREATE TABLE migrations (id INTEGER PRIMARY KEY, name TEXT)`, [])
    const info = await inspectDatabase(driver, dialect)
    assert.deepStrictEqual(info.tables.map((t) => t.name), ['migrations', 'posts', 'users'])
    assert.strictEqual(info.dialect, 'sqlite')
    assert.match(String(info.version), /^\d+\.\d+/)
    assert.strictEqual(info.database, null) // :memory: has no file
  })

  it('omits row counts by default, fills them with counts: true', async () => {
    const plain = await inspectDatabase(driver, dialect)
    assert.strictEqual(plain.tables[0]?.rows, undefined)
    assert.strictEqual(plain.views, undefined)

    const counted = await inspectDatabase(driver, dialect, { counts: true })
    const byName  = new Map(counted.tables.map((t) => [t.name, t.rows]))
    assert.strictEqual(byName.get('users'), 2)
    assert.strictEqual(byName.get('posts'), 1)
  })

  it('lists views with views: true', async () => {
    await driver.execute(`CREATE VIEW active_users AS SELECT * FROM users`, [])
    const info = await inspectDatabase(driver, dialect, { views: true })
    assert.deepStrictEqual(info.views, ['active_users'])
    // the view is not in the tables list
    assert.ok(!info.tables.some((t) => t.name === 'active_users'))
  })

  it('inspectTable returns columns, a synthesized PRIMARY index, and user indexes', async () => {
    const info = await inspectTable(driver, dialect, 'users')
    assert.ok(info)
    assert.strictEqual(info.name, 'users')
    assert.strictEqual(info.rows, 2)
    assert.deepStrictEqual(info.columns.map((c) => c.name), ['id', 'name', 'email'])

    // INTEGER PRIMARY KEY = rowid → no index row exists; the PRIMARY entry is synthesized.
    const primary = info.indexes.find((ix) => ix.primary)
    assert.ok(primary)
    assert.strictEqual(primary.name, 'PRIMARY')
    assert.deepStrictEqual(primary.columns, ['id'])
    assert.strictEqual(primary.unique, true)

    const unique = info.indexes.find((ix) => ix.columns.includes('email'))
    assert.ok(unique)
    assert.strictEqual(unique.unique, true)
    assert.strictEqual(unique.primary, false)
  })

  it('inspectTable reads foreign keys grouped from the PRAGMA rows', async () => {
    const info = await inspectTable(driver, dialect, 'posts')
    assert.ok(info)
    assert.strictEqual(info.foreignKeys.length, 1)
    const fk = info.foreignKeys[0]!
    assert.strictEqual(fk.name, null) // sqlite PRAGMA reports no constraint name
    assert.deepStrictEqual(fk.columns, ['userId'])
    assert.strictEqual(fk.foreignTable, 'users')
    assert.deepStrictEqual(fk.foreignColumns, ['id'])
    assert.strictEqual(fk.onDelete, 'CASCADE')

    const titleIx = info.indexes.find((ix) => ix.columns.includes('title'))
    assert.ok(titleIx)
    assert.strictEqual(titleIx.unique, false)
  })

  it('tolerates a table dropped mid-scan — counts continue, vanished table has no rows', async () => {
    // Simulates the shared-database race: the catalog lists a table, then a
    // concurrent DDL drops it before its COUNT(*) runs. The overview must not
    // fail wholesale; the vanished table just reports no count.
    const racy = {
      execute: async (sql: string, bindings: unknown[]) => {
        if (sql.includes('COUNT(*)') && sql.includes('"posts"')) throw new Error('no such table: posts')
        return driver.execute(sql, bindings)
      },
    }
    const info = await inspectDatabase(racy, dialect, { counts: true })
    const byName = new Map(info.tables.map((t) => [t.name, t.rows]))
    assert.strictEqual(byName.get('users'), 2)
    assert.strictEqual(byName.get('posts'), undefined)
  })

  it('inspectTable returns null for a missing table (the injection gate)', async () => {
    assert.strictEqual(await inspectTable(driver, dialect, 'nope'), null)
    assert.strictEqual(await inspectTable(driver, dialect, `users"; DROP TABLE users; --`), null)
  })

  it('groups composite sqlite foreign keys by constraint ordinal', async () => {
    await driver.execute(
      `CREATE TABLE pair_parent (a INTEGER, b INTEGER, PRIMARY KEY (a, b))`, [])
    await driver.execute(
      `CREATE TABLE pair_child (x INTEGER, y INTEGER, ` +
      `FOREIGN KEY (x, y) REFERENCES pair_parent (a, b) ON UPDATE SET NULL)`, [])
    const fks = await readForeignKeys(driver, dialect, 'pair_child')
    assert.strictEqual(fks.length, 1)
    assert.deepStrictEqual(fks[0]!.columns, ['x', 'y'])
    assert.deepStrictEqual(fks[0]!.foreignColumns, ['a', 'b'])
    assert.strictEqual(fks[0]!.onUpdate, 'SET NULL')
  })
})

// ─── PostgreSQL (live, gated) ──────────────────────────────

const PG_URL = process.env['PG_TEST_URL']

if (!PG_URL) {
  test('pg inspection live tests (skipped — set PG_TEST_URL to run)', { skip: true }, () => {})
} else {
  describe('inspectDatabase / inspectTable — pg (live)', () => {
    let pg: typeof import('../drivers/postgres.js')
    let dialectPg: typeof import('../dialect-pg.js')
    let driver: Driver
    let schema: SchemaBuilder

    before(async () => {
      pg        = await import('../drivers/postgres.js')
      dialectPg = await import('../dialect-pg.js')
      driver    = await pg.PostgresDriver.open({ url: PG_URL })
      schema    = new SchemaBuilder(driver, new dialectPg.PgDialect())
      await driver.execute(`DROP TABLE IF EXISTS rudder_inspect_posts`, [])
      await driver.execute(`DROP TABLE IF EXISTS rudder_inspect_users`, [])
      await schema.create('rudder_inspect_users', (t) => {
        t.id()
        t.string('name')
        t.string('email').unique()
      })
      await schema.create('rudder_inspect_posts', (t) => {
        t.id()
        t.string('title')
        t.bigInteger('userId').unsigned()
        t.foreign('userId').references('id').on('rudder_inspect_users').onDelete('cascade')
        t.index(['title', 'userId'])
      })
      await driver.execute(`INSERT INTO rudder_inspect_users (name, email) VALUES ($1, $2)`, ['Alice', 'a@x.com'])
    })
    after(async () => {
      await driver.execute(`DROP TABLE IF EXISTS rudder_inspect_posts`, [])
      await driver.execute(`DROP TABLE IF EXISTS rudder_inspect_users`, [])
      await driver.close()
    })

    it('reports version, database name, and per-table sizes', async () => {
      const dialect = new dialectPg.PgDialect()
      const info = await inspectDatabase(driver, dialect, { counts: true })
      assert.strictEqual(info.dialect, 'pg')
      assert.match(String(info.version), /^\d+/)
      assert.ok(info.database)
      const users = info.tables.find((t) => t.name === 'rudder_inspect_users')
      assert.ok(users)
      assert.ok((users.sizeBytes ?? 0) > 0, 'pg_total_relation_size should report bytes')
      assert.strictEqual(users.rows, 1)
    })

    it('reads indexes with grouped columns and primary/unique flags', async () => {
      const dialect = new dialectPg.PgDialect()
      const indexes = await readIndexes(driver, dialect, 'rudder_inspect_posts')
      const primary = indexes.find((ix) => ix.primary)
      assert.ok(primary)
      assert.deepStrictEqual(primary.columns, ['id'])
      const composite = indexes.find((ix) => ix.columns.length === 2)
      assert.ok(composite, 'composite index should group both columns')
      assert.deepStrictEqual(composite.columns, ['title', 'userId'])
      assert.strictEqual(composite.unique, false)
    })

    it('reads foreign keys with paired columns and mapped actions', async () => {
      const dialect = new dialectPg.PgDialect()
      const fks = await readForeignKeys(driver, dialect, 'rudder_inspect_posts')
      assert.strictEqual(fks.length, 1)
      const fk = fks[0]!
      assert.ok(fk.name)
      assert.deepStrictEqual(fk.columns, ['userId'])
      assert.strictEqual(fk.foreignTable, 'rudder_inspect_users')
      assert.deepStrictEqual(fk.foreignColumns, ['id'])
      assert.strictEqual(fk.onDelete, 'CASCADE')
      assert.strictEqual(fk.onUpdate, 'NO ACTION')
    })

    it('inspectTable round-trips name + columns + rows', async () => {
      const dialect = new dialectPg.PgDialect()
      const info = await inspectTable(driver, dialect, 'rudder_inspect_users')
      assert.ok(info)
      assert.strictEqual(info.rows, 1)
      assert.ok(info.columns.some((c) => c.name === 'email'))
      assert.strictEqual(await inspectTable(driver, dialect, 'rudder_inspect_nope'), null)
    })
  })
}

// ─── MySQL (live, gated) ───────────────────────────────────

const MYSQL_URL = process.env['MYSQL_TEST_URL']

if (!MYSQL_URL) {
  test('mysql inspection live tests (skipped — set MYSQL_TEST_URL to run)', { skip: true }, () => {})
} else {
  describe('inspectDatabase / inspectTable — mysql (live)', () => {
    let my: typeof import('../drivers/mysql.js')
    let dialectMy: typeof import('../dialect-mysql.js')
    let driver: Driver
    let schema: SchemaBuilder

    before(async () => {
      my        = await import('../drivers/mysql.js')
      dialectMy = await import('../dialect-mysql.js')
      driver    = await my.MysqlDriver.open({ url: MYSQL_URL })
      schema    = new SchemaBuilder(driver, new dialectMy.MysqlDialect())
      await driver.execute(`DROP TABLE IF EXISTS rudder_inspect_posts`, [])
      await driver.execute(`DROP TABLE IF EXISTS rudder_inspect_users`, [])
      await schema.create('rudder_inspect_users', (t) => {
        t.id()
        t.string('name')
        t.string('email').unique()
      })
      await schema.create('rudder_inspect_posts', (t) => {
        t.id()
        t.string('title')
        t.bigInteger('userId').unsigned()
        t.foreign('userId').references('id').on('rudder_inspect_users').onDelete('cascade')
        t.index(['title', 'userId'])
      })
      await driver.execute(`INSERT INTO rudder_inspect_users (name, email) VALUES (?, ?)`, ['Alice', 'a@x.com'])
    })
    after(async () => {
      await driver.execute(`DROP TABLE IF EXISTS rudder_inspect_posts`, [])
      await driver.execute(`DROP TABLE IF EXISTS rudder_inspect_users`, [])
      await driver.close()
    })

    it('reports version, database name, sizes, and counts', async () => {
      const dialect = new dialectMy.MysqlDialect()
      const info = await inspectDatabase(driver, dialect, { counts: true })
      assert.strictEqual(info.dialect, 'mysql')
      assert.match(String(info.version), /^\d+/)
      assert.ok(info.database)
      const users = info.tables.find((t) => t.name === 'rudder_inspect_users')
      assert.ok(users)
      assert.ok((users.sizeBytes ?? 0) > 0, 'data_length + index_length should report bytes')
      assert.strictEqual(users.rows, 1)
    })

    it('reads indexes (PRIMARY flagged) and grouped composite columns', async () => {
      const dialect = new dialectMy.MysqlDialect()
      const indexes = await readIndexes(driver, dialect, 'rudder_inspect_posts')
      const primary = indexes.find((ix) => ix.primary)
      assert.ok(primary)
      assert.strictEqual(primary.name, 'PRIMARY')
      assert.deepStrictEqual(primary.columns, ['id'])
      const composite = indexes.find((ix) => ix.columns.length === 2)
      assert.ok(composite)
      assert.deepStrictEqual(composite.columns, ['title', 'userId'])
    })

    it('reads foreign keys with update/delete rules', async () => {
      const dialect = new dialectMy.MysqlDialect()
      const fks = await readForeignKeys(driver, dialect, 'rudder_inspect_posts')
      assert.strictEqual(fks.length, 1)
      const fk = fks[0]!
      assert.deepStrictEqual(fk.columns, ['userId'])
      assert.strictEqual(fk.foreignTable, 'rudder_inspect_users')
      assert.deepStrictEqual(fk.foreignColumns, ['id'])
      assert.strictEqual(fk.onDelete, 'CASCADE')
    })

    it('inspectTable round-trips and rejects unknown tables', async () => {
      const dialect = new dialectMy.MysqlDialect()
      const info = await inspectTable(driver, dialect, 'rudder_inspect_users')
      assert.ok(info)
      assert.strictEqual(info.rows, 1)
      assert.strictEqual(await inspectTable(driver, dialect, 'rudder_inspect_nope'), null)
    })
  })
}
