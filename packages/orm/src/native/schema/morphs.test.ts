// morphs() / nullableMorphs() / dropMorphs() (gap §2): the migration-side
// helper for polymorphic relations. Scaffolds the camelCase `{name}Id` +
// `{name}Type` pair + a composite index, across all three native dialects, and
// drops them on an alter. Pure DDL-compiler assertions (no driver).

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { SqliteDialect } from '@rudderjs/database/native'
import { PgDialect } from '@rudderjs/database/native'
import { MysqlDialect } from '@rudderjs/database/native'
import type { Dialect } from '@rudderjs/database/native'
import { Blueprint } from './blueprint.js'
import { AlterBlueprint } from './alter-blueprint.js'
import { compileCreateTable, compileAlterTable } from './ddl-compiler.js'

const dialects: Array<[string, Dialect]> = [
  ['sqlite', new SqliteDialect()],
  ['pg',     new PgDialect()],
  ['mysql',  new MysqlDialect()],
]

function create(dialect: Dialect, table: string, build: (t: Blueprint) => void) {
  const bp = new Blueprint(table)
  build(bp)
  return compileCreateTable(bp, dialect)
}

describe('Blueprint.morphs — scaffolds the {name}Id + {name}Type pair + index', () => {
  for (const [label, dialect] of dialects) {
    it(`${label}: emits both columns and the composite [Type, Id] index`, () => {
      const stmts = create(dialect, 'comments', (t) => {
        t.id()
        t.morphs('commentable')
      })
      const create_ = stmts[0]?.sql ?? ''
      // Both polymorphic columns present.
      assert.match(create_, /commentableId/)
      assert.match(create_, /commentableType/)
      // The composite index is the second statement, type-first, Laravel-named.
      const index = stmts[1]?.sql ?? ''
      assert.match(index, /CREATE INDEX/)
      assert.match(index, /comments_commentableType_commentableId_index/)
      // Index column order is [Type, Id].
      assert.ok(
        index.indexOf('commentableType') < index.indexOf('commentableId'),
        'index lists Type before Id',
      )
    })

    it(`${label}: morphs columns are NOT NULL by default`, () => {
      const [stmt] = create(dialect, 'comments', (t) => { t.id(); t.morphs('commentable') })
      // The id column line carries NOT NULL (no nullable() on plain morphs).
      assert.match(stmt?.sql ?? '', /commentableId[^\n]*NOT NULL/)
      assert.match(stmt?.sql ?? '', /commentableType[^\n]*NOT NULL/)
    })
  }

  it('a custom index name overrides the default', () => {
    const stmts = create(new SqliteDialect(), 'comments', (t) => {
      t.id()
      t.morphs('commentable', 'morph_idx')
    })
    assert.match(stmts[1]?.sql ?? '', /CREATE INDEX "morph_idx"/)
  })
})

describe('Blueprint.nullableMorphs — nullable variant', () => {
  for (const [label, dialect] of dialects) {
    it(`${label}: both columns allow NULL`, () => {
      const [stmt] = create(dialect, 'comments', (t) => { t.id(); t.nullableMorphs('commentable') })
      const sql = stmt?.sql ?? ''
      // Neither morph column carries NOT NULL.
      assert.doesNotMatch(sql, /commentableId[^\n]*NOT NULL/)
      assert.doesNotMatch(sql, /commentableType[^\n]*NOT NULL/)
    })
  }
})

describe('AlterBlueprint.dropMorphs — reverses morphs()', () => {
  const alter = (dialect: Dialect, table: string, build: (t: AlterBlueprint) => void) => {
    const bp = new AlterBlueprint(table)
    build(bp)
    return compileAlterTable(bp, dialect)
  }

  it('drops the composite index before the two columns (default name)', () => {
    const stmts = alter(new SqliteDialect(), 'comments', (t) => t.dropMorphs('commentable'))
    const sql = stmts.map(s => s.sql)
    // Order: DROP INDEX precedes both DROP COLUMNs.
    assert.match(sql[0] ?? '', /DROP INDEX "comments_commentableType_commentableId_index"/)
    assert.ok(sql.some(s => /DROP COLUMN "commentableType"/.test(s)))
    assert.ok(sql.some(s => /DROP COLUMN "commentableId"/.test(s)))
    const idxAt = sql.findIndex(s => /DROP INDEX/.test(s))
    const colAt = sql.findIndex(s => /DROP COLUMN/.test(s))
    assert.ok(idxAt < colAt, 'index drop comes before column drops')
  })

  it('honors a custom index name', () => {
    const stmts = alter(new SqliteDialect(), 'comments', (t) => t.dropMorphs('commentable', 'morph_idx'))
    assert.match(stmts[0]?.sql ?? '', /DROP INDEX "morph_idx"/)
  })
})
