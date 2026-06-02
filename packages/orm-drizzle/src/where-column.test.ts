// whereColumn on the Drizzle adapter — both sides render as Drizzle column
// refs (quoted per dialect), unlike whereRaw which is verbatim.

import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { drizzle as drizzleSqlite } from 'drizzle-orm/better-sqlite3'
import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core'
import { Model, ModelRegistry } from '@rudderjs/orm'
import { drizzle, type DrizzleConfig } from './index.js'

const accounts = sqliteTable('accounts', {
  id:        integer('id').primaryKey({ autoIncrement: true }),
  name:      text('name').notNull(),
  balance:   integer('balance').notNull(),
  overdraft: integer('overdraft').notNull(),
})

class Account extends Model {
  static override table = 'accounts'
  id!: number
  name!: string
  balance!: number
  overdraft!: number
}

function makeAdapter() {
  const sqlite = new Database(':memory:')
  sqlite.exec(`CREATE TABLE accounts (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, balance INTEGER NOT NULL, overdraft INTEGER NOT NULL);`)
  const db = drizzleSqlite(sqlite)
  const cfg: DrizzleConfig = { client: db, dialect: 'sqlite', tables: { accounts } }
  return drizzle(cfg).create()
}

beforeEach(async () => {
  ModelRegistry.reset()
  ModelRegistry.set(await makeAdapter())
  for (const [name, balance, overdraft] of [['Ada', 100, 50], ['Alan', 20, 20], ['Grace', 10, 80]] as const) {
    await Account.create({ name, balance, overdraft })
  }
})

const names = (rows: Account[]): string[] => rows.map(r => r.name).sort()

describe('Drizzle whereColumn', () => {
  it('2-arg equality', async () => {
    assert.deepStrictEqual(names(await Account.whereColumn('balance', 'overdraft').get()), ['Alan'])
  })

  it('3-arg operator form', async () => {
    assert.deepStrictEqual(names(await Account.whereColumn('balance', '>', 'overdraft').get()), ['Ada'])
    assert.deepStrictEqual(names(await Account.whereColumn('balance', '<=', 'overdraft').get()), ['Alan', 'Grace'])
  })

  it('orWhereColumn OR-roots', async () => {
    const rows = await Account.query().where('name', 'Ada').orWhereColumn('balance', '<', 'overdraft').get()
    assert.deepStrictEqual(names(rows), ['Ada', 'Grace'])
  })

  it('has() count comparison throws with a pointer', async () => {
    const q = ModelRegistry.getAdapter().query('accounts')
    const base = { relation: 'posts', exists: true, relatedTable: 'accounts', parentColumn: 'id', relatedColumn: 'id', constraintWheres: [] }
    assert.throws(() => q.whereRelationExists({ ...base, count: { operator: '>=', value: 3 } }), /count comparison is not implemented/)
  })

  it('orWhereHas (OR-rooted existence) throws', async () => {
    const q = ModelRegistry.getAdapter().query('accounts')
    const base = { relation: 'posts', exists: true, relatedTable: 'accounts', parentColumn: 'id', relatedColumn: 'id', constraintWheres: [] }
    assert.throws(() => q.whereRelationExists({ ...base, boolean: 'OR' }), /OR-rooted relation existence\) is not implemented/)
  })
})
