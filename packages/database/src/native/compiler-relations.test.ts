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

// ── Through relations (fanOut) ───────────────────────────────

describe('native compiler — compileExists (through relation, fanOut)', () => {
  const throughBlock = {
    pivotTable: 'citizens', foreignPivotKey: 'nationId', relatedPivotKey: 'id', fanOut: true,
  }

  it('plain existence keeps the pivot nested-EXISTS shape (fan-out-safe as-is)', () => {
    const pred: RelationExistencePredicate = {
      relation: 'essays', exists: true,
      relatedTable: 'essays', parentColumn: 'id', relatedColumn: 'citizenId',
      constraintWheres: [],
      through: throughBlock,
    }
    const b = makeBindings(dialect)
    const sql = compileExists('nations', pred, dialect, b)
    assert.strictEqual(sql,
      'EXISTS (SELECT 1 FROM "citizens" WHERE "citizens"."nationId" = "nations"."id" AND ' +
      'EXISTS (SELECT 1 FROM "essays" WHERE "essays"."citizenId" = "citizens"."id"))')
  })

  it('count comparison joins the far table — counts FAR rows, not intermediates', () => {
    const pred: RelationExistencePredicate = {
      relation: 'essays', exists: true,
      relatedTable: 'essays', parentColumn: 'id', relatedColumn: 'citizenId',
      constraintWheres: [{ column: 'published', operator: '=', value: 1 }],
      count: { operator: '>=', value: 3 },
      through: throughBlock,
    }
    const b = makeBindings(dialect)
    const sql = compileExists('nations', pred, dialect, b)
    assert.strictEqual(sql,
      '(SELECT COUNT(*) FROM "citizens" ' +
      'INNER JOIN "essays" ON "essays"."citizenId" = "citizens"."id" ' +
      'WHERE "citizens"."nationId" = "nations"."id" AND "essays"."published" = ?) >= 3')
    assert.deepStrictEqual(b.values, [1])
  })

  it('pivot count WITHOUT fanOut keeps the pivot-count shape byte-identical', () => {
    const pred: RelationExistencePredicate = {
      relation: 'roles', exists: true,
      relatedTable: 'roles', parentColumn: 'id', relatedColumn: 'id',
      constraintWheres: [],
      count: { operator: '>=', value: 2 },
      through: { pivotTable: 'role_user', foreignPivotKey: 'userId', relatedPivotKey: 'roleId' },
    }
    const b = makeBindings(dialect)
    const sql = compileExists('users', pred, dialect, b)
    assert.strictEqual(sql,
      '(SELECT COUNT(*) FROM "role_user" WHERE "role_user"."userId" = "users"."id" AND ' +
      'EXISTS (SELECT 1 FROM "roles" WHERE "roles"."id" = "role_user"."roleId")) >= 2')
  })
})

describe('native compiler — compileAggregateSubselect (through relation, fanOut)', () => {
  it('count is forced onto the join branch (the pivot fast path would count intermediates)', () => {
    const b = makeBindings(dialect)
    const req = countReq({
      relation: 'essays', alias: 'essaysCount',
      joinShape: {
        relatedTable: 'essays', parentColumn: 'id', relatedColumn: 'citizenId',
        through: { pivotTable: 'citizens', foreignPivotKey: 'nationId', relatedPivotKey: 'id', fanOut: true },
      },
    })
    const sql = compileAggregateSubselect('nations', req, dialect, b)
    assert.strictEqual(sql,
      '(SELECT COUNT(*) FROM "citizens" ' +
      'INNER JOIN "essays" ON "essays"."citizenId" = "citizens"."id" ' +
      'WHERE "citizens"."nationId" = "nations"."id") AS "essaysCount"')
  })

  it('exists wraps the joined count — a bare intermediate row no longer implies existence', () => {
    const b = makeBindings(dialect)
    const req = countReq({
      relation: 'essays', fn: 'exists', alias: 'essaysExists',
      joinShape: {
        relatedTable: 'essays', parentColumn: 'id', relatedColumn: 'citizenId',
        through: { pivotTable: 'citizens', foreignPivotKey: 'nationId', relatedPivotKey: 'id', fanOut: true },
      },
    })
    const sql = compileAggregateSubselect('nations', req, dialect, b)
    assert.strictEqual(sql,
      '((SELECT COUNT(*) FROM "citizens" ' +
      'INNER JOIN "essays" ON "essays"."citizenId" = "citizens"."id" ' +
      'WHERE "citizens"."nationId" = "nations"."id") > 0) AS "essaysExists"')
  })
})

// ── Callback-nested children (`nested` as an ARRAY) ──────────

describe('native compiler — compileExists (nested children array)', () => {
  it('sibling children compile to consecutive EXISTS clauses, each with its own polarity', () => {
    const pred: RelationExistencePredicate = {
      relation: 'posts', exists: true,
      relatedTable: 'posts', parentColumn: 'id', relatedColumn: 'userId',
      constraintWheres: [{ column: 'published', operator: '=', value: 1 }],
      nested: [
        {
          relation: 'comments', exists: true,
          relatedTable: 'comments', parentColumn: 'id', relatedColumn: 'postId',
          constraintWheres: [{ column: 'approved', operator: '=', value: 1 }],
        },
        {
          relation: 'flags', exists: false,
          relatedTable: 'flags', parentColumn: 'id', relatedColumn: 'postId',
          constraintWheres: [],
        },
      ],
    }
    const b = makeBindings(dialect)
    const sql = compileExists('users', pred, dialect, b)
    assert.strictEqual(sql,
      'EXISTS (SELECT 1 FROM "posts" WHERE "posts"."userId" = "users"."id" AND "posts"."published" = ? AND ' +
      'EXISTS (SELECT 1 FROM "comments" WHERE "comments"."postId" = "posts"."id" AND "comments"."approved" = ?) AND ' +
      'NOT EXISTS (SELECT 1 FROM "flags" WHERE "flags"."postId" = "posts"."id"))')
    // Parent constraint binds first (SQL-text order), then each child's in order.
    assert.deepStrictEqual(b.values, [1, 1])
  })

  it('singular `nested` stays byte-identical to the pre-array form', () => {
    const pred: RelationExistencePredicate = {
      relation: 'posts', exists: true,
      relatedTable: 'posts', parentColumn: 'id', relatedColumn: 'userId',
      constraintWheres: [],
      nested: {
        relation: 'comments', exists: true,
        relatedTable: 'comments', parentColumn: 'id', relatedColumn: 'postId',
        constraintWheres: [],
      },
    }
    const b = makeBindings(dialect)
    assert.strictEqual(compileExists('users', pred, dialect, b),
      'EXISTS (SELECT 1 FROM "posts" WHERE "posts"."userId" = "users"."id" AND ' +
      'EXISTS (SELECT 1 FROM "comments" WHERE "comments"."postId" = "posts"."id"))')
  })

  it('children compose inside a pivot (through-block) level', () => {
    const pred: RelationExistencePredicate = {
      relation: 'roles', exists: true,
      relatedTable: 'roles', parentColumn: 'id', relatedColumn: 'id',
      constraintWheres: [],
      through: { pivotTable: 'role_user', foreignPivotKey: 'userId', relatedPivotKey: 'roleId' },
      nested: [{
        relation: 'grants', exists: true,
        relatedTable: 'grants', parentColumn: 'id', relatedColumn: 'roleId',
        constraintWheres: [{ column: 'action', operator: '=', value: 'edit' }],
      }],
    }
    const b = makeBindings(dialect)
    const sql = compileExists('users', pred, dialect, b)
    assert.strictEqual(sql,
      'EXISTS (SELECT 1 FROM "role_user" WHERE "role_user"."userId" = "users"."id" AND ' +
      'EXISTS (SELECT 1 FROM "roles" WHERE "roles"."id" = "role_user"."roleId" AND ' +
      'EXISTS (SELECT 1 FROM "grants" WHERE "grants"."roleId" = "roles"."id" AND "grants"."action" = ?)))')
    assert.deepStrictEqual(b.values, ['edit'])
  })
})
