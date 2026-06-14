// onQuery / DB.listen on the Drizzle adapter.
//
// Every fluent query awaited through the builder reports `{ sql, bindings,
// duration, connection }` to listeners registered via `adapter.onQuery()` (the
// app-facing entry point is `DB.listen()` — its delegation is covered in
// @rudderjs/database). SQL text + params come from the builder's `toSQL()`;
// `connection` is the adapter's dialect. Listener errors are swallowed; only
// successful executions report (Laravel QueryExecuted parity). The listener
// list is shared by reference with transaction-scoped adapters, so a top-level
// listener sees in-transaction queries too. The raw DB-facade seams
// (selectRaw / affectingStatement) report the raw text + bindings directly.

import { describe, it, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { drizzle as drizzleSqlite } from 'drizzle-orm/better-sqlite3'
import { createClient, type Client } from '@libsql/client'
import { drizzle as drizzleLibsql } from 'drizzle-orm/libsql'
import { sql } from 'drizzle-orm'
import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core'
import type { QueryEvent } from '@rudderjs/contracts'
import { Model, ModelRegistry, transaction } from '@rudderjs/orm'
import { drizzle, type DrizzleConfig } from './index.js'

const users = sqliteTable('users', {
  id:   integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
})

class User extends Model {
  static override table = 'users'
  id!:   number
  name!: string
}

// ─── fluent builder paths (better-sqlite3) ─────────────────

describe('Drizzle onQuery — fluent queries report', () => {
  let events: QueryEvent[]

  beforeEach(async () => {
    const sqlite = new Database(':memory:')
    sqlite.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL);`)
    sqlite.exec(`INSERT INTO users (name) VALUES ('Ada'),('Alan');`)
    const cfg: DrizzleConfig = { client: drizzleSqlite(sqlite), dialect: 'sqlite', tables: { users } }
    const adapter = await drizzle(cfg).create()
    events = []
    adapter.onQuery!((e) => events.push(e))
    ModelRegistry.reset()
    ModelRegistry.set(adapter)
  })

  it('a read reports sql, bindings, duration, and connection', async () => {
    await User.query().where('name', 'Ada').get()
    assert.equal(events.length, 1)
    const e = events[0]!
    assert.match(e.sql, /select/i)
    assert.match(e.sql, /users/)
    assert.ok(e.bindings.includes('Ada'))
    assert.equal(typeof e.duration, 'number')
    assert.ok(e.duration >= 0)
    assert.equal(e.connection, 'sqlite')
  })

  it('writes report too — create / update / delete', async () => {
    const u = await User.create({ name: 'Grace' })
    await User.update(u.id, { name: 'Grace H' })
    await User.query().delete(u.id)
    const sqls = events.map(e => e.sql.toLowerCase())
    assert.ok(sqls.some(s => s.startsWith('insert')))
    assert.ok(sqls.some(s => s.startsWith('update')))
    assert.ok(sqls.some(s => s.startsWith('delete')))
  })

  it('count() and first() report', async () => {
    await User.count()
    await User.query().first()
    assert.equal(events.length, 2)
    assert.match(events[0]!.sql, /count/i)
  })

  it('multiple listeners all fire', async () => {
    const second: QueryEvent[] = []
    ModelRegistry.getAdapter()!.onQuery!((e) => second.push(e))
    await User.all()
    assert.equal(events.length, 1)
    assert.equal(second.length, 1)
  })

  it('a throwing listener never breaks the query (and later listeners still fire)', async () => {
    const after_: QueryEvent[] = []
    const adapter = ModelRegistry.getAdapter()!
    adapter.onQuery!(() => { throw new Error('broken collector') })
    adapter.onQuery!((e) => after_.push(e))
    const rows = await User.all()
    assert.equal(rows.length, 2)
    assert.equal(after_.length, 1)
  })
})

// ─── transaction-scoped queries share the listener list (libsql) ──

describe('Drizzle onQuery — transaction-scoped queries report', () => {
  const client: Client = createClient({ url: 'file::memory:?cache=shared' })
  const db = drizzleLibsql(client)

  // Best-effort: libsql's native close() can throw intermittently on Windows (a
  // handle race), which would fail the whole file even though every test passed.
  after(() => { try { client.close() } catch { /* best effort */ } })

  it('a top-level listener sees queries run inside transaction()', async () => {
    await db.run(sql`DROP TABLE IF EXISTS users`)
    await db.run(sql`CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL)`)
    const cfg: DrizzleConfig = { client: db, dialect: 'sqlite', tables: { users } }
    const adapter = await drizzle(cfg).create()
    const events: QueryEvent[] = []
    adapter.onQuery!((e) => events.push(e))
    ModelRegistry.reset()
    ModelRegistry.set(adapter)

    await transaction(async () => {
      await User.create({ name: 'Ada' })
      await User.count()
    })
    const sqls = events.map(e => e.sql.toLowerCase())
    assert.ok(sqls.some(s => s.startsWith('insert')), `expected an insert event, got: ${sqls.join(' | ')}`)
    assert.ok(sqls.some(s => s.startsWith('select')), `expected a select event, got: ${sqls.join(' | ')}`)
  })
})

// ─── raw DB-facade seams (execute-capable fake client) ─────

describe('Drizzle onQuery — raw selectRaw / affectingStatement report', () => {
  it('reports the raw text + bindings on both seams', async () => {
    const fakeDb = {
      execute: async () => [{ ok: 1 }],
    }
    const adapter = await drizzle({ client: fakeDb, dialect: 'pg' }).create()
    const events: QueryEvent[] = []
    adapter.onQuery!((e) => events.push(e))

    const seams = adapter as unknown as {
      selectRaw(text: string, bindings: readonly unknown[]): Promise<unknown>
      affectingStatement(text: string, bindings: readonly unknown[]): Promise<number>
    }
    await seams.selectRaw('SELECT * FROM users WHERE id = ?', [7])
    await seams.affectingStatement('DELETE FROM users WHERE id = ?', [7])

    assert.equal(events.length, 2)
    assert.equal(events[0]!.sql, 'SELECT * FROM users WHERE id = ?')
    assert.deepEqual(events[0]!.bindings, [7])
    assert.equal(events[1]!.sql, 'DELETE FROM users WHERE id = ?')
    assert.equal(events[0]!.connection, 'pg')
  })
})
