// ─── MysqlDialect — pure SQL-shape tests (no DB) ───────────
//
// Covers the MySQL half of the Dialect seam in isolation: backtick identifier
// quoting, `?` placeholders, integer boolean literals, RETURNING=false, and the
// column-type mapping driven through the shared DDL compiler. No driver / no live
// MySQL — these assert the emitted SQL text only (live round-trip lands in
// drivers/mysql.test.ts, gated behind MYSQL_TEST_URL in CI).

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { MysqlDialect } from './dialect-mysql.js'
import { NativeIdentifierError, NativeOrmError } from './errors.js'
import { Blueprint } from './schema/blueprint.js'
import { compileCreateTable, compileDropTable, compileRenameTable } from './schema/ddl-compiler.js'

const dialect = new MysqlDialect()

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

describe('MysqlDialect — identity', () => {
  it('reports the mysql name and NO RETURNING support', () => {
    assert.strictEqual(dialect.name, 'mysql')
    assert.strictEqual(dialect.supportsReturning, false)
  })
})

describe('MysqlDialect — quoteId', () => {
  it('backtick-quotes a plain identifier', () => {
    assert.strictEqual(dialect.quoteId('users'), '`users`')
  })

  it('quotes each segment of a dotted identifier', () => {
    assert.strictEqual(dialect.quoteId('app.users'), '`app`.`users`')
  })

  it('rejects an identifier outside the allowlist', () => {
    assert.throws(() => dialect.quoteId('users; DROP TABLE x'), (e: unknown) => e instanceof NativeIdentifierError)
  })
})

describe('MysqlDialect — placeholder', () => {
  it('uses literal ? positional placeholders (index ignored)', () => {
    assert.strictEqual(dialect.placeholder(0), '?')
    assert.strictEqual(dialect.placeholder(41), '?')
  })
})

describe('MysqlDialect — booleanLiteral', () => {
  it('renders 1/0 integers (no boolean type)', () => {
    assert.strictEqual(dialect.booleanLiteral(true), '1')
    assert.strictEqual(dialect.booleanLiteral(false), '0')
  })
})

describe('MysqlDialect — CREATE TABLE column types', () => {
  it('maps t.id() to bigint AUTO_INCREMENT PRIMARY KEY (no trailing NOT NULL)', () => {
    const [stmt] = create('users', (t) => {
      t.id()
      t.string('name')
    })
    assert.strictEqual(
      stmt?.sql,
      'CREATE TABLE `users` (\n  `id` bigint AUTO_INCREMENT PRIMARY KEY,\n  `name` varchar(255) NOT NULL\n)',
    )
    assert.deepStrictEqual(stmt?.bindings, [])
  })

  const cases: Array<[string, (t: Blueprint) => void, RegExp]> = [
    ['string → varchar(255)',          (t) => t.string('a'),        /`a` varchar\(255\) NOT NULL/],
    ['string(n) → varchar(n)',         (t) => t.string('a', 64),    /`a` varchar\(64\) NOT NULL/],
    ['text → text',                    (t) => t.text('a'),          /`a` text NOT NULL/],
    ['uuid → char(36)',                (t) => t.uuid('a'),          /`a` char\(36\) NOT NULL/],
    ['json → json',                    (t) => t.json('a'),          /`a` json NOT NULL/],
    ['integer → int',                  (t) => t.integer('a'),       /`a` int NOT NULL/],
    ['bigInteger → bigint',            (t) => t.bigInteger('a'),    /`a` bigint NOT NULL/],
    ['boolean → tinyint(1)',           (t) => t.boolean('a'),       /`a` tinyint\(1\) NOT NULL/],
    ['dateTime → datetime',            (t) => t.dateTime('a'),      /`a` datetime NOT NULL/],
    ['timestamp → timestamp',          (t) => t.timestamp('a'),     /`a` timestamp NOT NULL/],
    ['float → double',                 (t) => t.float('a'),         /`a` double NOT NULL/],
    ['decimal → decimal(8, 2)',        (t) => t.decimal('a'),       /`a` decimal\(8, 2\) NOT NULL/],
    ['decimal(p,s) → decimal(p, s)',   (t) => t.decimal('a', 12, 4),/`a` decimal\(12, 4\) NOT NULL/],
    ['binary → blob',                  (t) => t.binary('a'),        /`a` blob NOT NULL/],
  ]
  for (const [name, build, re] of cases) {
    it(name, () => assert.match(colSql(build), re))
  }
})

describe('MysqlDialect — modifiers via the shared compiler', () => {
  it('renders a nullable column without NOT NULL', () => {
    assert.match(colSql((t) => t.string('bio').nullable()), /`bio` varchar\(255\)(?! NOT NULL)/)
  })

  it('renders a boolean DEFAULT as 1/0 (not true/false)', () => {
    assert.match(colSql((t) => t.boolean('active').default(true)),  /`active` tinyint\(1\) NOT NULL DEFAULT 1/)
    assert.match(colSql((t) => t.boolean('active').default(false)), /`active` tinyint\(1\) NOT NULL DEFAULT 0/)
  })

  it('renders a string DEFAULT as an escaped literal', () => {
    assert.match(colSql((t) => t.string('role').default("ad'min")), /DEFAULT 'ad''min'/)
  })

  it('renders useCurrent() as DEFAULT CURRENT_TIMESTAMP', () => {
    assert.match(colSql((t) => t.timestamp('created_at').useCurrent()), /`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP/)
  })
})

describe('MysqlDialect — indexes & foreign keys', () => {
  it('emits a CREATE INDEX for a .unique() column', () => {
    const stmts = create('users', (t) => {
      t.id()
      t.string('email').unique()
    })
    const idx = stmts.find((s) => s.sql.startsWith('CREATE UNIQUE INDEX'))
    assert.ok(idx, 'expected a CREATE UNIQUE INDEX statement')
    assert.match(idx?.sql ?? '', /CREATE UNIQUE INDEX `users_email_unique` ON `users` \(`email`\)/)
  })

  it('emits a FOREIGN KEY constraint with ON DELETE for constrained()', () => {
    const [stmt] = create('posts', (t) => {
      t.id()
      t.bigInteger('user_id')
      t.foreign('user_id').references('id').on('users').onDelete('cascade')
    })
    assert.match(stmt?.sql ?? '', /CONSTRAINT `posts_user_id_foreign` FOREIGN KEY \(`user_id`\) REFERENCES `users` \(`id`\) ON DELETE CASCADE/)
  })
})

describe('MysqlDialect — drop & rename', () => {
  it('compiles DROP TABLE IF EXISTS', () => {
    assert.strictEqual(compileDropTable('users', { ifExists: true }, dialect).sql, 'DROP TABLE IF EXISTS `users`')
  })

  it('compiles ALTER TABLE … RENAME TO', () => {
    assert.strictEqual(compileRenameTable('users', 'accounts', dialect).sql, 'ALTER TABLE `users` RENAME TO `accounts`')
  })
})

describe('MysqlDialect — upsertClause', () => {
  it('builds ON DUPLICATE KEY UPDATE with VALUES() refs (ignores uniqueBy)', () => {
    assert.strictEqual(
      dialect.upsertClause(['email'], ['name', 'visits']),
      'ON DUPLICATE KEY UPDATE `name` = VALUES(`name`), `visits` = VALUES(`visits`)',
    )
  })
  it('empty update → no-op self-assignment on the first uniqueBy column', () => {
    assert.strictEqual(dialect.upsertClause(['email'], []), 'ON DUPLICATE KEY UPDATE `email` = VALUES(`email`)')
  })
})

describe('MysqlDialect — guards', () => {
  it('throws NATIVE_DDL_EMPTY_TABLE on a table with no columns', () => {
    assert.throws(
      () => compileCreateTable(new Blueprint('empty'), dialect),
      (e: unknown) => e instanceof NativeOrmError && e.code === 'NATIVE_DDL_EMPTY_TABLE',
    )
  })
})
