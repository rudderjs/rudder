// whereColumn — column-vs-column predicates, dialect-quoted both sides.
//
// A real in-memory better-sqlite3 engine proves the native compiler path
// end-to-end (both columns quoted, no binding); the 2-arg equality form and
// the 3-arg operator form, AND- and OR-rooted.

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { Model, ModelRegistry } from '../index.js'
import { NativeAdapter } from '@rudderjs/database/native'
import { BetterSqlite3Driver } from '@rudderjs/database/native'
import type { Driver } from '@rudderjs/database/native'

class Account extends Model {
  static override table = 'accounts'
  id!: number
  name!: string
  balance!: number
  overdraft!: number
}

let driver: Driver

// [name, balance, overdraft]
const seed: Array<[string, number, number]> = [
  ['Ada',    100, 50],   // balance > overdraft
  ['Alan',    20, 20],   // balance = overdraft
  ['Grace',   10, 80],   // balance < overdraft
]

beforeEach(async () => {
  driver = await BetterSqlite3Driver.open({ filename: ':memory:' })
  await driver.execute(
    `CREATE TABLE accounts (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, balance INTEGER, overdraft INTEGER)`,
    [],
  )
  ModelRegistry.reset()
  ModelRegistry.set(await NativeAdapter.make({ driverInstance: driver }))
  for (const [name, balance, overdraft] of seed) await Account.create({ name, balance, overdraft })
})

afterEach(async () => { await driver.close() })

const names = (rows: Account[]): string[] => rows.map(r => r.name).sort()

describe('whereColumn (native)', () => {
  it('2-arg form compares two columns for equality', async () => {
    const rows = await Account.whereColumn('balance', 'overdraft').get()
    assert.deepEqual(names(rows), ['Alan'])
  })

  it('3-arg form carries the operator', async () => {
    const gt = await Account.whereColumn('balance', '>', 'overdraft').get()
    assert.deepEqual(names(gt), ['Ada'])
    const lte = await Account.whereColumn('balance', '<=', 'overdraft').get()
    assert.deepEqual(names(lte), ['Alan', 'Grace'])
  })

  it('chains after a value where (AND)', async () => {
    const rows = await Account.query().where('balance', '>=', 20).whereColumn('balance', '>', 'overdraft').get()
    assert.deepEqual(names(rows), ['Ada'])
  })

  it('orWhereColumn OR-roots the predicate', async () => {
    // balance < overdraft (Grace) OR name = 'Ada'
    const rows = await Account.where('name', 'Ada').orWhereColumn('balance', '<', 'overdraft').get()
    assert.deepEqual(names(rows), ['Ada', 'Grace'])
  })

  it('quotes both identifiers (no binding leakage)', async () => {
    // Smoke: a column named like a keyword still resolves because it's quoted.
    const rows = await Account.query().whereColumn('overdraft', '<', 'balance').get()
    assert.deepEqual(names(rows), ['Ada'])
  })
})
