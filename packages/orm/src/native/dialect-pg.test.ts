// ─── PgDialect — pure SQL-shape tests (no DB) ──────────────
//
// Covers the Postgres half of the Dialect seam in isolation: identifier quoting,
// placeholder syntax, boolean literals, and the column-type mapping driven
// through the shared DDL compiler. No driver / no live Postgres — these assert
// the emitted SQL text only (live round-trip lands with the postgres driver in a
// follow-up, gated behind PG_TEST_URL in CI).

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { PgDialect } from '@rudderjs/database/native'
import { NativeIdentifierError, NativeOrmError } from '@rudderjs/database/native'
import { Blueprint } from './schema/blueprint.js'
import { compileCreateTable, compileDropTable, compileRenameTable } from './schema/ddl-compiler.js'

const dialect = new PgDialect()

/** Build a Blueprint via its callback and return the compiled statements. */
function create(table: string, build: (t: Blueprint) => void) {
  const bp = new Blueprint(table)
  build(bp)
  return compileCreateTable(bp, dialect)
}

/** First (CREATE TABLE) statement's SQL for a single-column table. */
function colSql(build: (t: Blueprint) => void): string {
  return create('t', build)[0]?.sql ?? ''
}

describe('PgDialect — identity', () => {
  it('reports the pg name and RETURNING support', () => {
    assert.strictEqual(dialect.name, 'pg')
    assert.strictEqual(dialect.supportsReturning, true)
  })
})

describe('PgDialect — quoteId', () => {
  it('double-quotes a plain identifier', () => {
    assert.strictEqual(dialect.quoteId('users'), '"users"')
  })

  it('quotes each segment of a dotted identifier', () => {
    assert.strictEqual(dialect.quoteId('public.users'), '"public"."users"')
  })

  it('rejects an identifier outside the allowlist', () => {
    assert.throws(() => dialect.quoteId('users; DROP TABLE x'), (e: unknown) => e instanceof NativeIdentifierError)
  })
})

describe('PgDialect — placeholder', () => {
  it('uses 1-based $n positional placeholders', () => {
    assert.strictEqual(dialect.placeholder(0), '$1')
    assert.strictEqual(dialect.placeholder(1), '$2')
    assert.strictEqual(dialect.placeholder(41), '$42')
  })
})

describe('PgDialect — booleanLiteral', () => {
  it('renders true/false keywords (not 0/1)', () => {
    assert.strictEqual(dialect.booleanLiteral(true), 'true')
    assert.strictEqual(dialect.booleanLiteral(false), 'false')
  })
})

describe('PgDialect — CREATE TABLE column types', () => {
  it('maps t.id() to a bigserial primary key (no trailing NOT NULL)', () => {
    const [stmt] = create('users', (t) => {
      t.id()
      t.string('name')
    })
    assert.strictEqual(
      stmt?.sql,
      'CREATE TABLE "users" (\n  "id" bigserial PRIMARY KEY,\n  "name" varchar(255) NOT NULL\n)',
    )
    assert.deepStrictEqual(stmt?.bindings, [])
  })

  const cases: Array<[string, (t: Blueprint) => void, RegExp]> = [
    ['string → varchar(255)',          (t) => t.string('a'),        /"a" varchar\(255\) NOT NULL/],
    ['string(n) → varchar(n)',         (t) => t.string('a', 64),    /"a" varchar\(64\) NOT NULL/],
    ['text → text',                    (t) => t.text('a'),          /"a" text NOT NULL/],
    ['uuid → uuid',                    (t) => t.uuid('a'),          /"a" uuid NOT NULL/],
    ['json → jsonb',                   (t) => t.json('a'),          /"a" jsonb NOT NULL/],
    ['integer → integer',              (t) => t.integer('a'),       /"a" integer NOT NULL/],
    ['bigInteger → bigint',            (t) => t.bigInteger('a'),    /"a" bigint NOT NULL/],
    ['boolean → boolean',              (t) => t.boolean('a'),       /"a" boolean NOT NULL/],
    ['dateTime → timestamptz',         (t) => t.dateTime('a'),      /"a" timestamptz NOT NULL/],
    ['timestamp → timestamptz',        (t) => t.timestamp('a'),     /"a" timestamptz NOT NULL/],
    ['float → double precision',       (t) => t.float('a'),         /"a" double precision NOT NULL/],
    ['decimal → numeric(8, 2)',        (t) => t.decimal('a'),       /"a" numeric\(8, 2\) NOT NULL/],
    ['decimal(p,s) → numeric(p, s)',   (t) => t.decimal('a', 12, 4),/"a" numeric\(12, 4\) NOT NULL/],
    ['binary → bytea',                 (t) => t.binary('a'),        /"a" bytea NOT NULL/],
  ]
  for (const [name, build, re] of cases) {
    it(name, () => assert.match(colSql(build), re))
  }
})

describe('PgDialect — modifiers via the shared compiler', () => {
  it('renders a nullable column without NOT NULL', () => {
    assert.match(colSql((t) => t.string('bio').nullable()), /"bio" varchar\(255\)(?! NOT NULL)/)
  })

  it('renders a boolean DEFAULT as true/false (not 1/0)', () => {
    assert.match(colSql((t) => t.boolean('active').default(true)),  /"active" boolean NOT NULL DEFAULT true/)
    assert.match(colSql((t) => t.boolean('active').default(false)), /"active" boolean NOT NULL DEFAULT false/)
  })

  it('renders a string DEFAULT as an escaped literal', () => {
    assert.match(colSql((t) => t.string('role').default("ad'min")), /DEFAULT 'ad''min'/)
  })

  it('renders useCurrent() as DEFAULT CURRENT_TIMESTAMP', () => {
    assert.match(colSql((t) => t.timestamp('created_at').useCurrent()), /"created_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP/)
  })
})

describe('PgDialect — indexes & foreign keys', () => {
  it('emits a CREATE INDEX for a .unique() column', () => {
    const stmts = create('users', (t) => {
      t.id()
      t.string('email').unique()
    })
    const idx = stmts.find((s) => s.sql.startsWith('CREATE UNIQUE INDEX'))
    assert.ok(idx, 'expected a CREATE UNIQUE INDEX statement')
    assert.match(idx?.sql ?? '', /CREATE UNIQUE INDEX "users_email_unique" ON "users" \("email"\)/)
  })

  it('emits a FOREIGN KEY constraint with ON DELETE for constrained()', () => {
    const [stmt] = create('posts', (t) => {
      t.id()
      t.bigInteger('user_id')
      t.foreign('user_id').references('id').on('users').onDelete('cascade')
    })
    assert.match(stmt?.sql ?? '', /CONSTRAINT "posts_user_id_foreign" FOREIGN KEY \("user_id"\) REFERENCES "users" \("id"\) ON DELETE CASCADE/)
  })
})

describe('PgDialect — drop & rename', () => {
  it('compiles DROP TABLE IF EXISTS', () => {
    assert.strictEqual(compileDropTable('users', { ifExists: true }, dialect).sql, 'DROP TABLE IF EXISTS "users"')
  })

  it('compiles ALTER TABLE … RENAME TO', () => {
    assert.strictEqual(compileRenameTable('users', 'accounts', dialect).sql, 'ALTER TABLE "users" RENAME TO "accounts"')
  })
})

describe('PgDialect — upsertClause', () => {
  it('builds ON CONFLICT (...) DO UPDATE with excluded refs', () => {
    assert.strictEqual(
      dialect.upsertClause(['email'], ['name', 'visits']),
      'ON CONFLICT ("email") DO UPDATE SET "name" = excluded."name", "visits" = excluded."visits"',
    )
  })
  it('empty update → DO NOTHING', () => {
    assert.strictEqual(dialect.upsertClause(['email'], []), 'ON CONFLICT ("email") DO NOTHING')
  })
})

describe('PgDialect — guards', () => {
  it('throws NATIVE_DDL_EMPTY_TABLE on a table with no columns', () => {
    assert.throws(
      () => compileCreateTable(new Blueprint('empty'), dialect),
      (e: unknown) => e instanceof NativeOrmError && e.code === 'NATIVE_DDL_EMPTY_TABLE',
    )
  })
})
