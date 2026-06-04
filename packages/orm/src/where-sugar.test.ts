// where-sugar — named where variants, conditional clauses, and scalar terminals.
//
// All are adapter-agnostic (composed at the Model layer from the existing
// where/orWhere/whereGroup/orderBy/get/first/_aggregate primitives), so a real
// in-memory native better-sqlite3 adapter proves them end-to-end for every
// adapter at once.

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { Model, ModelRegistry } from './index.js'
import { NativeAdapter } from './native/adapter.js'
import { BetterSqlite3Driver } from '@rudderjs/database/native'
import type { Driver } from '@rudderjs/database/native'

class User extends Model {
  static override table = 'users'
  id!: number
  name!: string
  age!: number
  role!: string | null
}

let driver: Driver

const seed: Array<[string, number, string | null]> = [
  ['Ada', 36, 'admin'],
  ['Alan', 41, 'user'],
  ['Grace', 52, 'admin'],
  ['Edsger', 29, null],
]

beforeEach(async () => {
  driver = await BetterSqlite3Driver.open({ filename: ':memory:' })
  await driver.execute(`CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, age INTEGER, role TEXT)`, [])
  ModelRegistry.reset()
  ModelRegistry.set(await NativeAdapter.make({ driverInstance: driver }))
  for (const [name, age, role] of seed) await User.create({ name, age, role })
})

afterEach(async () => { await driver.close() })

const names = (rows: User[]) => rows.map(u => u.name)

describe('whereIn / whereNotIn', () => {
  it('whereIn matches the listed values', async () => {
    const rows = await User.query().whereIn('name', ['Ada', 'Grace']).orderBy('id').get()
    assert.deepEqual(names(rows), ['Ada', 'Grace'])
  })
  it('whereNotIn excludes the listed values', async () => {
    const rows = await User.query().whereNotIn('name', ['Ada', 'Grace']).orderBy('id').get()
    assert.deepEqual(names(rows), ['Alan', 'Edsger'])
  })
  it('orWhereIn adds an OR alternative', async () => {
    const rows = await User.query().where('age', '>', 50).orWhereIn('name', ['Edsger']).orderBy('id').get()
    assert.deepEqual(names(rows).sort(), ['Edsger', 'Grace'])
  })
})

describe('whereNull / whereNotNull', () => {
  it('whereNull matches NULL columns', async () => {
    const rows = await User.query().whereNull('role').get()
    assert.deepEqual(names(rows), ['Edsger'])
  })
  it('whereNotNull matches non-NULL columns', async () => {
    const rows = await User.query().whereNotNull('role').orderBy('id').get()
    assert.deepEqual(names(rows), ['Ada', 'Alan', 'Grace'])
  })
})

describe('whereBetween / whereNotBetween', () => {
  it('whereBetween is inclusive', async () => {
    const rows = await User.query().whereBetween('age', [30, 45]).orderBy('id').get()
    assert.deepEqual(names(rows), ['Ada', 'Alan'])
  })
  it('whereNotBetween excludes the range', async () => {
    const rows = await User.query().whereNotBetween('age', [30, 45]).orderBy('id').get()
    assert.deepEqual(names(rows), ['Grace', 'Edsger'])
  })
  it('whereBetween composes with another where (AND)', async () => {
    const rows = await User.query().where('role', 'admin').whereBetween('age', [30, 45]).get()
    assert.deepEqual(names(rows), ['Ada'])
  })
})

describe('when / unless', () => {
  it('when applies the callback only when truthy', async () => {
    const build = (role: string | null) =>
      User.query().when(role, (q, r) => q.where('role', r)).orderBy('id')
    assert.deepEqual(names(await build('admin').get()), ['Ada', 'Grace'])
    assert.deepEqual(names(await build(null).get()), ['Ada', 'Alan', 'Grace', 'Edsger']) // no filter
  })
  it('when runs the otherwise branch when falsy', async () => {
    const rows = await User.query()
      .when(0, (q) => q.where('role', 'admin'), (q) => q.where('role', 'user'))
      .get()
    assert.deepEqual(names(rows), ['Alan'])
  })
  it('unless is the inverse of when', async () => {
    const rows = await User.query().unless(false, (q) => q.where('role', 'admin')).orderBy('id').get()
    assert.deepEqual(names(rows), ['Ada', 'Grace'])
  })
})

describe('latest / oldest', () => {
  it('latest orders by a column DESC', async () => {
    const rows = await User.query().latest('age').get()
    assert.deepEqual(names(rows), ['Grace', 'Alan', 'Ada', 'Edsger'])
  })
  it('oldest orders by a column ASC', async () => {
    const rows = await User.query().oldest('age').get()
    assert.deepEqual(names(rows), ['Edsger', 'Ada', 'Alan', 'Grace'])
  })
})

describe('pluck / value', () => {
  it('pluck returns a flat array of one column', async () => {
    const ns = await User.query().orderBy('id').pluck('name')
    assert.deepEqual(ns, ['Ada', 'Alan', 'Grace', 'Edsger'])
  })
  it('value returns one column from the first row', async () => {
    const name = await User.query().orderBy('age', 'DESC').value('name')
    assert.strictEqual(name, 'Grace')
  })
  it('value returns undefined when no row matches', async () => {
    const name = await User.query().where('name', 'Nobody').value('name')
    assert.strictEqual(name, undefined)
  })
})

describe('scalar terminals — sum / max / min / avg / exists / doesntExist', () => {
  it('sum / max / min / avg', async () => {
    assert.strictEqual(await User.query().sum('age'), 36 + 41 + 52 + 29)
    assert.strictEqual(await User.query().max('age'), 52)
    assert.strictEqual(await User.query().min('age'), 29)
    assert.strictEqual(await User.query().avg('age'), (36 + 41 + 52 + 29) / 4)
  })
  it('aggregates respect the current constraints', async () => {
    assert.strictEqual(await User.query().where('role', 'admin').sum('age'), 36 + 52)
  })
  it('exists / doesntExist', async () => {
    assert.strictEqual(await User.query().where('role', 'admin').exists(), true)
    assert.strictEqual(await User.query().where('name', 'Nobody').exists(), false)
    assert.strictEqual(await User.query().where('name', 'Nobody').doesntExist(), true)
  })
})

describe('Model static entry points', () => {
  it('Model.whereIn / whereBetween / whereNull chain', async () => {
    assert.deepEqual(names(await User.whereIn('name', ['Ada']).get()), ['Ada'])
    assert.deepEqual(names(await User.whereBetween('age', [30, 45]).orderBy('id').get()), ['Ada', 'Alan'])
    assert.deepEqual(names(await User.whereNull('role').get()), ['Edsger'])
  })
  it('Model.latest / oldest', async () => {
    assert.deepEqual(names(await User.latest('age').get()), ['Grace', 'Alan', 'Ada', 'Edsger'])
  })
  it('Model.when conditionally filters', async () => {
    assert.deepEqual(names(await User.when('admin', (q, r) => q.where('role', r)).orderBy('id').get()), ['Ada', 'Grace'])
  })
  it('Model.sum / exists / pluck / value terminals', async () => {
    assert.strictEqual(await User.sum('age'), 158)
    assert.strictEqual(await User.exists(), true)
    assert.deepEqual(await User.query().orderBy('id').pluck('name'), ['Ada', 'Alan', 'Grace', 'Edsger'])
    assert.strictEqual(await User.oldest('age').value('name'), 'Edsger')
  })
})
