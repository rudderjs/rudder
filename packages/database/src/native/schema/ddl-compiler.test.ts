import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { SqliteDialect } from '../dialect.js'
import { NativeOrmError, NativeNotImplementedError } from '../errors.js'
import { Blueprint } from './blueprint.js'
import { AlterBlueprint } from './alter-blueprint.js'
import { compileCreateTable, compileDropTable, compileAlterTable, compileRenameTable } from './ddl-compiler.js'

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

// ── Foreign keys (7.6) ────────────────────────────────────
describe('DDL compiler — foreign keys', () => {
  it('constrained() infers the table (user_id → users) and references id', () => {
    const [stmt] = create('posts', (t) => {
      t.id()
      t.foreignId('user_id').constrained()
    })
    assert.match(
      stmt?.sql ?? '',
      /CONSTRAINT "posts_user_id_foreign" FOREIGN KEY \("user_id"\) REFERENCES "users" \("id"\)/,
    )
  })

  it('constrained() strips a camelCase Id suffix (authorId → authors)', () => {
    const [stmt] = create('posts', (t) => {
      t.id()
      t.foreignId('authorId').constrained()
    })
    assert.match(stmt?.sql ?? '', /FOREIGN KEY \("authorId"\) REFERENCES "authors" \("id"\)/)
  })

  it('constrained(table) takes an explicit referenced table', () => {
    const [stmt] = create('posts', (t) => {
      t.id()
      t.foreignId('author_id').constrained('users')
    })
    assert.match(stmt?.sql ?? '', /FOREIGN KEY \("author_id"\) REFERENCES "users" \("id"\)/)
  })

  it('references().on() builds the FK explicitly', () => {
    const [stmt] = create('posts', (t) => {
      t.id()
      t.foreignId('user_id').references('uuid').on('users')
    })
    assert.match(stmt?.sql ?? '', /FOREIGN KEY \("user_id"\) REFERENCES "users" \("uuid"\)/)
  })

  it('emits ON DELETE / ON UPDATE clauses with SQL keywords', () => {
    const [stmt] = create('posts', (t) => {
      t.id()
      t.foreignId('user_id').constrained().onDelete('cascade').onUpdate('restrict')
    })
    assert.match(stmt?.sql ?? '', /REFERENCES "users" \("id"\) ON DELETE CASCADE ON UPDATE RESTRICT/)
  })

  it("maps the 'set null' / setNull aliases to SET NULL", () => {
    const [a] = create('posts', (t) => { t.id(); t.foreignId('user_id').constrained().onDelete('set null') })
    const [b] = create('posts', (t) => { t.id(); t.foreignId('user_id').constrained().onDelete('setNull') })
    assert.match(a?.sql ?? '', /ON DELETE SET NULL/)
    assert.match(b?.sql ?? '', /ON DELETE SET NULL/)
  })

  it("maps the 'no action' / noAction aliases to NO ACTION", () => {
    const [stmt] = create('posts', (t) => { t.id(); t.foreignId('user_id').constrained().onUpdate('noAction') })
    assert.match(stmt?.sql ?? '', /ON UPDATE NO ACTION/)
  })

  it('table-level foreign() supports a composite key', () => {
    const [stmt] = create('memberships', (t) => {
      t.id()
      t.integer('orgId')
      t.integer('userId')
      t.foreign(['orgId', 'userId']).references(['org_id', 'user_id']).on('org_users')
    })
    assert.match(
      stmt?.sql ?? '',
      /CONSTRAINT "memberships_orgId_userId_foreign" FOREIGN KEY \("orgId", "userId"\) REFERENCES "org_users" \("org_id", "user_id"\)/,
    )
  })

  it('a custom constraint name overrides the default', () => {
    const [stmt] = create('posts', (t) => {
      t.id()
      t.foreign('user_id').references('id').on('users').name('fk_posts_author')
    })
    assert.match(stmt?.sql ?? '', /CONSTRAINT "fk_posts_author" FOREIGN KEY/)
  })

  it('renders FK constraints after the column lines and primary key', () => {
    const [stmt] = create('posts', (t) => {
      t.id()
      t.foreignId('user_id').constrained()
    })
    const sql = stmt?.sql ?? ''
    assert.ok(sql.indexOf('"user_id" INTEGER') < sql.indexOf('CONSTRAINT'), 'column line precedes the FK constraint')
  })

  it('rejects a foreign-key action outside the allowlist', () => {
    assert.throws(
      () => create('posts', (t) => { t.id(); t.foreignId('user_id').constrained().onDelete('drop table' as never) }),
      (e: unknown) => e instanceof NativeOrmError && e.code === 'NATIVE_DDL_BAD_FK_ACTION',
    )
  })

  it('rejects a references().on() FK missing its referenced table', () => {
    assert.throws(
      () => create('posts', (t) => { t.id(); t.foreignId('user_id').references('id') }),
      (e: unknown) => e instanceof NativeOrmError && e.code === 'NATIVE_DDL_FK_NO_TABLE',
    )
  })

  it('rejects an injection attempt in the referenced table', () => {
    assert.throws(() => create('posts', (t) => { t.id(); t.foreignId('user_id').constrained('users"; DROP TABLE x; --') }))
  })

  it('rejects an injection attempt in a foreign() column name', () => {
    assert.throws(() => create('posts', (t) => { t.id(); t.foreign('a" , "b').references('id').on('users') }))
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

// ── Schema.table alters (7.4) ─────────────────────────────
describe('DDL compiler — ALTER TABLE', () => {
  const alter = (table: string, build: (t: AlterBlueprint) => void) => {
    const bp = new AlterBlueprint(table)
    build(bp)
    return compileAlterTable(bp, dialect)
  }

  it('adds a nullable column', () => {
    const [stmt] = alter('users', (t) => t.string('bio').nullable())
    assert.strictEqual(stmt?.sql, 'ALTER TABLE "users" ADD COLUMN "bio" TEXT')
  })

  it('adds a NOT NULL column when given a default', () => {
    const [stmt] = alter('users', (t) => t.integer('hits').default(0))
    assert.strictEqual(stmt?.sql, 'ALTER TABLE "users" ADD COLUMN "hits" INTEGER NOT NULL DEFAULT 0')
  })

  it('rejects adding a NOT NULL column with no default', () => {
    assert.throws(
      () => alter('users', (t) => t.string('name')),
      (e: unknown) => e instanceof NativeOrmError && e.code === 'NATIVE_DDL_ADD_NOT_NULL',
    )
  })

  it('rejects adding a primary-key column', () => {
    assert.throws(
      () => alter('users', (t) => t.integer('pk').primary()),
      (e: unknown) => e instanceof NativeOrmError && e.code === 'NATIVE_DDL_ADD_PRIMARY',
    )
  })

  it('renames a column', () => {
    const [stmt] = alter('users', (t) => t.renameColumn('name', 'fullName'))
    assert.strictEqual(stmt?.sql, 'ALTER TABLE "users" RENAME COLUMN "name" TO "fullName"')
  })

  it('drops a column', () => {
    const [stmt] = alter('users', (t) => t.dropColumn('legacy'))
    assert.strictEqual(stmt?.sql, 'ALTER TABLE "users" DROP COLUMN "legacy"')
  })

  it('adds a column plus its unique index', () => {
    const stmts = alter('users', (t) => t.string('email').nullable().unique())
    assert.strictEqual(stmts[0]?.sql, 'ALTER TABLE "users" ADD COLUMN "email" TEXT')
    assert.strictEqual(stmts[1]?.sql, 'CREATE UNIQUE INDEX "users_email_unique" ON "users" ("email")')
  })

  it('drops an index by name', () => {
    const [stmt] = alter('users', (t) => t.dropIndex('users_email_unique'))
    assert.strictEqual(stmt?.sql, 'DROP INDEX "users_email_unique"')
  })

  it('orders ops: rename → add → add-index → drop-index → drop-column', () => {
    const stmts = alter('users', (t) => {
      t.dropColumn('old')
      t.string('slug').nullable().index()
      t.renameColumn('a', 'b')
      t.dropIndex('users_stale_index')
    })
    const sql = stmts.map(s => s.sql)
    assert.match(sql[0] ?? '', /RENAME COLUMN "a" TO "b"/)
    assert.match(sql[1] ?? '', /ADD COLUMN "slug"/)
    assert.match(sql[2] ?? '', /CREATE INDEX "users_slug_index"/)
    assert.match(sql[3] ?? '', /DROP INDEX "users_stale_index"/)
    assert.match(sql[4] ?? '', /DROP COLUMN "old"/)
  })

  it('the pure compiler rejects change() — the rebuild lives in SchemaBuilder.table()', () => {
    // compileAlterTable is the in-place ALTER path; a column type change needs
    // live introspection + the table-rebuild dance, which only the (executor-
    // bound) SchemaBuilder.table() can do. The pure compiler therefore throws.
    assert.throws(
      () => alter('users', (t) => t.string('name').change()),
      (e: unknown) => e instanceof NativeNotImplementedError,
    )
  })

  it('rejects an injection attempt in a renamed column', () => {
    assert.throws(() => alter('users', (t) => t.renameColumn('a', 'b"; DROP TABLE x; --')))
  })

  it('rejects ADDing a foreign key on SQLite (no in-place ALTER for FKs)', () => {
    assert.throws(
      () => alter('posts', (t) => t.foreignId('user_id').nullable().constrained()),
      (e: unknown) => e instanceof NativeNotImplementedError,
    )
  })

  it('rejects a table-level foreign() on an alter', () => {
    assert.throws(
      () => alter('posts', (t) => t.foreign('user_id').references('id').on('users')),
      (e: unknown) => e instanceof NativeNotImplementedError,
    )
  })

  it('rejects dropForeign on SQLite with a clear pointer', () => {
    assert.throws(
      () => alter('posts', (t) => t.dropForeign('posts_user_id_foreign')),
      (e: unknown) => e instanceof NativeNotImplementedError,
    )
  })
})

describe('DDL compiler — RENAME TABLE', () => {
  it('compiles a table rename', () => {
    assert.strictEqual(compileRenameTable('users', 'accounts', dialect).sql, 'ALTER TABLE "users" RENAME TO "accounts"')
  })
})
