// Column modifiers + FK shorthands (gap §3): comment, useCurrentOnUpdate,
// after/first (MySQL positional ADD), Expression (raw) defaults, and the
// cascadeOnDelete/nullOnDelete/restrictOnDelete referential-action shorthands.
// Pure DDL-compiler assertions across the three native dialects.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { raw } from '@rudderjs/contracts'
import { SqliteDialect } from '@rudderjs/database/native'
import { PgDialect } from '@rudderjs/database/native'
import { MysqlDialect } from '@rudderjs/database/native'
import type { Dialect } from '@rudderjs/database/native'
import { Blueprint } from './blueprint.js'
import { AlterBlueprint } from './alter-blueprint.js'
import { compileCreateTable, compileAlterTable } from './ddl-compiler.js'

const sqlite = new SqliteDialect()
const pg     = new PgDialect()
const mysql  = new MysqlDialect()

function create(dialect: Dialect, table: string, build: (t: Blueprint) => void) {
  const bp = new Blueprint(table)
  build(bp)
  return compileCreateTable(bp, dialect)
}
function alter(dialect: Dialect, table: string, build: (t: AlterBlueprint) => void) {
  const bp = new AlterBlueprint(table)
  build(bp)
  return compileAlterTable(bp, dialect)
}

describe('modifier — comment', () => {
  it('mysql renders an inline COMMENT', () => {
    const [stmt] = create(mysql, 'users', (t) => { t.id(); t.string('name').comment("the user's name") })
    assert.match(stmt?.sql ?? '', /`name` varchar\(255\) NOT NULL COMMENT 'the user''s name'/)
  })

  it('pg emits a separate COMMENT ON COLUMN statement', () => {
    const stmts = create(pg, 'users', (t) => { t.id(); t.string('name').comment('full name') })
    assert.ok(stmts.some(s => /COMMENT ON COLUMN "users"\."name" IS 'full name'/.test(s.sql)))
    // ...and NOT inline on the column line.
    assert.doesNotMatch(stmts[0]?.sql ?? '', /COMMENT 'full name'/)
  })

  it('sqlite ignores comments entirely', () => {
    const stmts = create(sqlite, 'users', (t) => { t.id(); t.string('name').comment('ignored') })
    assert.ok(!stmts.some(s => /COMMENT/i.test(s.sql)))
  })
})

describe('modifier — useCurrentOnUpdate', () => {
  it('mysql renders ON UPDATE CURRENT_TIMESTAMP', () => {
    const [stmt] = create(mysql, 't', (t) => { t.id(); t.timestamp('updatedAt').useCurrent().useCurrentOnUpdate() })
    assert.match(stmt?.sql ?? '', /`updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP/)
  })

  it('pg / sqlite silently ignore it', () => {
    const [pgStmt]  = create(pg, 't', (t) => { t.id(); t.timestamp('updatedAt').useCurrentOnUpdate() })
    const [sqStmt]  = create(sqlite, 't', (t) => { t.id(); t.timestamp('updatedAt').useCurrentOnUpdate() })
    assert.doesNotMatch(pgStmt?.sql ?? '', /ON UPDATE/)
    assert.doesNotMatch(sqStmt?.sql ?? '', /ON UPDATE/)
  })
})

describe('modifier — after / first (MySQL positional ADD)', () => {
  it('mysql appends AFTER `col`', () => {
    const [stmt] = alter(mysql, 'users', (t) => t.string('nickname').nullable().after('name'))
    assert.match(stmt?.sql ?? '', /ADD COLUMN `nickname` varchar\(255\) AFTER `name`/)
  })
  it('mysql appends FIRST (and FIRST wins over AFTER)', () => {
    const [stmt] = alter(mysql, 'users', (t) => { const c = t.string('lead').nullable(); c.after('x'); c.first() })
    assert.match(stmt?.sql ?? '', /ADD COLUMN `lead` varchar\(255\) FIRST/)
    assert.doesNotMatch(stmt?.sql ?? '', /AFTER/)
  })
  it('sqlite ignores positional modifiers', () => {
    const [stmt] = alter(sqlite, 'users', (t) => t.string('nickname').nullable().after('name'))
    assert.strictEqual(stmt?.sql, 'ALTER TABLE "users" ADD COLUMN "nickname" TEXT')
  })
})

describe('modifier — Expression (raw) default', () => {
  it('splices a raw() default verbatim (no quoting)', () => {
    const [stmt] = create(pg, 't', (t) => { t.id(); t.uuid('ref').default(raw('gen_random_uuid()')) })
    assert.match(stmt?.sql ?? '', /"ref" uuid NOT NULL DEFAULT gen_random_uuid\(\)/)
  })
  it('a plain string default is still quoted', () => {
    const [stmt] = create(sqlite, 't', (t) => { t.id(); t.string('role').default('user') })
    assert.match(stmt?.sql ?? '', /DEFAULT 'user'/)
  })
})

describe('FK referential-action shorthands', () => {
  it('cascadeOnDelete() on a column FK', () => {
    const [stmt] = create(sqlite, 'posts', (t) => { t.id(); t.foreignId('userId').constrained().cascadeOnDelete() })
    assert.match(stmt?.sql ?? '', /ON DELETE CASCADE/)
  })
  it('nullOnDelete() maps to ON DELETE SET NULL', () => {
    const [stmt] = create(sqlite, 'posts', (t) => { t.id(); t.foreignId('userId').nullable().constrained().nullOnDelete() })
    assert.match(stmt?.sql ?? '', /ON DELETE SET NULL/)
  })
  it('restrictOnDelete() maps to ON DELETE RESTRICT', () => {
    const [stmt] = create(sqlite, 'posts', (t) => { t.id(); t.foreignId('userId').constrained().restrictOnDelete() })
    assert.match(stmt?.sql ?? '', /ON DELETE RESTRICT/)
  })
  it('shorthands work on a table-level foreign() too', () => {
    const [stmt] = create(sqlite, 'posts', (t) => {
      t.id()
      t.integer('userId')
      t.foreign('userId').references('id').on('users').cascadeOnDelete().cascadeOnUpdate()
    })
    assert.match(stmt?.sql ?? '', /ON DELETE CASCADE ON UPDATE CASCADE/)
  })
})
