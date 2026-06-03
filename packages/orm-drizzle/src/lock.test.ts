// Pessimistic locking (lockForUpdate / sharedLock) on the Drizzle adapter.
//
// Renders via Drizzle's `.for('update' | 'share')` on pg/mysql select builders.
// On sqlite the lock is a NO-OP (no row locks — its write transaction already
// serializes; same contract as the native engine's `lockSql`), and on a union'd
// query the lock is skipped (`FOR UPDATE` is not valid SQL on a set operation).
//
// The dialect branching is pinned with a recording fake client (no DB needed —
// we assert which builder methods the read terminals chain); the sqlite no-op
// is also driven end-to-end against real better-sqlite3.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { drizzle as drizzleSqlite } from 'drizzle-orm/better-sqlite3'
import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core'
import { Model, ModelRegistry } from '@rudderjs/orm'
import { drizzle, type DrizzleConfig } from './index.js'

// ─── recording fake client ─────────────────────────────────

/** A thenable self-returning builder that records every chained call. */
function makeRecorder(calls: Array<[string, ...unknown[]]>) {
  const qb: Record<string, unknown> = {}
  for (const m of ['where', 'innerJoin', 'leftJoin', 'rightJoin', 'crossJoin', 'groupBy',
                   'having', 'union', 'unionAll', 'for', 'orderBy', 'limit', 'offset']) {
    qb[m] = (...args: unknown[]) => { calls.push([m, ...args]); return qb }
  }
  qb['then'] = (resolve: (v: unknown) => unknown) => Promise.resolve([]).then(resolve)
  return {
    select:         () => ({ from: () => qb }),
    selectDistinct: () => ({ from: () => qb }),
  }
}

type LockableQB = { lockForUpdate(): unknown; sharedLock(): unknown }

async function recordedGet(dialect: 'pg' | 'mysql' | 'sqlite', chain: (q: LockableQB) => void) {
  const calls: Array<[string, ...unknown[]]> = []
  const adapter = await drizzle({ client: makeRecorder(calls), dialect, tables: { users: {} } }).create()
  const q = adapter.query('users')
  chain(q as unknown as LockableQB)
  await q.get()
  return calls
}

describe('Drizzle locking — dialect branching (recorded)', () => {
  it('lockForUpdate() chains .for("update") on pg', async () => {
    const calls = await recordedGet('pg', q => q.lockForUpdate())
    assert.deepEqual(calls, [['for', 'update']])
  })

  it('sharedLock() chains .for("share") on mysql', async () => {
    const calls = await recordedGet('mysql', q => q.sharedLock())
    assert.deepEqual(calls, [['for', 'share']])
  })

  it('the lock is a NO-OP on sqlite', async () => {
    const calls = await recordedGet('sqlite', q => q.lockForUpdate())
    assert.deepEqual(calls, [])
  })

  it('no lock requested → no .for() call', async () => {
    const calls = await recordedGet('pg', () => {})
    assert.deepEqual(calls, [])
  })
})

// ─── sqlite end-to-end (no-op, no crash) ───────────────────

const users = sqliteTable('users', {
  id:   integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
})

class User extends Model {
  static override table = 'users'
  id!:   number
  name!: string
}

describe('Drizzle locking — sqlite end-to-end no-op', () => {
  it('lockForUpdate() / sharedLock() chain through every read terminal', async () => {
    const sqlite = new Database(':memory:')
    sqlite.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL);`)
    sqlite.exec(`INSERT INTO users (name) VALUES ('Ada'),('Alan');`)
    const cfg: DrizzleConfig = { client: drizzleSqlite(sqlite), dialect: 'sqlite', tables: { users } }
    ModelRegistry.reset()
    ModelRegistry.set(await drizzle(cfg).create())

    const rows = await User.query().lockForUpdate!().get()
    assert.equal(rows.length, 2)
    const first = await User.query().sharedLock!().orderBy('name').first()
    assert.equal(first?.name, 'Ada')
    const found = await User.query().lockForUpdate!().find(1)
    assert.equal(found?.name, 'Ada')
    const page = await User.query().sharedLock!().paginate(1, 1)
    assert.equal(page.total, 2)
  })
})
