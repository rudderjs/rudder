// Nested whereHas on the Drizzle adapter — PR B of the nested-callback plan
// (docs/plans/2026-06-07-nested-callback-where-has.md). The adapter now
// carries `supportsNestedRelationPredicates`, so BOTH nested forms flow in
// from the Model layer:
//   - dot-paths (`whereHas('posts.comments')`) — singular `nested` chains;
//   - callback nesting (`whereHas('posts', q => q.whereHas('comments'))`) —
//     `nested` arrays with constraints at every level, inner whereDoesntHave,
//     and sibling branches.
// `_relationExistsExpr` recurses, correlating each child against the
// enclosing level's related table. Mirrors the native engine's E2E scenario
// (orm/src/native/nested-where-has.test.ts) on real sqlite, end-to-end
// through the Model API.
//
// Topology: users → posts → comments → reactions; users ⇄ roles (pivot) → grants.
//   Ada: p1 (c1 approved/bob + r1, c2 spam/eve), p2 (no comments)
//   Alan: p3 (c3 spam/eve) · Grace: no posts · Edsger: p4 (c4+c5 approved)
//   Hopper: p5 (no comments) — the whereDoesntHave edge
//   Roles: editor (Ada, Alan) with grant 'edit'; viewer (Grace) with grant 'view'

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { drizzle as drizzleSqlite } from 'drizzle-orm/better-sqlite3'
import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core'
import { Model, ModelRegistry } from '@rudderjs/orm'
import { drizzle, DrizzleAdapter } from './index.js'

const users     = sqliteTable('users',     { id: integer('id').primaryKey(), name: text('name').notNull() })
const posts     = sqliteTable('posts',     { id: integer('id').primaryKey(), userId: integer('userId').notNull() })
const comments  = sqliteTable('comments',  { id: integer('id').primaryKey(), postId: integer('postId').notNull(), approved: integer('approved').notNull(), author: text('author').notNull() })
const reactions = sqliteTable('reactions', { id: integer('id').primaryKey(), commentId: integer('commentId').notNull() })
const roles     = sqliteTable('roles',     { id: integer('id').primaryKey(), name: text('name').notNull() })
const role_user = sqliteTable('role_user', { userId: integer('userId').notNull(), roleId: integer('roleId').notNull() })
const grants    = sqliteTable('grants',    { id: integer('id').primaryKey(), roleId: integer('roleId').notNull(), action: text('action').notNull() })

class Reaction extends Model {
  static override table = 'reactions'
  id!: number
}
class Comment extends Model {
  static override table = 'comments'
  static override relations = {
    reactions: { type: 'hasMany' as const, model: () => Reaction, foreignKey: 'commentId' },
  }
  id!: number
}
class Post extends Model {
  static override table = 'posts'
  static override relations = {
    comments: { type: 'hasMany' as const, model: () => Comment, foreignKey: 'postId' },
  }
  id!: number
}
class Grant extends Model {
  static override table = 'grants'
  id!: number
}
class Role extends Model {
  static override table = 'roles'
  static override relations = {
    grants: { type: 'hasMany' as const, model: () => Grant, foreignKey: 'roleId' },
  }
  id!: number
}
class User extends Model {
  static override table = 'users'
  static override relations = {
    posts: { type: 'hasMany' as const, model: () => Post, foreignKey: 'userId' },
    roles: { type: 'belongsToMany' as const, model: () => Role, pivotTable: 'role_user' },
  }
  id!: number
  name!: string
}

let sqlite: InstanceType<typeof Database>

async function makeAdapter(opts: { registerComments?: boolean } = {}): Promise<DrizzleAdapter> {
  sqlite = new Database(':memory:')
  sqlite.exec(`
    CREATE TABLE users     (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE posts     (id INTEGER PRIMARY KEY, userId INTEGER NOT NULL);
    CREATE TABLE comments  (id INTEGER PRIMARY KEY, postId INTEGER NOT NULL, approved INTEGER NOT NULL, author TEXT NOT NULL);
    CREATE TABLE reactions (id INTEGER PRIMARY KEY, commentId INTEGER NOT NULL);
    CREATE TABLE roles     (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE role_user (userId INTEGER NOT NULL, roleId INTEGER NOT NULL);
    CREATE TABLE grants    (id INTEGER PRIMARY KEY, roleId INTEGER NOT NULL, action TEXT NOT NULL);
    INSERT INTO users VALUES (1,'Ada'),(2,'Alan'),(3,'Grace'),(4,'Edsger'),(5,'Hopper');
    INSERT INTO posts VALUES (1,1),(2,1),(3,2),(4,4),(5,5);
    INSERT INTO comments VALUES (1,1,1,'bob'),(2,1,0,'eve'),(3,3,0,'eve'),(4,4,1,'bob'),(5,4,1,'dan');
    INSERT INTO reactions VALUES (1,1);
    INSERT INTO roles VALUES (1,'editor'),(2,'viewer');
    INSERT INTO role_user VALUES (1,1),(2,1),(3,2);
    INSERT INTO grants VALUES (1,1,'edit'),(2,2,'view');
  `)
  const db = drizzleSqlite(sqlite)
  const tables = opts.registerComments === false
    ? { users, posts, reactions, roles, role_user, grants } // comments deliberately missing
    : { users, posts, comments, reactions, roles, role_user, grants }
  return drizzle({ client: db, tables }).create() as Promise<DrizzleAdapter>
}

const names = (rows: User[]): string[] => rows.map(r => r.name).sort()

describe('nested whereHas (Drizzle, sqlite E2E)', () => {
  beforeEach(async () => {
    ModelRegistry.reset()
    ModelRegistry.set(await makeAdapter())
  })
  afterEach(() => { sqlite.close() })

  // ── Dot-path form (newly unlocked by the marker) ──

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
    assert.deepStrictEqual(names(await User.whereDoesntHave('posts.comments').get()), ['Grace', 'Hopper'])
  })

  it('three levels deep', async () => {
    assert.deepStrictEqual(names(await User.whereHas('posts.comments.reactions').get()), ['Ada'])
  })

  it('belongsToMany hop in the chain (pivot → related → child)', async () => {
    assert.deepStrictEqual(
      names(await User.whereHas('roles.grants', q => q.where('action', 'edit')).get()),
      ['Ada', 'Alan'],
    )
  })

  // ── Callback-nested form ──

  it('callback form is equivalent to the dot-path when only the deepest level is constrained', async () => {
    const viaCallback = names(await User.whereHas('posts', q => q.whereHas('comments')).get())
    assert.deepStrictEqual(viaCallback, names(await User.whereHas('posts.comments').get()))
    assert.deepStrictEqual(viaCallback, ['Ada', 'Alan', 'Edsger'])
  })

  it('constraints apply at EVERY level — inexpressible as a dot-path', async () => {
    const rows = await User.whereHas('posts', q =>
      q.where('id', '>=', 4).whereHas('comments', c => c.where('approved', 1)),
    ).get()
    assert.deepStrictEqual(names(rows), ['Edsger'])
  })

  it('inner whereDoesntHave — "a post with NO comments"', async () => {
    const rows = await User.whereHas('posts', q => q.whereDoesntHave('comments')).get()
    assert.deepStrictEqual(names(rows), ['Ada', 'Hopper'])
  })

  it('sibling nested calls AND together — same relation, different constraints', async () => {
    const rows = await User.whereHas('posts', q =>
      q.whereHas('comments', c => c.where('approved', 1))
       .whereHas('comments', c => c.where('author', 'eve')),
    ).get()
    assert.deepStrictEqual(names(rows), ['Ada'])
  })

  it('recursion three levels deep via callbacks', async () => {
    const rows = await User.whereHas('posts', q =>
      q.whereHas('comments', c => c.whereHas('reactions')),
    ).get()
    assert.deepStrictEqual(names(rows), ['Ada'])
  })

  it('nested whereHas inside a PIVOT relation callback (children live in the related EXISTS)', async () => {
    const rows = await User.whereHas('roles', q => q.whereHas('grants', g => g.where('action', 'edit'))).get()
    assert.deepStrictEqual(names(rows), ['Ada', 'Alan'])
  })

  it('recorded sugar composes inside nested callbacks', async () => {
    const rows = await User.whereHas('posts', q =>
      q.whereHas('comments', c => c.whereIn('author', ['eve', 'dan'])),
    ).get()
    assert.deepStrictEqual(names(rows), ['Ada', 'Alan', 'Edsger'])
  })

  it('single-level whereHas behavior is unchanged next to nested calls', async () => {
    const rows = await User.whereHas('posts').whereHas('posts.comments', q => q.where('approved', 1)).get()
    assert.deepStrictEqual(names(rows), ['Ada', 'Edsger'])
  })
})

describe('nested whereHas (Drizzle) — table registration', () => {
  afterEach(() => { sqlite.close() })

  it('a missing table at a CHILD level surfaces the standard clear error', async () => {
    ModelRegistry.reset()
    ModelRegistry.set(await makeAdapter({ registerComments: false }))

    await assert.rejects(
      async () => { await User.whereHas('posts', q => q.whereHas('comments')).get() },
      /no table schema registered for "comments"/,
    )
  })
})
