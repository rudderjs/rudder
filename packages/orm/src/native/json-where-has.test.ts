// Arrow-path JSON predicates inside whereHas constrain callbacks (native) —
// `whereHas('posts', q => q.where('meta->lang', 'en'))`. The constraint
// recorder captures the arrow column as a plain WhereClause; `compileClauseOn`
// detects the arrow and routes through the same `compileJsonComparison` body
// (Dialect.jsonExtract seam) as top-level `json` condition nodes, with the
// base column qualified to the related table.
//
// Compiler units pin the SQL text + positional binding order per dialect
// (including the through-pivot shape, where the constraint binds AFTER the
// pivot's extraEquals — SQL-text order); injection tests prove constraint path
// segments can't escape the quoting; the sqlite E2E proves the path end-to-end
// on a real in-memory engine; gated live-pg / live-mysql blocks exercise the
// operators live.

import { describe, it, test, before, after, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import type { RelationExistencePredicate, AggregateRequest } from '@rudderjs/contracts'
import { compileExists, compileAggregateSubselect, makeBindings } from '@rudderjs/database/native'
import { SqliteDialect } from '@rudderjs/database/native'
import { PgDialect } from '@rudderjs/database/native'
import { MysqlDialect } from '@rudderjs/database/native'
import { NativeOrmError } from '@rudderjs/database/native'
import { Model, ModelRegistry } from '../index.js'
import { NativeAdapter } from './adapter.js'
import { BetterSqlite3Driver } from '@rudderjs/database/native'
import { PostgresDriver } from '@rudderjs/database/native'
import { MysqlDriver } from '@rudderjs/database/native'
import type { Driver } from '@rudderjs/database/native'

const sqlite = new SqliteDialect()
const pg     = new PgDialect()
const mysql  = new MysqlDialect()

function directPred(constraintWheres: RelationExistencePredicate['constraintWheres']): RelationExistencePredicate {
  return {
    relation: 'posts', exists: true,
    relatedTable: 'posts', parentColumn: 'id', relatedColumn: 'userId',
    constraintWheres,
  }
}

// ── Compiler units — SQL text + binding order per dialect ──

describe('compileExists — arrow-path constraint wheres', () => {
  it('sqlite: arrow constraint → json_extract qualified to the related table', () => {
    const b = makeBindings(sqlite)
    const sql = compileExists('users', directPred([{ column: 'meta->lang', operator: '=', value: 'en' }]), sqlite, b)
    assert.strictEqual(sql,
      'EXISTS (SELECT 1 FROM "posts" WHERE "posts"."userId" = "users"."id" AND ' +
      'json_extract("posts"."meta", \'$."lang"\') = ?)')
    assert.deepStrictEqual(b.values, ['en'])
  })

  it('pg: text comparison → ->> chain; number → ::numeric cast', () => {
    const b1 = makeBindings(pg)
    const sql1 = compileExists('users', directPred([{ column: 'meta->prefs->lang', operator: '=', value: 'en' }]), pg, b1)
    assert.strictEqual(sql1,
      'EXISTS (SELECT 1 FROM "posts" WHERE "posts"."userId" = "users"."id" AND ' +
      '"posts"."meta"->\'prefs\'->>\'lang\' = $1)')
    assert.deepStrictEqual(b1.values, ['en'])

    const b2 = makeBindings(pg)
    const sql2 = compileExists('users', directPred([{ column: 'meta->score', operator: '>', value: 5 }]), pg, b2)
    assert.strictEqual(sql2,
      'EXISTS (SELECT 1 FROM "posts" WHERE "posts"."userId" = "users"."id" AND ' +
      '("posts"."meta"->>\'score\')::numeric > $1)')
    assert.deepStrictEqual(b2.values, [5])
  })

  it('mysql: JSON_UNQUOTE(JSON_EXTRACT(…)) with backtick-qualified column', () => {
    const b = makeBindings(mysql)
    const sql = compileExists('users', directPred([{ column: 'meta->lang', operator: '=', value: 'en' }]), mysql, b)
    assert.strictEqual(sql,
      'EXISTS (SELECT 1 FROM `posts` WHERE `posts`.`userId` = `users`.`id` AND ' +
      'JSON_UNQUOTE(JSON_EXTRACT(`posts`.`meta`, \'$."lang"\')) = ?)')
    assert.deepStrictEqual(b.values, ['en'])
  })

  it('boolean values normalize per dialect (sqlite 1/0 bound; mysql literal spliced)', () => {
    const bS = makeBindings(sqlite)
    const sqlS = compileExists('users', directPred([{ column: 'meta->active', operator: '=', value: true }]), sqlite, bS)
    assert.match(sqlS, /json_extract\("posts"\."meta", '\$\."active"'\) = \?\)$/)
    assert.deepStrictEqual(bS.values, [1])

    const bM = makeBindings(mysql)
    const sqlM = compileExists('users', directPred([{ column: 'meta->active', operator: '=', value: true }]), mysql, bM)
    // mysql booleans skip UNQUOTE and splice the SQL literal — nothing binds.
    assert.match(sqlM, /JSON_EXTRACT\(`posts`\.`meta`, '\$\."active"'\) = true\)$/)
    assert.deepStrictEqual(bM.values, [])
  })

  it('all-digit segments become array indexes; IS NULL semantics ride the shared tail', () => {
    const b = makeBindings(sqlite)
    const sql = compileExists('users', directPred([
      { column: 'meta->items->0', operator: '=', value: 'a' },
      { column: 'meta->missing', operator: '=', value: null },
    ]), sqlite, b)
    assert.strictEqual(sql,
      'EXISTS (SELECT 1 FROM "posts" WHERE "posts"."userId" = "users"."id" AND ' +
      'json_extract("posts"."meta", \'$."items"[0]\') = ? AND ' +
      'json_extract("posts"."meta", \'$."missing"\') IS NULL)')
    assert.deepStrictEqual(b.values, ['a'])
  })

  it('through-pivot: arrow constraint binds AFTER the pivot extraEquals (SQL-text order)', () => {
    const pred: RelationExistencePredicate = {
      relation: 'tags', exists: true,
      relatedTable: 'tags', parentColumn: 'id', relatedColumn: 'id',
      constraintWheres: [{ column: 'meta->kind', operator: '=', value: 'topic' }],
      extraEquals: { taggableType: 'Post' },
      through: { pivotTable: 'taggables', foreignPivotKey: 'taggableId', relatedPivotKey: 'tagId' },
    }
    const b = makeBindings(sqlite)
    const sql = compileExists('posts', pred, sqlite, b)
    assert.strictEqual(sql,
      'EXISTS (SELECT 1 FROM "taggables" WHERE "taggables"."taggableId" = "posts"."id" AND ' +
      '"taggables"."taggableType" = ? AND ' +
      'EXISTS (SELECT 1 FROM "tags" WHERE "tags"."id" = "taggables"."tagId" AND ' +
      'json_extract("tags"."meta", \'$."kind"\') = ?))')
    assert.deepStrictEqual(b.values, ['Post', 'topic'])
  })

  it('count form: (SELECT COUNT(*) …) keeps the arrow constraint', () => {
    const pred = directPred([{ column: 'meta->lang', operator: '=', value: 'en' }])
    pred.count = { operator: '>=', value: 2 }
    const b = makeBindings(sqlite)
    const sql = compileExists('users', pred, sqlite, b)
    assert.strictEqual(sql,
      '(SELECT COUNT(*) FROM "posts" WHERE "posts"."userId" = "users"."id" AND ' +
      'json_extract("posts"."meta", \'$."lang"\') = ?) >= 2')
    assert.deepStrictEqual(b.values, ['en'])
  })

  it('aggregate subselect (withCount constraint) routes arrow paths too', () => {
    const req: AggregateRequest = {
      relation: 'posts', fn: 'count', alias: 'postsCount',
      joinShape: { relatedTable: 'posts', parentColumn: 'id', relatedColumn: 'userId' },
      constraintWheres: [{ column: 'meta->lang', operator: '=', value: 'en' }],
    }
    const b = makeBindings(sqlite)
    const sql = compileAggregateSubselect('users', req, sqlite, b)
    assert.match(sql, /json_extract\("posts"\."meta", '\$\."lang"'\) = \?/)
    assert.deepStrictEqual(b.values, ['en'])
  })

  it('rejects injection attempts in constraint path segments', () => {
    for (const column of [
      `meta->x') OR ('1'='1`,
      'meta->x"]) --',
      'meta->x`y',
      'meta->a\\b',
    ]) {
      assert.throws(
        () => compileExists('users', directPred([{ column, operator: '=', value: 1 }]), sqlite, makeBindings(sqlite)),
        NativeOrmError,
      )
    }
  })
})

// ── End-to-end on real sqlite ──

class User extends Model {
  static override table = 'users'
  static override relations = {
    posts: { type: 'hasMany' as const, model: () => Post, foreignKey: 'userId' },
  }
  id!: number
  name!: string
}

class Post extends Model {
  static override table = 'posts'
  id!: number
  userId!: number
  meta!: Record<string, unknown>
}

let driver: Driver

// Ada: en post + fr post · Alan: fr post · Grace: no posts
const users: Array<[number, string]> = [[1, 'Ada'], [2, 'Alan'], [3, 'Grace']]
const posts: Array<[number, number, string]> = [
  [1, 1, JSON.stringify({ lang: 'en', score: 9, active: true })],
  [2, 1, JSON.stringify({ lang: 'fr', score: 3, active: false })],
  [3, 2, JSON.stringify({ lang: 'fr', score: 7, active: true })],
]

describe('whereHas arrow-path constraints (native, sqlite E2E)', () => {
  beforeEach(async () => {
    driver = await BetterSqlite3Driver.open({ filename: ':memory:' })
    await driver.execute(`CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)`, [])
    await driver.execute(`CREATE TABLE posts (id INTEGER PRIMARY KEY, userId INTEGER, meta TEXT)`, [])
    ModelRegistry.reset()
    ModelRegistry.set(await NativeAdapter.make({ driverInstance: driver }))
    for (const [id, name] of users) await driver.execute(`INSERT INTO users (id, name) VALUES (?, ?)`, [id, name])
    for (const p of posts) await driver.execute(`INSERT INTO posts (id, userId, meta) VALUES (?, ?, ?)`, p)
  })

  afterEach(async () => { await driver.close() })

  const names = (rows: User[]): string[] => rows.map(r => r.name).sort()

  it('whereHas with an arrow-path equality constraint', async () => {
    assert.deepStrictEqual(names(await User.whereHas('posts', q => q.where('meta->lang', 'en')).get()), ['Ada'])
    assert.deepStrictEqual(names(await User.whereHas('posts', q => q.where('meta->lang', 'fr')).get()), ['Ada', 'Alan'])
  })

  it('arrow-path operator + boolean constraints', async () => {
    assert.deepStrictEqual(names(await User.whereHas('posts', q => q.where('meta->score', '>', 5)).get()), ['Ada', 'Alan'])
    assert.deepStrictEqual(names(await User.whereHas('posts', q => q.where('meta->active', true)).get()), ['Ada', 'Alan'])
    assert.deepStrictEqual(names(await User.whereHas('posts', q => q.where('meta->active', false)).get()), ['Ada'])
  })

  it('whereDoesntHave with an arrow-path constraint', async () => {
    // users with NO en post → Alan + Grace
    assert.deepStrictEqual(names(await User.whereDoesntHave('posts', q => q.where('meta->lang', 'en')).get()), ['Alan', 'Grace'])
  })

  it('has(rel, op, n) with an arrow-path constraint', async () => {
    // users with >= 2 fr posts → none; >= 1 fr post → Ada + Alan
    assert.deepStrictEqual(names(await User.has('posts', '>=', 2, q => q.where('meta->lang', 'fr')).get()), [])
    assert.deepStrictEqual(names(await User.has('posts', '>=', 1, q => q.where('meta->lang', 'fr')).get()), ['Ada', 'Alan'])
  })

  it('orWhereHas with an arrow-path constraint', async () => {
    const rows = await User.query().where('name', 'Grace').orWhereHas('posts', q => q.where('meta->lang', 'en')).get()
    assert.deepStrictEqual(names(rows), ['Ada', 'Grace'])
  })

  it('arrow + plain constraints compose in one callback', async () => {
    const rows = await User.whereHas('posts', q => q.where('meta->lang', 'fr').where('userId', 2)).get()
    assert.deepStrictEqual(names(rows), ['Alan'])
  })

  it('whereRelation sugar takes arrow paths', async () => {
    assert.deepStrictEqual(names(await User.whereRelation('posts', 'meta->lang', 'en').get()), ['Ada'])
  })

  it('withCount constraint takes arrow paths', async () => {
    const rows = await User.query().withCount({ posts: q => q.where('meta->lang', 'fr') }).get() as Array<User & { postsCount: number }>
    const byName = new Map(rows.map(r => [r.name, r.postsCount]))
    assert.strictEqual(byName.get('Ada'), 1)
    assert.strictEqual(byName.get('Alan'), 1)
    assert.strictEqual(byName.get('Grace'), 0)
  })

  it('injection attempt in a constraint arrow path throws before any SQL runs', async () => {
    await assert.rejects(
      User.whereHas('posts', q => q.where(`meta->x') OR ('1'='1`, 1)).get(),
      NativeOrmError,
    )
  })
})

// ── Live Postgres round-trip ──

const PG_URL = process.env['PG_TEST_URL']

if (!PG_URL) {
  test('whereHas arrow constraints pg round-trip (skipped — set PG_TEST_URL to run)', { skip: true }, () => {})
} else {
  describe('whereHas arrow constraints (live pg)', () => {
    class PgAuthor extends Model {
      static override table = 'rudder_jwh_users'
      static override relations = {
        posts: { type: 'hasMany' as const, model: () => PgArticle, foreignKey: 'userId' },
      }
      id!: number
      name!: string
    }
    class PgArticle extends Model {
      static override table = 'rudder_jwh_posts'
      id!: number
      userId!: number
      meta!: Record<string, unknown>
    }
    let pgDriver: PostgresDriver

    before(async () => {
      pgDriver = await PostgresDriver.open({ url: PG_URL })
      await pgDriver.execute(`DROP TABLE IF EXISTS rudder_jwh_posts`, [])
      await pgDriver.execute(`DROP TABLE IF EXISTS rudder_jwh_users`, [])
      await pgDriver.execute(`CREATE TABLE rudder_jwh_users (id SERIAL PRIMARY KEY, name TEXT)`, [])
      await pgDriver.execute(`CREATE TABLE rudder_jwh_posts (id SERIAL PRIMARY KEY, "userId" INT, meta JSONB)`, [])
      // Seed via SQL LITERALS, not bound params (#858 serializer caution).
      for (const [id, name] of users) {
        await pgDriver.execute(`INSERT INTO rudder_jwh_users (id, name) VALUES (${id}, '${name}')`, [])
      }
      for (const [id, userId, meta] of posts) {
        const json = meta.replace(/'/g, "''")
        await pgDriver.execute(`INSERT INTO rudder_jwh_posts (id, "userId", meta) VALUES (${id}, ${userId}, '${json}'::jsonb)`, [])
      }
    })
    after(async () => {
      await pgDriver.execute(`DROP TABLE IF EXISTS rudder_jwh_posts`, [])
      await pgDriver.execute(`DROP TABLE IF EXISTS rudder_jwh_users`, [])
      await pgDriver.close()
    })
    beforeEach(async () => {
      ModelRegistry.reset()
      ModelRegistry.set(await NativeAdapter.make({ driverInstance: pgDriver, dialect: new PgDialect() }))
    })

    const names = (rows: PgAuthor[]): string[] => rows.map(r => r.name).sort()

    it('arrow constraints run live: text, ::numeric, ::boolean', async () => {
      assert.deepStrictEqual(names(await PgAuthor.whereHas('posts', q => q.where('meta->lang', 'en')).get()), ['Ada'])
      assert.deepStrictEqual(names(await PgAuthor.whereHas('posts', q => q.where('meta->score', '>', 5)).get()), ['Ada', 'Alan'])
      assert.deepStrictEqual(names(await PgAuthor.whereHas('posts', q => q.where('meta->active', true)).get()), ['Ada', 'Alan'])
      assert.deepStrictEqual(names(await PgAuthor.whereDoesntHave('posts', q => q.where('meta->lang', 'en')).get()), ['Alan', 'Grace'])
    })
  })
}

// ── Live MySQL round-trip ──

const MYSQL_URL = process.env['MYSQL_TEST_URL']

if (!MYSQL_URL) {
  test('whereHas arrow constraints mysql round-trip (skipped — set MYSQL_TEST_URL to run)', { skip: true }, () => {})
} else {
  describe('whereHas arrow constraints (live mysql)', () => {
    class MyAuthor extends Model {
      static override table = 'rudder_jwh_users'
      static override relations = {
        posts: { type: 'hasMany' as const, model: () => MyArticle, foreignKey: 'userId' },
      }
      id!: number
      name!: string
    }
    class MyArticle extends Model {
      static override table = 'rudder_jwh_posts'
      id!: number
      userId!: number
      meta!: Record<string, unknown>
    }
    let myDriver: MysqlDriver

    before(async () => {
      myDriver = await MysqlDriver.open({ url: MYSQL_URL })
      await myDriver.execute(`DROP TABLE IF EXISTS rudder_jwh_posts`, [])
      await myDriver.execute(`DROP TABLE IF EXISTS rudder_jwh_users`, [])
      await myDriver.execute(`CREATE TABLE rudder_jwh_users (id INT PRIMARY KEY, name TEXT)`, [])
      await myDriver.execute(`CREATE TABLE rudder_jwh_posts (id INT PRIMARY KEY, userId INT, meta JSON)`, [])
      // Seed via SQL LITERALS (same convention as the pg block above).
      for (const [id, name] of users) {
        await myDriver.execute(`INSERT INTO rudder_jwh_users (id, name) VALUES (${id}, '${name}')`, [])
      }
      for (const [id, userId, meta] of posts) {
        const json = meta.replace(/'/g, "''")
        await myDriver.execute(`INSERT INTO rudder_jwh_posts (id, userId, meta) VALUES (${id}, ${userId}, '${json}')`, [])
      }
    })
    after(async () => {
      await myDriver.execute(`DROP TABLE IF EXISTS rudder_jwh_posts`, [])
      await myDriver.execute(`DROP TABLE IF EXISTS rudder_jwh_users`, [])
      await myDriver.close()
    })
    beforeEach(async () => {
      ModelRegistry.reset()
      ModelRegistry.set(await NativeAdapter.make({ driverInstance: myDriver, dialect: new MysqlDialect() }))
    })

    const names = (rows: MyAuthor[]): string[] => rows.map(r => r.name).sort()

    it('arrow constraints run live: text, numeric coercion, boolean literals', async () => {
      assert.deepStrictEqual(names(await MyAuthor.whereHas('posts', q => q.where('meta->lang', 'en')).get()), ['Ada'])
      assert.deepStrictEqual(names(await MyAuthor.whereHas('posts', q => q.where('meta->score', '>', 5)).get()), ['Ada', 'Alan'])
      assert.deepStrictEqual(names(await MyAuthor.whereHas('posts', q => q.where('meta->active', true)).get()), ['Ada', 'Alan'])
      assert.deepStrictEqual(names(await MyAuthor.whereHas('posts', q => q.where('meta->active', false)).get()), ['Ada'])
      assert.deepStrictEqual(names(await MyAuthor.whereDoesntHave('posts', q => q.where('meta->lang', 'en')).get()), ['Alan', 'Grace'])
    })
  })
}
