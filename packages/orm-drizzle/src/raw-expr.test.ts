// Raw-expression support on the Drizzle adapter.
//
// whereRaw / orWhereRaw / orderByRaw compose through Drizzle's `sql` template
// (each `?` placeholder rebinds to a bound param). orderBy(raw(...)) and a raw
// Expression as a where value splice verbatim. selectRaw throws — Drizzle's
// typed select can't map an arbitrary raw projection back to hydrated models.

import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { drizzle as drizzleSqlite } from 'drizzle-orm/better-sqlite3'
import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core'
import { Model, ModelRegistry } from '@rudderjs/orm'
import { raw } from '@rudderjs/contracts'
import { drizzle, type DrizzleConfig } from './index.js'

const users = sqliteTable('users', {
  id:   integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  age:  integer('age').notNull(),
})

class User extends Model {
  static override table = 'users'
  id!: number
  name!: string
  age!: number
}

function makeAdapter() {
  const sqlite = new Database(':memory:')
  sqlite.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, age INTEGER NOT NULL);`)
  const db = drizzleSqlite(sqlite)
  const cfg: DrizzleConfig = { client: db, dialect: 'sqlite', tables: { users } }
  return drizzle(cfg).create()
}

beforeEach(async () => {
  ModelRegistry.reset()
  ModelRegistry.set(await makeAdapter())
  for (const [name, age] of [['Ada', 36], ['Alan', 41], ['Grace', 52], ['Edsger', 29]] as const) {
    await User.create({ name, age })
  }
})

describe('Drizzle raw expressions', () => {
  it('whereRaw filters with a bound value', async () => {
    const rows = await User.query().whereRaw('age > ?', [40]).orderBy('id').get()
    assert.deepStrictEqual(rows.map(u => u.name), ['Alan', 'Grace'])
  })

  it('whereRaw + orWhereRaw compose', async () => {
    const rows = await User.query().whereRaw('age < ?', [30]).orWhereRaw('age > ?', [50]).orderBy('id').get()
    assert.deepStrictEqual(rows.map(u => u.name).sort(), ['Edsger', 'Grace'])
  })

  it('whereRaw composes with a structured where (AND)', async () => {
    const rows = await User.query().where('name', '!=', 'Alan').whereRaw('age > ?', [35]).orderBy('id').get()
    assert.deepStrictEqual(rows.map(u => u.name), ['Ada', 'Grace'])
  })

  it('orderByRaw orders the result set', async () => {
    const rows = await User.query().orderByRaw('age desc').get()
    assert.deepStrictEqual(rows.map(u => u.name), ['Grace', 'Alan', 'Ada', 'Edsger'])
  })

  it('orderBy(raw(...)) orders verbatim', async () => {
    const rows = await User.query().orderBy(raw('age asc')).get()
    assert.deepStrictEqual(rows.map(u => u.age), [29, 36, 41, 52])
  })

  it('a raw Expression as a where value splices verbatim', async () => {
    // age > (age) is always false → no rows; proves the fragment reaches SQL unbound.
    const rows = await User.query().where('age', '>', raw('age')).get()
    assert.deepStrictEqual(rows, [])
  })

  it('whereRaw throws on a binding-count mismatch', () => {
    assert.throws(() => User.query().whereRaw('age > ? and x < ?', [40]), /expects 2 binding\(s\).*but got 1/)
  })

  it('selectRaw throws with a pointer to the DB facade', () => {
    assert.throws(() => User.query().selectRaw('count(*) as total'), /not supported.*DB\.select/s)
  })

  // joins + select() (drizzle-joins.test.ts) and groupBy/having/distinct
  // (group-having-distinct.test.ts) are now implemented on Drizzle.
  // union/unionAll remain unsupported (a separate follow-up).
  it('union + unionAll throw with a native-engine / DB-facade pointer', () => {
    const q = User.query() as unknown as { union(o: unknown): unknown; unionAll(o: unknown): unknown }
    assert.throws(() => q.union(User.query()),    /union\(\) is not supported.*native engine.*DB\.select/s)
    assert.throws(() => q.unionAll(User.query()), /unionAll\(\) is not supported/)
  })
})
