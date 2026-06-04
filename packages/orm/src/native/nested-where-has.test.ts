// Nested whereHas (`'posts.comments'`) on the native engine — dot-path
// relation chains compile as nested correlated EXISTS. The Model layer
// (`buildNestedRelationPredicate`) parses the path into a predicate chain
// (`nested` child predicates, Laravel `hasNested` semantics: outer levels are
// plain existence, the callback + count sit on the DEEPEST level, and
// `whereDoesntHave` flips only the OUTERMOST exists); `compileExists` recurses.
//
// Compiler units pin the SQL text + positional binding order (nested child
// compiled last in the EXISTS body, after constraint wheres); the
// byte-identical gate for single-level predicates is the untouched
// compiler-relations / where-has-ops suites; the sqlite E2E proves Laravel
// semantics on real data (incl. the "post without comments doesn't defeat
// whereDoesntHave" edge); the adapter-guard test proves the clear Model-layer
// throw on adapter QBs without `supportsNestedRelationPredicates`
// (Drizzle/Prisma); gated live-pg / live-mysql blocks run the chains live.

import { describe, it, test, before, after, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import type { OrmAdapter, QueryBuilder, RelationExistencePredicate } from '@rudderjs/contracts'
import { compileExists, makeBindings } from '@rudderjs/database/native'
import { SqliteDialect } from '@rudderjs/database/native'
import { PgDialect } from '@rudderjs/database/native'
import { MysqlDialect } from '@rudderjs/database/native'
import { Model, ModelRegistry } from '../index.js'
import { buildNestedRelationPredicate } from '../relations/where-has.js'
import { NativeAdapter } from './adapter.js'
import { BetterSqlite3Driver } from '@rudderjs/database/native'
import { PostgresDriver } from '@rudderjs/database/native'
import { MysqlDriver } from '@rudderjs/database/native'
import type { Driver } from '@rudderjs/database/native'

const sqlite = new SqliteDialect()

// ── Compiler units — nested EXISTS text + binding order ──

function level(
  over: Partial<RelationExistencePredicate> & Pick<RelationExistencePredicate, 'relation' | 'relatedTable' | 'parentColumn' | 'relatedColumn'>,
): RelationExistencePredicate {
  return { exists: true, constraintWheres: [], ...over }
}

describe('compileExists — nested predicate chains', () => {
  it('two-level direct: child EXISTS correlates against the parent EXISTS table', () => {
    const pred = level({
      relation: 'posts', relatedTable: 'posts', parentColumn: 'id', relatedColumn: 'userId',
      nested: level({ relation: 'comments', relatedTable: 'comments', parentColumn: 'id', relatedColumn: 'postId' }),
    })
    const b = makeBindings(sqlite)
    const sql = compileExists('users', pred, sqlite, b)
    assert.strictEqual(sql,
      'EXISTS (SELECT 1 FROM "posts" WHERE "posts"."userId" = "users"."id" AND ' +
      'EXISTS (SELECT 1 FROM "comments" WHERE "comments"."postId" = "posts"."id"))')
    assert.deepStrictEqual(b.values, [])
  })

  it('deepest constraint wheres bind inside the innermost EXISTS, after outer values', () => {
    const pred = level({
      relation: 'posts', relatedTable: 'posts', parentColumn: 'id', relatedColumn: 'userId',
      constraintWheres: [],
      nested: level({
        relation: 'comments', relatedTable: 'comments', parentColumn: 'id', relatedColumn: 'postId',
        constraintWheres: [{ column: 'approved', operator: '=', value: 1 }],
      }),
    })
    const b = makeBindings(sqlite)
    const sql = compileExists('users', pred, sqlite, b)
    assert.strictEqual(sql,
      'EXISTS (SELECT 1 FROM "posts" WHERE "posts"."userId" = "users"."id" AND ' +
      'EXISTS (SELECT 1 FROM "comments" WHERE "comments"."postId" = "posts"."id" AND "comments"."approved" = ?))')
    assert.deepStrictEqual(b.values, [1])
  })

  it('outer constraint values bind BEFORE the nested chain (SQL-text order)', () => {
    const pred = level({
      relation: 'posts', relatedTable: 'posts', parentColumn: 'id', relatedColumn: 'userId',
      constraintWheres: [{ column: 'published', operator: '=', value: true }],
      nested: level({
        relation: 'comments', relatedTable: 'comments', parentColumn: 'id', relatedColumn: 'postId',
        constraintWheres: [{ column: 'author', operator: '=', value: 'bob' }],
      }),
    })
    const b = makeBindings(sqlite)
    const sql = compileExists('users', pred, sqlite, b)
    assert.strictEqual(sql,
      'EXISTS (SELECT 1 FROM "posts" WHERE "posts"."userId" = "users"."id" AND "posts"."published" = ? AND ' +
      'EXISTS (SELECT 1 FROM "comments" WHERE "comments"."postId" = "posts"."id" AND "comments"."author" = ?))')
    assert.deepStrictEqual(b.values, [true, 'bob'])
  })

  it('NOT EXISTS outer + EXISTS inner (whereDoesntHave semantics)', () => {
    const pred = level({
      relation: 'posts', relatedTable: 'posts', parentColumn: 'id', relatedColumn: 'userId',
      exists: false,
      nested: level({ relation: 'comments', relatedTable: 'comments', parentColumn: 'id', relatedColumn: 'postId' }),
    })
    const sql = compileExists('users', pred, sqlite, makeBindings(sqlite))
    assert.strictEqual(sql,
      'NOT EXISTS (SELECT 1 FROM "posts" WHERE "posts"."userId" = "users"."id" AND ' +
      'EXISTS (SELECT 1 FROM "comments" WHERE "comments"."postId" = "posts"."id"))')
  })

  it('count comparison on the deepest level renders inside the outer EXISTS', () => {
    const pred = level({
      relation: 'posts', relatedTable: 'posts', parentColumn: 'id', relatedColumn: 'userId',
      nested: level({
        relation: 'comments', relatedTable: 'comments', parentColumn: 'id', relatedColumn: 'postId',
        count: { operator: '>=', value: 2 },
      }),
    })
    const sql = compileExists('users', pred, sqlite, makeBindings(sqlite))
    assert.strictEqual(sql,
      'EXISTS (SELECT 1 FROM "posts" WHERE "posts"."userId" = "users"."id" AND ' +
      '(SELECT COUNT(*) FROM "comments" WHERE "comments"."postId" = "posts"."id") >= 2)')
  })

  it('three-level chain recurses', () => {
    const pred = level({
      relation: 'posts', relatedTable: 'posts', parentColumn: 'id', relatedColumn: 'userId',
      nested: level({
        relation: 'comments', relatedTable: 'comments', parentColumn: 'id', relatedColumn: 'postId',
        nested: level({ relation: 'reactions', relatedTable: 'reactions', parentColumn: 'id', relatedColumn: 'commentId' }),
      }),
    })
    const sql = compileExists('users', pred, sqlite, makeBindings(sqlite))
    assert.strictEqual(sql,
      'EXISTS (SELECT 1 FROM "posts" WHERE "posts"."userId" = "users"."id" AND ' +
      'EXISTS (SELECT 1 FROM "comments" WHERE "comments"."postId" = "posts"."id" AND ' +
      'EXISTS (SELECT 1 FROM "reactions" WHERE "reactions"."commentId" = "comments"."id")))')
  })

  it('through-pivot outer: nested child sits inside the related EXISTS, after constraint wheres', () => {
    const pred = level({
      relation: 'roles', relatedTable: 'roles', parentColumn: 'id', relatedColumn: 'id',
      constraintWheres: [{ column: 'active', operator: '=', value: 1 }],
      through: { pivotTable: 'role_user', foreignPivotKey: 'userId', relatedPivotKey: 'roleId' },
      nested: level({ relation: 'grants', relatedTable: 'grants', parentColumn: 'id', relatedColumn: 'roleId' }),
    })
    const b = makeBindings(sqlite)
    const sql = compileExists('users', pred, sqlite, b)
    assert.strictEqual(sql,
      'EXISTS (SELECT 1 FROM "role_user" WHERE "role_user"."userId" = "users"."id" AND ' +
      'EXISTS (SELECT 1 FROM "roles" WHERE "roles"."id" = "role_user"."roleId" AND "roles"."active" = ? AND ' +
      'EXISTS (SELECT 1 FROM "grants" WHERE "grants"."roleId" = "roles"."id")))')
    assert.deepStrictEqual(b.values, [1])
  })

  it('arrow-path constraint on the deepest level composes (JSON + nested)', () => {
    const pred = level({
      relation: 'posts', relatedTable: 'posts', parentColumn: 'id', relatedColumn: 'userId',
      nested: level({
        relation: 'comments', relatedTable: 'comments', parentColumn: 'id', relatedColumn: 'postId',
        constraintWheres: [{ column: 'meta->lang', operator: '=', value: 'en' }],
      }),
    })
    const b = makeBindings(sqlite)
    const sql = compileExists('users', pred, sqlite, b)
    assert.match(sql, /json_extract\("comments"\."meta", '\$\."lang"'\) = \?\)\)$/)
    assert.deepStrictEqual(b.values, ['en'])
  })

  it('single-level predicate (no nested) is byte-identical to before', () => {
    const pred = level({
      relation: 'posts', relatedTable: 'posts', parentColumn: 'id', relatedColumn: 'userId',
      constraintWheres: [{ column: 'published', operator: '=', value: true }],
    })
    const b = makeBindings(sqlite)
    const sql = compileExists('users', pred, sqlite, b)
    assert.strictEqual(sql,
      'EXISTS (SELECT 1 FROM "posts" WHERE "posts"."userId" = "users"."id" AND "posts"."published" = ?)')
    assert.deepStrictEqual(b.values, [true])
  })
})

// ── Models for the predicate-builder units + sqlite E2E ──

class User extends Model {
  static override table = 'users'
  static override relations = {
    posts: { type: 'hasMany' as const, model: () => Post, foreignKey: 'userId' },
    roles: { type: 'belongsToMany' as const, model: () => Role, pivotTable: 'role_user' },
    image: { type: 'morphOne' as const, model: () => Image, morphName: 'imageable' },
  }
  id!: number
  name!: string
}

class Post extends Model {
  static override table = 'posts'
  static override relations = {
    comments: { type: 'hasMany' as const, model: () => Comment, foreignKey: 'postId' },
    user:     { type: 'belongsTo' as const, model: () => User, foreignKey: 'userId' },
  }
  id!: number
  userId!: number
}

class Comment extends Model {
  static override table = 'comments'
  static override relations = {
    reactions:   { type: 'hasMany' as const, model: () => Reaction, foreignKey: 'commentId' },
    post:        { type: 'belongsTo' as const, model: () => Post, foreignKey: 'postId' },
    commentable: { type: 'morphTo' as const, morphName: 'commentable', types: () => [Post] },
  }
  id!: number
  postId!: number
  approved!: number
  author!: string
}

class Reaction extends Model {
  static override table = 'reactions'
  id!: number
  commentId!: number
}

class Role extends Model {
  static override table = 'roles'
  static override relations = {
    grants: { type: 'hasMany' as const, model: () => Grant, foreignKey: 'roleId' },
  }
  id!: number
  name!: string
}

class Grant extends Model {
  static override table = 'grants'
  id!: number
  roleId!: number
  action!: string
}

class Image extends Model {
  static override table = 'images'
  id!: number
}

// ── Model-layer units — buildNestedRelationPredicate ──

describe('buildNestedRelationPredicate', () => {
  it('builds the chain deepest-first with Laravel hasNested semantics', () => {
    const pred = buildNestedRelationPredicate(
      User, 'posts.comments', false,
      [{ column: 'approved', operator: '=', value: 1 }],
      { operator: '>=', value: 2 },
    )
    // outer: posts — flipped exists, NO constraint, NO count
    assert.strictEqual(pred.relation, 'posts')
    assert.strictEqual(pred.exists, false)
    assert.deepStrictEqual(pred.constraintWheres, [])
    assert.strictEqual(pred.count, undefined)
    // deepest: comments — plain exists, carries constraint + count
    const child = pred.nested!
    assert.strictEqual(child.relation, 'comments')
    assert.strictEqual(child.exists, true)
    assert.deepStrictEqual(child.constraintWheres, [{ column: 'approved', operator: '=', value: 1 }])
    assert.deepStrictEqual(child.count, { operator: '>=', value: 2 })
    assert.strictEqual(child.nested, undefined)
  })

  it('unknown segment names the owning model and the full path', () => {
    assert.throws(
      () => buildNestedRelationPredicate(User, 'posts.nope', true, []),
      /Relation "nope" is not defined on Post \(nested path "posts\.nope"\)/,
    )
  })

  it('morphTo in the chain throws', () => {
    assert.throws(
      () => buildNestedRelationPredicate(Post, 'comments.commentable', true, []),
      /morphTo "commentable" cannot appear in a nested whereHas path/,
    )
  })

  it('empty segment throws', () => {
    assert.throws(
      () => buildNestedRelationPredicate(User, 'posts..comments', true, []),
      /Malformed nested relation path/,
    )
  })
})

// ── End-to-end on real sqlite ──

let driver: Driver

// Ada: p1 (c1 approved/bob + r1, c2 spam/eve), p2 (no comments)
// Alan: p3 (c3 spam/eve) · Grace: no posts · Edsger: p4 (c4+c5 approved)
// Hopper: p5 (no comments) — the whereDoesntHave edge
// Roles: editor (Ada, Alan) with grant 'edit'; viewer (Grace) with grant 'view'
describe('nested whereHas (native, sqlite E2E)', () => {
  beforeEach(async () => {
    driver = await BetterSqlite3Driver.open({ filename: ':memory:' })
    await driver.execute(`CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)`, [])
    await driver.execute(`CREATE TABLE posts (id INTEGER PRIMARY KEY, userId INTEGER)`, [])
    await driver.execute(`CREATE TABLE comments (id INTEGER PRIMARY KEY, postId INTEGER, approved INTEGER, author TEXT)`, [])
    await driver.execute(`CREATE TABLE reactions (id INTEGER PRIMARY KEY, commentId INTEGER)`, [])
    await driver.execute(`CREATE TABLE roles (id INTEGER PRIMARY KEY, name TEXT)`, [])
    await driver.execute(`CREATE TABLE role_user (userId INTEGER, roleId INTEGER)`, [])
    await driver.execute(`CREATE TABLE grants (id INTEGER PRIMARY KEY, roleId INTEGER, action TEXT)`, [])
    ModelRegistry.reset()
    ModelRegistry.set(await NativeAdapter.make({ driverInstance: driver }))

    const seed = [
      `INSERT INTO users VALUES (1,'Ada'),(2,'Alan'),(3,'Grace'),(4,'Edsger'),(5,'Hopper')`,
      `INSERT INTO posts VALUES (1,1),(2,1),(3,2),(4,4),(5,5)`,
      `INSERT INTO comments VALUES (1,1,1,'bob'),(2,1,0,'eve'),(3,3,0,'eve'),(4,4,1,'bob'),(5,4,1,'dan')`,
      `INSERT INTO reactions VALUES (1,1)`,
      `INSERT INTO roles VALUES (1,'editor'),(2,'viewer')`,
      `INSERT INTO role_user VALUES (1,1),(2,1),(3,2)`,
      `INSERT INTO grants VALUES (1,1,'edit'),(2,2,'view')`,
    ]
    for (const sql of seed) await driver.execute(sql, [])
  })

  afterEach(async () => { await driver.close() })

  const names = (rows: User[]): string[] => rows.map(r => r.name).sort()

  it('whereHas two levels deep', async () => {
    assert.deepStrictEqual(names(await User.whereHas('posts.comments').get()), ['Ada', 'Alan', 'Edsger'])
  })

  it('constraint applies to the DEEPEST relation', async () => {
    assert.deepStrictEqual(
      names(await User.whereHas('posts.comments', q => q.where('approved', 1)).get()),
      ['Ada', 'Edsger'],
    )
  })

  it('whereDoesntHave: a post without comments does NOT defeat it (Laravel semantics)', async () => {
    // Ada has p2 with no comments but p1 HAS comments → excluded.
    // Hopper's only post has no comments → included alongside post-less Grace.
    assert.deepStrictEqual(names(await User.whereDoesntHave('posts.comments').get()), ['Grace', 'Hopper'])
  })

  it('has(path, op, n): count applies to the deepest level', async () => {
    // a post with >= 2 comments → Ada (p1: c1+c2), Edsger (p4: c4+c5)
    assert.deepStrictEqual(names(await User.has('posts.comments', '>=', 2).get()), ['Ada', 'Edsger'])
  })

  it("has(path, '<', 1) flips to doesntHave (Laravel hasNested special case)", async () => {
    assert.deepStrictEqual(names(await User.has('posts.comments', '<', 1).get()), ['Grace', 'Hopper'])
  })

  it('orWhereHas OR-roots a nested chain', async () => {
    const rows = await User.query()
      .where('name', 'Grace')
      .orWhereHas('posts.comments', q => q.where('approved', 1))
      .get()
    assert.deepStrictEqual(names(rows), ['Ada', 'Edsger', 'Grace'])
  })

  it('whereRelation sugar takes a nested path', async () => {
    assert.deepStrictEqual(names(await User.whereRelation('posts.comments', 'author', 'dan').get()), ['Edsger'])
  })

  it('three levels deep', async () => {
    assert.deepStrictEqual(names(await User.whereHas('posts.comments.reactions').get()), ['Ada'])
  })

  it('belongsTo chain works in the inverse direction', async () => {
    const rows = await Comment.whereHas('post.user', q => q.where('name', 'Ada')).get()
    assert.deepStrictEqual(rows.map(r => r.id).sort(), [1, 2])
  })

  it('belongsToMany hop in the chain (pivot → related → child)', async () => {
    assert.deepStrictEqual(
      names(await User.whereHas('roles.grants', q => q.where('action', 'edit')).get()),
      ['Ada', 'Alan'],
    )
  })

  it('single-level whereHas still works unchanged next to nested calls', async () => {
    const rows = await User.whereHas('posts').whereHas('posts.comments', q => q.where('approved', 1)).get()
    assert.deepStrictEqual(names(rows), ['Ada', 'Edsger'])
  })
})

// ── Unsupported-adapter guard (Model layer) ──

describe('nested whereHas — unsupported-adapter guard', () => {
  it('throws a clear error when the adapter QB lacks the marker', () => {
    // A minimal adapter QB that handles plain whereHas but has no
    // `supportsNestedRelationPredicates` (the Drizzle / Prisma shape).
    const dispatched: RelationExistencePredicate[] = []
    const bareQb = {
      whereRelationExists(pred: RelationExistencePredicate) { dispatched.push(pred); return this },
    } as unknown as QueryBuilder<unknown>
    const adapter = {
      query: () => bareQb,
      connect: async () => {},
      disconnect: async () => {},
    } as unknown as OrmAdapter
    ModelRegistry.reset()
    ModelRegistry.set(adapter)

    assert.throws(
      () => User.whereHas('posts.comments'),
      /Nested whereHas \("posts\.comments"\) is not supported on this adapter/,
    )
    assert.strictEqual(dispatched.length, 0)

    // plain whereHas still dispatches on the same adapter
    User.whereHas('posts')
    assert.strictEqual(dispatched.length, 1)
    assert.strictEqual(dispatched[0]!.nested, undefined)
  })
})

// ── Live Postgres round-trip ──

const PG_URL = process.env['PG_TEST_URL']

if (!PG_URL) {
  test('nested whereHas pg round-trip (skipped — set PG_TEST_URL to run)', { skip: true }, () => {})
} else {
  describe('nested whereHas (live pg)', () => {
    class PgUser extends Model {
      static override table = 'rudder_nwh_users'
      static override relations = {
        posts: { type: 'hasMany' as const, model: () => PgPost, foreignKey: 'userId' },
      }
      id!: number
      name!: string
    }
    class PgPost extends Model {
      static override table = 'rudder_nwh_posts'
      static override relations = {
        comments: { type: 'hasMany' as const, model: () => PgComment, foreignKey: 'postId' },
      }
      id!: number
    }
    class PgComment extends Model {
      static override table = 'rudder_nwh_comments'
      id!: number
      approved!: boolean
    }
    let pgDriver: PostgresDriver

    before(async () => {
      pgDriver = await PostgresDriver.open({ url: PG_URL })
      for (const t of ['rudder_nwh_comments', 'rudder_nwh_posts', 'rudder_nwh_users']) {
        await pgDriver.execute(`DROP TABLE IF EXISTS ${t}`, [])
      }
      await pgDriver.execute(`CREATE TABLE rudder_nwh_users (id SERIAL PRIMARY KEY, name TEXT)`, [])
      await pgDriver.execute(`CREATE TABLE rudder_nwh_posts (id SERIAL PRIMARY KEY, "userId" INT)`, [])
      await pgDriver.execute(`CREATE TABLE rudder_nwh_comments (id SERIAL PRIMARY KEY, "postId" INT, approved BOOLEAN)`, [])
      // Seed via SQL LITERALS, not bound params (#858 serializer caution).
      await pgDriver.execute(`INSERT INTO rudder_nwh_users (id, name) VALUES (1, 'Ada'), (2, 'Grace'), (3, 'Hopper')`, [])
      await pgDriver.execute(`INSERT INTO rudder_nwh_posts (id, "userId") VALUES (1, 1), (2, 3)`, [])
      await pgDriver.execute(`INSERT INTO rudder_nwh_comments (id, "postId", approved) VALUES (1, 1, true), (2, 1, false)`, [])
    })
    after(async () => {
      for (const t of ['rudder_nwh_comments', 'rudder_nwh_posts', 'rudder_nwh_users']) {
        await pgDriver.execute(`DROP TABLE IF EXISTS ${t}`, [])
      }
      await pgDriver.close()
    })
    beforeEach(async () => {
      ModelRegistry.reset()
      ModelRegistry.set(await NativeAdapter.make({ driverInstance: pgDriver, dialect: new PgDialect() }))
    })

    const names = (rows: PgUser[]): string[] => rows.map(r => r.name).sort()

    it('nested chains run live', async () => {
      assert.deepStrictEqual(names(await PgUser.whereHas('posts.comments').get()), ['Ada'])
      assert.deepStrictEqual(names(await PgUser.whereHas('posts.comments', q => q.where('approved', true)).get()), ['Ada'])
      assert.deepStrictEqual(names(await PgUser.whereDoesntHave('posts.comments').get()), ['Grace', 'Hopper'])
      assert.deepStrictEqual(names(await PgUser.has('posts.comments', '>=', 2).get()), ['Ada'])
    })
  })
}

// ── Live MySQL round-trip ──

const MYSQL_URL = process.env['MYSQL_TEST_URL']

if (!MYSQL_URL) {
  test('nested whereHas mysql round-trip (skipped — set MYSQL_TEST_URL to run)', { skip: true }, () => {})
} else {
  describe('nested whereHas (live mysql)', () => {
    class MyUser extends Model {
      static override table = 'rudder_nwh_users'
      static override relations = {
        posts: { type: 'hasMany' as const, model: () => MyPost, foreignKey: 'userId' },
      }
      id!: number
      name!: string
    }
    class MyPost extends Model {
      static override table = 'rudder_nwh_posts'
      static override relations = {
        comments: { type: 'hasMany' as const, model: () => MyComment, foreignKey: 'postId' },
      }
      id!: number
    }
    class MyComment extends Model {
      static override table = 'rudder_nwh_comments'
      id!: number
      approved!: boolean
    }
    let myDriver: MysqlDriver

    before(async () => {
      myDriver = await MysqlDriver.open({ url: MYSQL_URL })
      for (const t of ['rudder_nwh_comments', 'rudder_nwh_posts', 'rudder_nwh_users']) {
        await myDriver.execute(`DROP TABLE IF EXISTS ${t}`, [])
      }
      await myDriver.execute(`CREATE TABLE rudder_nwh_users (id INT PRIMARY KEY, name TEXT)`, [])
      await myDriver.execute(`CREATE TABLE rudder_nwh_posts (id INT PRIMARY KEY, userId INT)`, [])
      await myDriver.execute(`CREATE TABLE rudder_nwh_comments (id INT PRIMARY KEY, postId INT, approved TINYINT(1))`, [])
      // Seed via SQL LITERALS (same convention as the pg block above).
      await myDriver.execute(`INSERT INTO rudder_nwh_users (id, name) VALUES (1, 'Ada'), (2, 'Grace'), (3, 'Hopper')`, [])
      await myDriver.execute(`INSERT INTO rudder_nwh_posts (id, userId) VALUES (1, 1), (2, 3)`, [])
      await myDriver.execute(`INSERT INTO rudder_nwh_comments (id, postId, approved) VALUES (1, 1, 1), (2, 1, 0)`, [])
    })
    after(async () => {
      for (const t of ['rudder_nwh_comments', 'rudder_nwh_posts', 'rudder_nwh_users']) {
        await myDriver.execute(`DROP TABLE IF EXISTS ${t}`, [])
      }
      await myDriver.close()
    })
    beforeEach(async () => {
      ModelRegistry.reset()
      ModelRegistry.set(await NativeAdapter.make({ driverInstance: myDriver, dialect: new MysqlDialect() }))
    })

    const names = (rows: MyUser[]): string[] => rows.map(r => r.name).sort()

    it('nested chains run live', async () => {
      assert.deepStrictEqual(names(await MyUser.whereHas('posts.comments').get()), ['Ada'])
      assert.deepStrictEqual(names(await MyUser.whereHas('posts.comments', q => q.where('approved', 1)).get()), ['Ada'])
      assert.deepStrictEqual(names(await MyUser.whereDoesntHave('posts.comments').get()), ['Grace', 'Hopper'])
      assert.deepStrictEqual(names(await MyUser.has('posts.comments', '>=', 2).get()), ['Ada'])
    })
  })
}
