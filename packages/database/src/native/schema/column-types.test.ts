// Column-type breadth (gap §3 db-schema-migrations): the additional Laravel
// column types mapped per native dialect. Pure DDL-compiler assertions — one
// table per type, asserting the emitted storage type for sqlite / pg / mysql.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { SqliteDialect } from '../dialect.js'
import { PgDialect } from '../dialect-pg.js'
import { MysqlDialect } from '../dialect-mysql.js'
import type { Dialect } from '../dialect.js'
import { NativeOrmError } from '../errors.js'
import { Blueprint } from './blueprint.js'
import { compileCreateTable } from './ddl-compiler.js'

const sqlite = new SqliteDialect()
const pg     = new PgDialect()
const mysql  = new MysqlDialect()

function col(dialect: Dialect, build: (t: Blueprint) => void): string {
  const bp = new Blueprint('t')
  bp.id()
  build(bp)
  return compileCreateTable(bp, dialect)[0]?.sql ?? ''
}

// Each row: [label, build, sqliteRe, pgRe, mysqlRe]
const cases: Array<[string, (t: Blueprint) => void, RegExp, RegExp, RegExp]> = [
  ['tinyInteger',   (t) => t.tinyInteger('a'),   /"a" INTEGER/,        /"a" smallint/,            /`a` tinyint(?!\()/],
  ['smallInteger',  (t) => t.smallInteger('a'),  /"a" INTEGER/,        /"a" smallint/,            /`a` smallint/],
  ['mediumInteger', (t) => t.mediumInteger('a'), /"a" INTEGER/,        /"a" integer/,             /`a` mediumint/],
  ['char',          (t) => t.char('a', 10),      /"a" TEXT/,           /"a" char\(10\)/,          /`a` char\(10\)/],
  ['longText',      (t) => t.longText('a'),      /"a" TEXT/,           /"a" text/,                /`a` longtext/],
  ['mediumText',    (t) => t.mediumText('a'),    /"a" TEXT/,           /"a" text/,                /`a` mediumtext/],
  ['double',        (t) => t.double('a'),        /"a" REAL/,           /"a" double precision/,    /`a` double/],
  ['date',          (t) => t.date('a'),          /"a" TEXT/,           /"a" date/,                /`a` date/],
  ['time',          (t) => t.time('a'),          /"a" TEXT/,           /"a" time(?!\()/,          /`a` time(?!\()/],
  ['time(p)',       (t) => t.time('a', 3),       /"a" TEXT/,           /"a" time\(3\)/,           /`a` time\(3\)/],
  ['jsonb',         (t) => t.jsonb('a'),         /"a" TEXT/,           /"a" jsonb/,               /`a` json/],
  ['ulid',          (t) => t.ulid('a'),          /"a" TEXT/,           /"a" char\(26\)/,          /`a` char\(26\)/],
]

describe('column types — storage mapping per dialect', () => {
  for (const [label, build, sRe, pRe, mRe] of cases) {
    it(`${label}: sqlite`, () => assert.match(col(sqlite, build), sRe))
    it(`${label}: pg`,     () => assert.match(col(pg, build),     pRe))
    it(`${label}: mysql`,  () => assert.match(col(mysql, build),  mRe))
  }
})

describe('enum — value list / CHECK constraint', () => {
  it('mysql renders a native enum(...) list', () => {
    assert.match(col(mysql, (t) => t.enum('status', ['draft', 'live'])), /`status` enum\('draft', 'live'\)/)
  })
  it('pg renders varchar + CHECK (… IN (…))', () => {
    assert.match(col(pg, (t) => t.enum('status', ['draft', 'live'])), /"status" varchar\(255\) CHECK \("status" IN \('draft', 'live'\)\)/)
  })
  it('sqlite renders TEXT + CHECK (… IN (…))', () => {
    assert.match(col(sqlite, (t) => t.enum('status', ['draft', 'live'])), /"status" TEXT CHECK \("status" IN \('draft', 'live'\)\)/)
  })
  it('escapes single quotes in enum values', () => {
    assert.match(col(mysql, (t) => t.enum('s', ["it's"])), /enum\('it''s'\)/)
  })
  it('throws on an empty enum value list', () => {
    assert.throws(
      () => col(sqlite, (t) => t.enum('s', [])),
      (e: unknown) => e instanceof NativeOrmError && e.code === 'NATIVE_DDL_EMPTY_ENUM',
    )
  })
})

describe('set — mysql only', () => {
  it('mysql renders a native set(...) list', () => {
    assert.match(col(mysql, (t) => t.set('flags', ['a', 'b'])), /`flags` set\('a', 'b'\)/)
  })
  for (const [label, dialect] of [['pg', pg], ['sqlite', sqlite]] as Array<[string, Dialect]>) {
    it(`${label} throws NATIVE_DDL_UNSUPPORTED_TYPE`, () => {
      assert.throws(
        () => col(dialect, (t) => t.set('flags', ['a', 'b'])),
        (e: unknown) => e instanceof NativeOrmError && e.code === 'NATIVE_DDL_UNSUPPORTED_TYPE',
      )
    })
  }
})

describe('foreign-key column helpers', () => {
  it('foreignUuid is a uuid column that constrains', () => {
    const [stmt] = compileCreateTable(
      (() => { const b = new Blueprint('posts'); b.id(); b.foreignUuid('authorId').references('id').on('users'); return b })(),
      pg,
    )
    assert.match(stmt?.sql ?? '', /"authorId" uuid/)
    assert.match(stmt?.sql ?? '', /FOREIGN KEY \("authorId"\) REFERENCES "users" \("id"\)/)
  })

  it('foreignUlid is a char(26) column on pg', () => {
    assert.match(col(pg, (t) => t.foreignUlid('ref')), /"ref" char\(26\)/)
  })

  it('foreignIdFor derives a camelCase {singular}Id column', () => {
    const [stmt] = compileCreateTable(
      (() => { const b = new Blueprint('posts'); b.id(); b.foreignIdFor('users').constrained(); return b })(),
      sqlite,
    )
    assert.match(stmt?.sql ?? '', /"userId" INTEGER/)
    assert.match(stmt?.sql ?? '', /REFERENCES "users" \("id"\)/)
  })

  it('foreignIdFor accepts an explicit column override', () => {
    const sql = col(sqlite, (t) => t.foreignIdFor('users', 'ownerId'))
    assert.match(sql, /"ownerId" INTEGER/)
  })

  it('unsigned() emits the UNSIGNED modifier on MySQL numeric columns', () => {
    assert.match(col(mysql, (t) => t.integer('a').unsigned()),       /`a` int unsigned/)
    assert.match(col(mysql, (t) => t.bigInteger('a').unsigned()),    /`a` bigint unsigned/)
    assert.match(col(mysql, (t) => t.tinyInteger('a').unsigned()),   /`a` tinyint unsigned/)
    // Decimal keeps its precision before the modifier.
    assert.match(col(mysql, (t) => t.decimal('a', 8, 2).unsigned()), /`a` decimal\(8, 2\) unsigned/)
    // foreignId() is an unsigned big integer.
    assert.match(col(mysql, (t) => t.foreignId('userId')),           /`userId` bigint unsigned/)
  })

  it('unsigned() is a no-op on Postgres and SQLite (no UNSIGNED type)', () => {
    assert.match(col(pg, (t) => t.integer('a').unsigned()), /"a" integer/)
    assert.doesNotMatch(col(pg, (t) => t.integer('a').unsigned()), /unsigned/i)
    assert.doesNotMatch(col(sqlite, (t) => t.integer('a').unsigned()), /unsigned/i)
  })

  it('the MySQL auto-increment primary key stays signed (FK signedness parity)', () => {
    assert.match(col(mysql, () => {}), /`id` bigint AUTO_INCREMENT PRIMARY KEY/)
    assert.doesNotMatch(col(mysql, () => {}), /`id` bigint unsigned/)
  })
})
