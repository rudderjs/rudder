import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { RelationExistencePredicate, AggregateRequest } from '@rudderjs/contracts'
import {
  compileSelect,
  compileExists,
  compileAggregateSubselect,
  compileScalarAggregate,
  makeBindings,
  type NativeQueryState,
} from './compiler.js'
import { SqliteDialect } from './dialect.js'
import { NativeIdentifierError } from './errors.js'

const dialect = new SqliteDialect()

function baseState(overrides: Partial<NativeQueryState> = {}): NativeQueryState {
  return {
    table:           'users',
    primaryKey:      'id',
    conditions:      [],
    orders:          [],
    limitN:          null,
    offsetN:         null,
    softDelete:      'with',
    deletedAtColumn: 'deletedAt',
    ...overrides,
  }
}

// ── whereHas / EXISTS ────────────────────────────────────────

describe('native compiler — compileExists (direct)', () => {
  it('hasMany → correlated EXISTS joining related.fk = outer.pk', () => {
    const pred: RelationExistencePredicate = {
      relation: 'posts', exists: true,
      relatedTable: 'posts', parentColumn: 'id', relatedColumn: 'userId',
      constraintWheres: [],
    }
    const b = makeBindings(dialect)
    const sql = compileExists('users', pred, dialect, b)
    assert.strictEqual(sql, 'EXISTS (SELECT 1 FROM "posts" WHERE "posts"."userId" = "users"."id")')
    assert.deepStrictEqual(b.values, [])
  })

  it('whereDoesntHave → NOT EXISTS', () => {
    const pred: RelationExistencePredicate = {
      relation: 'posts', exists: false,
      relatedTable: 'posts', parentColumn: 'id', relatedColumn: 'userId',
      constraintWheres: [],
    }
    const b = makeBindings(dialect)
    const sql = compileExists('users', pred, dialect, b)
    assert.match(sql, /^NOT EXISTS \(/)
  })

  it('constraint wheres are bound and qualified to the related table', () => {
    const pred: RelationExistencePredicate = {
      relation: 'posts', exists: true,
      relatedTable: 'posts', parentColumn: 'id', relatedColumn: 'userId',
      constraintWheres: [{ column: 'published', operator: '=', value: true }],
    }
    const b = makeBindings(dialect)
    const sql = compileExists('users', pred, dialect, b)
    assert.strictEqual(sql,
      'EXISTS (SELECT 1 FROM "posts" WHERE "posts"."userId" = "users"."id" AND "posts"."published" = ?)')
    assert.deepStrictEqual(b.values, [true])
  })

  it('extraEquals (morph discriminator) is bound on the related table', () => {
    const pred: RelationExistencePredicate = {
      relation: 'images', exists: true,
      relatedTable: 'images', parentColumn: 'id', relatedColumn: 'imageableId',
      constraintWheres: [],
      extraEquals: { imageableType: 'User' },
    }
    const b = makeBindings(dialect)
    const sql = compileExists('users', pred, dialect, b)
    assert.strictEqual(sql,
      'EXISTS (SELECT 1 FROM "images" WHERE "images"."imageableId" = "users"."id" AND "images"."imageableType" = ?)')
    assert.deepStrictEqual(b.values, ['User'])
  })

  it('rejects an invalid related-table identifier', () => {
    const pred: RelationExistencePredicate = {
      relation: 'x', exists: true,
      relatedTable: 'po sts', parentColumn: 'id', relatedColumn: 'userId',
      constraintWheres: [],
    }
    assert.throws(() => compileExists('users', pred, dialect, makeBindings(dialect)), NativeIdentifierError)
  })
})

describe('native compiler — compileExists (through pivot)', () => {
  it('belongsToMany → nested EXISTS (pivot → related)', () => {
    const pred: RelationExistencePredicate = {
      relation: 'roles', exists: true,
      relatedTable: 'roles', parentColumn: 'id', relatedColumn: 'id',
      constraintWheres: [],
      through: { pivotTable: 'role_user', foreignPivotKey: 'userId', relatedPivotKey: 'roleId' },
    }
    const b = makeBindings(dialect)
    const sql = compileExists('users', pred, dialect, b)
    assert.strictEqual(sql,
      'EXISTS (SELECT 1 FROM "role_user" WHERE "role_user"."userId" = "users"."id" AND ' +
      'EXISTS (SELECT 1 FROM "roles" WHERE "roles"."id" = "role_user"."roleId"))')
  })

  it('pivot extraEquals + related constraint both appear, correctly placed', () => {
    const pred: RelationExistencePredicate = {
      relation: 'tags', exists: true,
      relatedTable: 'tags', parentColumn: 'id', relatedColumn: 'id',
      constraintWheres: [{ column: 'name', operator: '=', value: 'featured' }],
      extraEquals: { taggableType: 'Post' },
      through: { pivotTable: 'taggables', foreignPivotKey: 'taggableId', relatedPivotKey: 'tagId' },
    }
    const b = makeBindings(dialect)
    const sql = compileExists('posts', pred, dialect, b)
    assert.strictEqual(sql,
      'EXISTS (SELECT 1 FROM "taggables" WHERE "taggables"."taggableId" = "posts"."id" AND ' +
      '"taggables"."taggableType" = ? AND ' +
      'EXISTS (SELECT 1 FROM "tags" WHERE "tags"."id" = "taggables"."tagId" AND "tags"."name" = ?))')
    assert.deepStrictEqual(b.values, ['Post', 'featured'])
  })
})

describe('native compiler — whereHas composes into compileSelect', () => {
  it('flat where + EXISTS are AND-merged with correct binding order', () => {
    const pred: RelationExistencePredicate = {
      relation: 'posts', exists: true,
      relatedTable: 'posts', parentColumn: 'id', relatedColumn: 'userId',
      constraintWheres: [{ column: 'published', operator: '=', value: 1 }],
    }
    const state = baseState({
      conditions: [{ kind: 'clause', boolean: 'AND', clause: { column: 'active', operator: '=', value: 1 } }],
      relationExists: [pred],
    })
    const { sql, bindings } = compileSelect(state, dialect)
    assert.strictEqual(sql,
      'SELECT * FROM "users" WHERE "active" = ? AND ' +
      'EXISTS (SELECT 1 FROM "posts" WHERE "posts"."userId" = "users"."id" AND "posts"."published" = ?)')
    assert.deepStrictEqual(bindings, [1, 1])
  })
})

// ── aggregates ───────────────────────────────────────────────

function countReq(over: Partial<AggregateRequest> = {}): AggregateRequest {
  return {
    relation: 'posts', fn: 'count', alias: 'postsCount',
    joinShape: { relatedTable: 'posts', parentColumn: 'id', relatedColumn: 'userId' },
    constraintWheres: [],
    ...over,
  }
}

describe('native compiler — compileAggregateSubselect', () => {
  it('count → correlated COUNT(*) subselect aliased', () => {
    const b = makeBindings(dialect)
    const sql = compileAggregateSubselect('users', countReq(), dialect, b)
    assert.strictEqual(sql,
      '(SELECT COUNT(*) FROM "posts" WHERE "posts"."userId" = "users"."id") AS "postsCount"')
  })

  it('exists → (COUNT(*) ... ) > 0', () => {
    const b = makeBindings(dialect)
    const req = countReq({ fn: 'exists', alias: 'postsExists' })
    const sql = compileAggregateSubselect('users', req, dialect, b)
    assert.strictEqual(sql,
      '((SELECT COUNT(*) FROM "posts" WHERE "posts"."userId" = "users"."id") > 0) AS "postsExists"')
  })

  it('sum → COALESCE(SUM(col), 0)', () => {
    const b = makeBindings(dialect)
    const req = countReq({ fn: 'sum', column: 'views', alias: 'postsSumViews' })
    const sql = compileAggregateSubselect('users', req, dialect, b)
    assert.strictEqual(sql,
      '(SELECT COALESCE(SUM("posts"."views"), 0) FROM "posts" WHERE "posts"."userId" = "users"."id") AS "postsSumViews"')
  })

  it('soft-deletes on related → adds deletedAt IS NULL', () => {
    const b = makeBindings(dialect)
    const req = countReq({ joinShape: { relatedTable: 'posts', parentColumn: 'id', relatedColumn: 'userId', softDeletes: true } })
    const sql = compileAggregateSubselect('users', req, dialect, b)
    assert.strictEqual(sql,
      '(SELECT COUNT(*) FROM "posts" WHERE "posts"."userId" = "users"."id" AND "posts"."deletedAt" IS NULL) AS "postsCount"')
  })

  it('constraint wheres bound + qualified', () => {
    const b = makeBindings(dialect)
    const req = countReq({ constraintWheres: [{ column: 'published', operator: '=', value: true }], alias: 'publishedCount' })
    const sql = compileAggregateSubselect('users', req, dialect, b)
    assert.strictEqual(sql,
      '(SELECT COUNT(*) FROM "posts" WHERE "posts"."userId" = "users"."id" AND "posts"."published" = ?) AS "publishedCount"')
    assert.deepStrictEqual(b.values, [true])
  })

  it('through-pivot count (no join needed) over the pivot', () => {
    const b = makeBindings(dialect)
    const req = countReq({
      relation: 'roles', alias: 'rolesCount',
      joinShape: {
        relatedTable: 'roles', parentColumn: 'id', relatedColumn: 'id',
        through: { pivotTable: 'role_user', foreignPivotKey: 'userId', relatedPivotKey: 'roleId' },
      },
    })
    const sql = compileAggregateSubselect('users', req, dialect, b)
    assert.strictEqual(sql,
      '(SELECT COUNT(*) FROM "role_user" WHERE "role_user"."userId" = "users"."id") AS "rolesCount"')
  })

  it('through-pivot sum joins pivot → related', () => {
    const b = makeBindings(dialect)
    const req = countReq({
      relation: 'roles', fn: 'sum', column: 'weight', alias: 'rolesSumWeight',
      joinShape: {
        relatedTable: 'roles', parentColumn: 'id', relatedColumn: 'id',
        through: { pivotTable: 'role_user', foreignPivotKey: 'userId', relatedPivotKey: 'roleId' },
      },
    })
    const sql = compileAggregateSubselect('users', req, dialect, b)
    assert.strictEqual(sql,
      '(SELECT COALESCE(SUM("roles"."weight"), 0) FROM "role_user" ' +
      'INNER JOIN "roles" ON "roles"."id" = "role_user"."roleId" ' +
      'WHERE "role_user"."userId" = "users"."id") AS "rolesSumWeight"')
  })
})

describe('native compiler — aggregates compose into compileSelect', () => {
  it('aggregate subselect joins the SELECT list; agg bindings precede WHERE bindings', () => {
    const state = baseState({
      conditions: [{ kind: 'clause', boolean: 'AND', clause: { column: 'active', operator: '=', value: 1 } }],
      aggregates: [countReq({ constraintWheres: [{ column: 'published', operator: '=', value: 2 }] })],
    })
    const { sql, bindings } = compileSelect(state, dialect)
    assert.strictEqual(sql,
      'SELECT *, (SELECT COUNT(*) FROM "posts" WHERE "posts"."userId" = "users"."id" AND "posts"."published" = ?) AS "postsCount" ' +
      'FROM "users" WHERE "active" = ?')
    // agg constraint (2) binds before the WHERE clause (1) — SELECT precedes WHERE
    assert.deepStrictEqual(bindings, [2, 1])
  })
})

describe('native compiler — compileScalarAggregate', () => {
  it('count', () => {
    const { sql } = compileScalarAggregate(baseState({ table: 'posts' }), dialect, 'count', undefined)
    assert.strictEqual(sql, 'SELECT COUNT(*) AS "value" FROM "posts"')
  })
  it('sum coalesces', () => {
    const { sql } = compileScalarAggregate(baseState({ table: 'posts' }), dialect, 'sum', 'views')
    assert.strictEqual(sql, 'SELECT COALESCE(SUM("views"), 0) AS "value" FROM "posts"')
  })
  it('avg with a where predicate', () => {
    const state = baseState({ table: 'posts', conditions: [{ kind: 'clause', boolean: 'AND', clause: { column: 'userId', operator: '=', value: 5 } }] })
    const { sql, bindings } = compileScalarAggregate(state, dialect, 'avg', 'views')
    assert.strictEqual(sql, 'SELECT AVG("views") AS "value" FROM "posts" WHERE "userId" = ?')
    assert.deepStrictEqual(bindings, [5])
  })
})
