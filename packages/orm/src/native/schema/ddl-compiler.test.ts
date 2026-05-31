import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { SqliteDialect } from '../dialect.js'
import { NativeOrmError } from '../errors.js'
import { Blueprint } from './blueprint.js'
import { compileCreateTable, compileDropTable } from './ddl-compiler.js'

const dialect = new SqliteDialect()

/** Build a Blueprint via its callback and return the compiled statements. */
function create(table: string, build: (t: Blueprint) => void) {
  const bp = new Blueprint(table)
  build(bp)
  return compileCreateTable(bp, dialect)
}

describe('DDL compiler — CREATE TABLE basics', () => {
  it('emits an auto-increment primary key inline (SQLite rowid alias)', () => {
    const [stmt] = create('users', (t) => {
      t.id()
      t.string('name')
    })
    assert.strictEqual(
      stmt?.sql,
      'CREATE TABLE "users" (\n  "id" INTEGER PRIMARY KEY AUTOINCREMENT,\n  "name" TEXT NOT NULL\n)',
    )
    assert.deepStrictEqual(stmt?.bindings, [])
  })

  it('does not append NOT NULL / PRIMARY KEY to an auto-increment column', () => {
    const [stmt] = create('t', (t) => t.id())
    assert.strictEqual(stmt?.sql.includes('AUTOINCREMENT NOT NULL'), false)
    assert.match(stmt?.sql ?? '', /"id" INTEGER PRIMARY KEY AUTOINCREMENT/)
  })

  it('quotes the table and every column identifier', () => {
    const [stmt] = create('order_items', (t) => {
      t.id()
      t.integer('qty')
    })
    assert.match(stmt?.sql ?? '', /CREATE TABLE "order_items"/)
    assert.match(stmt?.sql ?? '', /"qty" INTEGER NOT NULL/)
  })

  it('throws on a table with no columns', () => {
    assert.throws(() => compileCreateTable(new Blueprint('empty'), dialect), (e: unknown) => e instanceof NativeOrmError && e.code === 'NATIVE_DDL_EMPTY_TABLE')
  })
})

describe('DDL compiler — column types map to SQLite storage classes', () => {
  const cases: Array<[string, (t: Blueprint) => void, RegExp]> = [
    ['string → TEXT',     (t) => t.string('a'),         /"a" TEXT NOT NULL/],
    ['text → TEXT',       (t) => t.text('a'),           /"a" TEXT NOT NULL/],
    ['uuid → TEXT',       (t) => t.uuid('a'),           /"a" TEXT NOT NULL/],
    ['json → TEXT',       (t) => t.json('a'),           /"a" TEXT NOT NULL/],
    ['integer → INTEGER', (t) => t.integer('a'),        /"a" INTEGER NOT NULL/],
    ['bigInteger → INTEGER', (t) => t.bigInteger('a'),  /"a" INTEGER NOT NULL/],
    ['boolean → INTEGER', (t) => t.boolean('a'),        /"a" INTEGER NOT NULL/],
    ['dateTime → TEXT',   (t) => t.dateTime('a'),       /"a" TEXT NOT NULL/],
    ['timestamp → TEXT',  (t) => t.timestamp('a'),      /"a" TEXT NOT NULL/],
    ['float → REAL',      (t) => t.float('a'),          /"a" REAL NOT NULL/],
    ['decimal → NUMERIC', (t) => t.decimal('a'),        /"a" NUMERIC NOT NULL/],
    ['binary → BLOB',     (t) => t.binary('a'),         /"a" BLOB NOT NULL/],
  ]
  for (const [label, build, expected] of cases) {
    it(label, () => {
      const [stmt] = create('t', (t) => { t.id(); build(t) })
      assert.match(stmt?.sql ?? '', expected)
    })
  }
})

describe('DDL compiler — modifiers', () => {
  it('nullable() drops NOT NULL', () => {
    const [stmt] = create('t', (t) => { t.id(); t.string('bio').nullable() })
    assert.match(stmt?.sql ?? '', /"bio" TEXT(?! NOT NULL)/)
  })

  it('default() renders a string literal, escaping quotes', () => {
    const [stmt] = create('t', (t) => { t.id(); t.string('role').default("it's") })
    assert.match(stmt?.sql ?? '', /"role" TEXT NOT NULL DEFAULT 'it''s'/)
  })

  it('default() renders numbers and booleans as SQLite literals', () => {
    const [stmt] = create('t', (t) => {
      t.id()
      t.integer('hits').default(0)
      t.boolean('active').default(true)
    })
    assert.match(stmt?.sql ?? '', /"hits" INTEGER NOT NULL DEFAULT 0/)
    assert.match(stmt?.sql ?? '', /"active" INTEGER NOT NULL DEFAULT 1/)
  })

  it('default(null) renders DEFAULT NULL', () => {
    const [stmt] = create('t', (t) => { t.id(); t.string('x').nullable().default(null) })
    assert.match(stmt?.sql ?? '', /"x" TEXT DEFAULT NULL/)
  })

  it('useCurrent() renders DEFAULT CURRENT_TIMESTAMP (not a literal)', () => {
    const [stmt] = create('t', (t) => { t.id(); t.timestamp('createdAt').useCurrent() })
    assert.match(stmt?.sql ?? '', /"createdAt" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP/)
  })

  it('rejects an unsupported default type (Date/object)', () => {
    assert.throws(
      () => create('t', (t) => { t.id(); t.dateTime('at').default(new Date(0)) }),
      (e: unknown) => e instanceof NativeOrmError && e.code === 'NATIVE_DDL_BAD_DEFAULT',
    )
  })

  it('timestamps() adds nullable createdAt + updatedAt (camelCase)', () => {
    const [stmt] = create('t', (t) => { t.id(); t.timestamps() })
    assert.match(stmt?.sql ?? '', /"createdAt" TEXT,/)
    assert.match(stmt?.sql ?? '', /"updatedAt" TEXT\n\)/)
  })

  it('softDeletes() adds nullable deletedAt', () => {
    const [stmt] = create('t', (t) => { t.id(); t.softDeletes() })
    assert.match(stmt?.sql ?? '', /"deletedAt" TEXT\n\)/)
  })
})

describe('DDL compiler — primary keys', () => {
  it('a single non-auto column .primary() renders inline PRIMARY KEY', () => {
    const [stmt] = create('t', (t) => { t.string('code').primary() })
    assert.match(stmt?.sql ?? '', /"code" TEXT NOT NULL PRIMARY KEY/)
  })

  it('composite Blueprint.primary([...]) renders a table constraint', () => {
    const [stmt] = create('role_user', (t) => {
      t.integer('roleId')
      t.integer('userId')
      t.primary(['roleId', 'userId'])
    })
    assert.match(stmt?.sql ?? '', /PRIMARY KEY \("roleId", "userId"\)\n\)/)
  })

  it('an auto-increment column suppresses a stray .primary() table constraint', () => {
    const [stmt] = create('t', (t) => { t.id() })
    // exactly one PRIMARY KEY (the inline auto-increment), no table constraint
    assert.strictEqual((stmt?.sql.match(/PRIMARY KEY/g) ?? []).length, 1)
  })
})

describe('DDL compiler — indexes', () => {
  it('column .unique() emits a CREATE UNIQUE INDEX with the Laravel name', () => {
    const stmts = create('users', (t) => { t.id(); t.string('email').unique() })
    assert.strictEqual(stmts.length, 2)
    assert.strictEqual(stmts[1]?.sql, 'CREATE UNIQUE INDEX "users_email_unique" ON "users" ("email")')
  })

  it('column .index() emits a CREATE INDEX', () => {
    const stmts = create('users', (t) => { t.id(); t.string('name').index() })
    assert.strictEqual(stmts[1]?.sql, 'CREATE INDEX "users_name_index" ON "users" ("name")')
  })

  it('composite Blueprint.index([...]) emits one statement with both columns', () => {
    const stmts = create('people', (t) => {
      t.id()
      t.string('lastName')
      t.string('firstName')
      t.index(['lastName', 'firstName'])
    })
    assert.strictEqual(
      stmts[1]?.sql,
      'CREATE INDEX "people_lastName_firstName_index" ON "people" ("lastName", "firstName")',
    )
  })

  it('a named index uses the provided name', () => {
    const stmts = create('users', (t) => { t.id(); t.unique('email', 'uq_email') })
    assert.match(stmts[1]?.sql ?? '', /CREATE UNIQUE INDEX "uq_email"/)
  })
})

describe('DDL compiler — DROP TABLE', () => {
  it('compiles DROP TABLE', () => {
    assert.strictEqual(compileDropTable('users', {}, dialect).sql, 'DROP TABLE "users"')
  })
  it('compiles DROP TABLE IF EXISTS', () => {
    assert.strictEqual(compileDropTable('users', { ifExists: true }, dialect).sql, 'DROP TABLE IF EXISTS "users"')
  })
})

describe('DDL compiler — identifier safety', () => {
  it('rejects an injection attempt in a table name', () => {
    assert.throws(() => create('users"; DROP TABLE x; --', (t) => t.id()))
  })
  it('rejects an injection attempt in a column name', () => {
    assert.throws(() => create('t', (t) => { t.id(); t.string('a" , "b') }))
  })
})
