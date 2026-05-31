// Table-rebuild conformance (7.4b): `Schema.table(...).change()` against a REAL
// in-memory better-sqlite3 table. Asserts the 12-step dance preserves data, the
// primary key (autoincrement), and user indexes while swapping the changed
// column's definition — plus the v1 guard rails.

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { BetterSqlite3Driver } from '../drivers/better-sqlite3.js'
import { SqliteDialect } from '../dialect.js'
import type { Driver } from '../driver.js'
import { NativeOrmError } from '../errors.js'
import { SchemaBuilder } from './schema-builder.js'
import { readColumns } from './introspect.js'

const dialect = new SqliteDialect()
let driver: Driver
let schema: SchemaBuilder

beforeEach(async () => {
  driver = await BetterSqlite3Driver.open({ filename: ':memory:' })
  schema = new SchemaBuilder(driver, dialect)
  await schema.create('users', (t) => {
    t.id()
    t.string('name')
    t.integer('age').nullable()
    t.string('email').unique()
  })
  await driver.execute('INSERT INTO users (name, age, email) VALUES (?, ?, ?)', ['Alice', 30, 'a@x.com'])
  await driver.execute('INSERT INTO users (name, age, email) VALUES (?, ?, ?)', ['Bob', null, 'b@x.com'])
})
afterEach(async () => { await driver.close() })

describe('SchemaBuilder.table — column change() via rebuild', () => {
  it('changes a column type, preserving data, the PK, and indexes', async () => {
    await schema.table('users', (t) => t.text('age').nullable().change())

    // Column type changed INTEGER → TEXT.
    const cols = await readColumns(driver, dialect, 'users')
    assert.strictEqual(cols.find(c => c.name === 'age')?.type, 'TEXT')

    // Data preserved (both rows still there, values intact).
    const rows = await driver.execute('SELECT name, age FROM users ORDER BY id', [])
    assert.strictEqual(rows.length, 2)
    assert.strictEqual(rows[0]?.['name'], 'Alice')
    assert.strictEqual(rows[1]?.['age'], null)

    // Unique index on email survived (duplicate rejected).
    await assert.rejects(() => driver.execute('INSERT INTO users (name, email) VALUES (?, ?)', ['X', 'a@x.com']))

    // Autoincrement PK survived — next insert continues the sequence (id 3).
    await driver.execute('INSERT INTO users (name, email) VALUES (?, ?)', ['Carol', 'c@x.com'])
    const carol = await driver.execute('SELECT id FROM users WHERE email = ?', ['c@x.com'])
    assert.strictEqual(carol[0]?.['id'], 3)
  })

  it('can make a previously-nullable column NOT NULL with a default', async () => {
    // Backfill Bob's NULL so the rebuild copy doesn't violate NOT NULL.
    await driver.execute('UPDATE users SET age = 0 WHERE age IS NULL', [])
    await schema.table('users', (t) => t.integer('age').default(0).change())
    const cols = await readColumns(driver, dialect, 'users')
    assert.strictEqual(cols.find(c => c.name === 'age')?.notNull, true)
  })
})

describe('SchemaBuilder.table — change() guard rails (v1)', () => {
  it('rejects combining change() with another operation', async () => {
    await assert.rejects(
      () => schema.table('users', (t) => { t.text('age').nullable().change(); t.string('extra').nullable() }),
      (e: unknown) => e instanceof NativeOrmError && e.code === 'NATIVE_DDL_CHANGE_COMBINED',
    )
  })

  it('rejects changing a primary-key column', async () => {
    await assert.rejects(
      () => schema.table('users', (t) => t.integer('id').change()),
      (e: unknown) => e instanceof NativeOrmError && e.code === 'NATIVE_DDL_CHANGE_PK',
    )
  })

  it('rejects change() on a non-existent column', async () => {
    await assert.rejects(
      () => schema.table('users', (t) => t.string('nope').nullable().change()),
      (e: unknown) => e instanceof NativeOrmError && e.code === 'NATIVE_DDL_CHANGE_MISSING',
    )
  })
})
