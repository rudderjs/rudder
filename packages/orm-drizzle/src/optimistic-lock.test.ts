// Optimistic locking (`static version`) — end-to-end on the Drizzle adapter.
//
// The versioned update path is pure Model layer, built on the
// `where().updateAll()` / `increment` contract primitives — so this suite
// proves those primitives compose correctly through DrizzleQueryBuilder
// against real SQLite: create stamps version 1, save() bumps, a concurrent
// bump makes the slower save() throw OptimisticLockError, refresh() + retry
// recovers. Mirrors `orm/src/native/optimistic-lock.test.ts`.

import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { drizzle as drizzleSqlite } from 'drizzle-orm/better-sqlite3'
import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core'
import { Model, ModelRegistry, ModelNotFoundError, OptimisticLockError } from '@rudderjs/orm'
import { drizzle, type DrizzleConfig } from './index.js'

const docs = sqliteTable('docs', {
  id:      integer('id').primaryKey({ autoIncrement: true }),
  title:   text('title').notNull(),
  version: integer('version').notNull().default(1),
})

class Doc extends Model {
  static override table = 'docs'
  static override version = true
  id!: number
  title!: string
  version!: number
}

async function makeAdapter() {
  const sqlite = new Database(':memory:')
  sqlite.exec(`
    CREATE TABLE docs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1
    );
  `)
  const db = drizzleSqlite(sqlite)
  const cfg: DrizzleConfig = { client: db, dialect: 'sqlite', tables: { docs } }
  return drizzle(cfg).create()
}

beforeEach(async () => {
  ModelRegistry.reset()
  ModelRegistry.set(await makeAdapter())
})

describe('optimistic locking — Drizzle sqlite E2E', () => {
  it('create() stamps version 1 and save() bumps it', async () => {
    const doc = await Doc.create({ title: 'draft' })
    assert.strictEqual(doc.version, 1)

    doc.title = 'published'
    await doc.save()
    assert.strictEqual(doc.version, 2)

    const fresh = await Doc.findOrFail(doc.id)
    assert.strictEqual(fresh.version, 2)
    assert.strictEqual(fresh.title, 'published')
  })

  it('a stale save() throws OptimisticLockError after a concurrent write', async () => {
    const created = await Doc.create({ title: 'orig' })
    const a = await Doc.findOrFail(created.id)
    const b = await Doc.findOrFail(created.id)

    a.title = 'theirs'
    await a.save() // bumps to 2

    b.title = 'mine'
    await assert.rejects(
      b.save(),
      (err: unknown) => {
        assert.ok(err instanceof OptimisticLockError)
        assert.strictEqual(err.code, 'OPTIMISTIC_LOCK')
        assert.strictEqual(err.expectedVersion, 1)
        assert.strictEqual(err.actualVersion, 2)
        return true
      },
    )

    const fresh = await Doc.findOrFail(created.id)
    assert.strictEqual(fresh.title, 'theirs')
    assert.strictEqual(fresh.version, 2)
  })

  it('refresh() + retry recovers from a conflict', async () => {
    const created = await Doc.create({ title: 'orig' })
    const a = await Doc.findOrFail(created.id)
    const b = await Doc.findOrFail(created.id)

    a.title = 'theirs'
    await a.save()

    b.title = 'mine'
    await assert.rejects(b.save(), OptimisticLockError)

    await b.refresh()
    b.title = 'mine'
    await b.save()
    assert.strictEqual(b.version, 3)

    const fresh = await Doc.findOrFail(created.id)
    assert.strictEqual(fresh.title, 'mine')
  })

  it('static update() with an explicit version checks staleness; without, bumps atomically', async () => {
    const doc = await Doc.create({ title: 'orig' })

    const updated = await Doc.update(doc.id, { title: 'v2', version: 1 })
    assert.strictEqual(updated.version, 2)

    await assert.rejects(Doc.update(doc.id, { title: 'late', version: 1 }), OptimisticLockError)

    // No baseline — atomic bump via increment, no stale check.
    const bumped = await Doc.update(doc.id, { title: 'v3' })
    assert.strictEqual(bumped.version, 3)
  })

  it('a save() against a deleted row throws ModelNotFoundError', async () => {
    const created = await Doc.create({ title: 'orig' })
    const stale = await Doc.findOrFail(created.id)
    await Doc.delete(created.id)

    stale.title = 'ghost'
    await assert.rejects(stale.save(), ModelNotFoundError)
  })
})
