// ─── Drizzle adapter QB: .with() guards the constrained-eager fallback ────────
//
// A normal `Model.with('relation')` no longer reaches the adapter QB — the
// Drizzle adapter advertises `eagerLoadStrategy = 'model-layer'`, so the ORM
// resolves direct relations in its Model layer (see `eager-with.test.ts`). The
// QB-level `.with()` is now only reachable via the `withWhereHas` constrained-
// eager fallback (`q.with(relation)`), which Drizzle still can't satisfy. These
// tests pin that guard: calling the QB `.with(relation)` directly throws an
// actionable error, while the relation-existence FILTER path (`whereHas`, which
// never calls `.with()`) keeps working.

import { describe, it, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { drizzle as drizzleSqlite } from 'drizzle-orm/better-sqlite3'
import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core'
import { drizzle, DrizzleAdapter, type DrizzleConfig } from './index.js'

const posts = sqliteTable('posts', {
  id:     integer('id').primaryKey({ autoIncrement: true }),
  title:  text('title').notNull(),
  userId: integer('user_id').notNull(),
})

type Post = { id: number; title: string; userId: number }

let adapter: DrizzleAdapter

async function makeAdapter(): Promise<DrizzleAdapter> {
  const sqlite = new Database(':memory:')
  sqlite.exec(`
    CREATE TABLE posts (
      id      INTEGER PRIMARY KEY AUTOINCREMENT,
      title   TEXT    NOT NULL,
      user_id INTEGER NOT NULL
    );
  `)
  const db = drizzleSqlite(sqlite)
  const cfg: DrizzleConfig = { client: db, tables: { posts } }
  return drizzle(cfg).create() as Promise<DrizzleAdapter>
}

describe('DrizzleQueryBuilder.with — guards the constrained-eager fallback', () => {
  before(async () => { adapter = await makeAdapter() })
  beforeEach(async () => { adapter = await makeAdapter() })

  it('advertises the model-layer eager-load strategy', () => {
    assert.equal(adapter.eagerLoadStrategy, 'model-layer')
  })

  it('throws on a single relation', () => {
    assert.throws(
      () => adapter.query<Post>('posts').with('author'),
      /Constrained eager loading via withWhereHas\('author'\) is not implemented on the Drizzle adapter/,
    )
  })

  it('throws on multiple relations and names them all', () => {
    assert.throws(
      () => adapter.query<Post>('posts').with('author', 'comments'),
      /withWhereHas\('author', 'comments'\)/,
    )
  })

  it('error notes that plain eager loading works and points at whereHas / related()', () => {
    try {
      adapter.query<Post>('posts').with('author')
      assert.fail('expected with() to throw')
    } catch (err) {
      const msg = (err as Error).message
      assert.match(msg, /Plain eager loading .* IS supported/, 'clarifies Model.with() works')
      assert.match(msg, /whereHas\('author'\)/, 'suggests whereHas for filter-only use')
      assert.match(msg, /related\('author'\)/, 'suggests the related() accessor for constrained loads')
    }
  })

  it('with() with no relations is a harmless no-op (does not throw)', () => {
    assert.doesNotThrow(() => adapter.query<Post>('posts').with())
  })

  it('the relation-existence FILTER path (whereHas) still works — it never calls with()', async () => {
    const qb = adapter.query<Post>('posts')
    await qb.create({ title: 'a', userId: 1 })
    await qb.create({ title: 'b', userId: 2 })
    // A plain where filter (the same primitive whereHas compiles to) executes
    // fine — only constrained eager *loading* throws, not filtering.
    const rows = await adapter.query<Post>('posts').where('userId', 1).get()
    assert.equal(rows.length, 1)
    assert.equal(rows[0]?.title, 'a')
  })
})
