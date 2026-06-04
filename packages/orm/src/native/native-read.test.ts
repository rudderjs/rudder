// Read-path conformance for the native engine.
//
// Boots a REAL better-sqlite3 in-memory database, registers `NativeAdapter`,
// and drives the read slice of the `@rudderjs/orm` Model surface against it —
// the dialect-agnostic Model suite IS the conformance suite (cross-phase rule
// 1). Green here = Phase 1 done.

import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { Model, ModelRegistry } from '../index.js'
import { NativeAdapter } from '@rudderjs/database/native'
import { BetterSqlite3Driver } from '@rudderjs/database/native'
import type { Driver } from '@rudderjs/database/native'

// ── Models under test ────────────────────────────────────────
class User extends Model {
  static override table = 'users'
  static override casts = { isActive: 'boolean' } as const
  id!: number
  name!: string
  email!: string
  age!: number
  isActive!: boolean
}

class Doc extends Model {
  static override table = 'docs'
  static override softDeletes = true
  id!: number
  title!: string
  deletedAt!: string | null
}

let driver: Driver

async function seed(): Promise<void> {
  await driver.execute(
    `CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT, age INTEGER, isActive INTEGER)`, [])
  await driver.execute(
    `CREATE TABLE docs (id INTEGER PRIMARY KEY, title TEXT, deletedAt TEXT)`, [])

  const users: Array<[number, string, string, number, number]> = [
    [1, 'Ada',   'ada@x.dev',   36, 1],
    [2, 'Alan',  'alan@x.dev',  41, 1],
    [3, 'Grace', 'grace@x.dev', 52, 0],
    [4, 'Edsger','ed@x.dev',    29, 1],
  ]
  for (const u of users) {
    await driver.execute(`INSERT INTO users (id, name, email, age, isActive) VALUES (?, ?, ?, ?, ?)`, u)
  }

  // docs: 2 live, 1 trashed
  await driver.execute(`INSERT INTO docs (id, title, deletedAt) VALUES (?, ?, ?)`, [1, 'Live A', null])
  await driver.execute(`INSERT INTO docs (id, title, deletedAt) VALUES (?, ?, ?)`, [2, 'Live B', null])
  await driver.execute(`INSERT INTO docs (id, title, deletedAt) VALUES (?, ?, ?)`, [3, 'Gone',  '2026-01-01T00:00:00.000Z'])
}

before(async () => {
  driver = await BetterSqlite3Driver.open({ filename: ':memory:' })
  await seed()
})

after(async () => {
  await driver.close()
})

beforeEach(async () => {
  ModelRegistry.reset()
  const adapter = await NativeAdapter.make({ driverInstance: driver })
  ModelRegistry.set(adapter)
})

describe('native read — all / find / first', () => {
  it('all() returns every row as Model instances', async () => {
    const users = await User.all()
    assert.strictEqual(users.length, 4)
    assert.ok(users[0] instanceof User)
    assert.deepStrictEqual(users.map(u => u.name).sort(), ['Ada', 'Alan', 'Edsger', 'Grace'])
  })

  it('find(id) returns the matching row', async () => {
    const u = await User.find(2)
    assert.ok(u)
    assert.strictEqual(u!.name, 'Alan')
    assert.ok(u instanceof User)
  })

  it('find(id) returns null when absent', async () => {
    assert.strictEqual(await User.find(999), null)
  })

  it('findOrFail throws ModelNotFoundError when absent', async () => {
    await assert.rejects(() => User.findOrFail(999), /No User found for id 999/)
  })

  it('first() returns the first row', async () => {
    const u = await User.first()
    assert.ok(u)
    assert.strictEqual(u!.id, 1)
  })

  it('first() on an empty filter returns null', async () => {
    assert.strictEqual(await User.where('name', 'Nobody').first(), null)
  })
})

describe('native read — where / operators', () => {
  it('where equality filters', async () => {
    const rows = await User.where('name', 'Grace').get()
    assert.strictEqual(rows.length, 1)
    assert.strictEqual(rows[0]!.id, 3)
  })

  it('where with a comparison operator', async () => {
    const rows = await User.query().where('age', '>', 40).get()
    assert.deepStrictEqual(rows.map(u => u.name).sort(), ['Alan', 'Grace'])
  })

  it('where LIKE', async () => {
    const rows = await User.query().where('email', 'LIKE', '%@x.dev').get()
    assert.strictEqual(rows.length, 4)
  })

  it('where IN', async () => {
    const rows = await User.query().where('id', 'IN', [1, 3]).get()
    assert.deepStrictEqual(rows.map(u => u.id).sort(), [1, 3])
  })

  it('chained where AND-composes', async () => {
    const rows = await User.query().where('age', '>', 30).where('isActive', 1).get()
    assert.deepStrictEqual(rows.map(u => u.name).sort(), ['Ada', 'Alan'])
  })

  it('orWhere OR-composes', async () => {
    const rows = await User.where('name', 'Ada').orWhere('name', 'Grace').get()
    assert.deepStrictEqual(rows.map(u => u.id).sort(), [1, 3])
  })
})

describe('native read — whereGroup precedence', () => {
  it('groups an OR under a top-level AND', async () => {
    // isActive = 1 AND (name = 'Ada' OR name = 'Edsger')
    const rows = await User.query()
      .where('isActive', 1)
      .whereGroup(g => g.where('name', 'Ada').orWhere('name', 'Edsger'))
      .get()
    assert.deepStrictEqual(rows.map(u => u.id).sort(), [1, 4])
  })

  it('empty group is a no-op', async () => {
    const rows = await User.query().where('id', 1).whereGroup(() => { /* nothing */ }).get()
    assert.strictEqual(rows.length, 1)
  })
})

describe('native read — ordering, limit, offset', () => {
  it('orderBy ASC / DESC', async () => {
    const asc = await User.query().orderBy('age', 'ASC').get()
    assert.deepStrictEqual(asc.map(u => u.age), [29, 36, 41, 52])
    const desc = await User.query().orderBy('age', 'DESC').get()
    assert.deepStrictEqual(desc.map(u => u.age), [52, 41, 36, 29])
  })

  it('limit caps the result', async () => {
    const rows = await User.query().orderBy('id', 'ASC').limit(2).get()
    assert.deepStrictEqual(rows.map(u => u.id), [1, 2])
  })

  it('offset skips with a limit', async () => {
    const rows = await User.query().orderBy('id', 'ASC').limit(2).offset(2).get()
    assert.deepStrictEqual(rows.map(u => u.id), [3, 4])
  })
})

describe('native read — count / paginate', () => {
  it('count() counts all rows', async () => {
    assert.strictEqual(await User.count(), 4)
  })

  it('count() honors the where predicate', async () => {
    assert.strictEqual(await User.where('isActive', 1).count(), 3)
  })

  it('paginate returns a page envelope', async () => {
    const page = await User.query().orderBy('id', 'ASC').paginate(1, 2)
    assert.strictEqual(page.total, 4)
    assert.strictEqual(page.perPage, 2)
    assert.strictEqual(page.currentPage, 1)
    assert.strictEqual(page.lastPage, 2)
    assert.strictEqual(page.from, 1)
    assert.strictEqual(page.to, 2)
    assert.deepStrictEqual(page.data.map(u => u.id), [1, 2])
  })

  it('paginate page 2', async () => {
    const page = await User.query().orderBy('id', 'ASC').paginate(2, 2)
    assert.deepStrictEqual(page.data.map(u => u.id), [3, 4])
    assert.strictEqual(page.from, 3)
    assert.strictEqual(page.to, 4)
  })

  it('paginate past the end yields an empty page', async () => {
    const page = await User.query().paginate(99, 2)
    assert.strictEqual(page.data.length, 0)
    assert.strictEqual(page.total, 4)
  })
})

describe('native read — soft deletes', () => {
  it('default query excludes trashed rows', async () => {
    const docs = await Doc.all()
    assert.deepStrictEqual(docs.map(d => d.id).sort(), [1, 2])
  })

  it('withTrashed includes trashed rows', async () => {
    const docs = await Doc.query().withTrashed().get()
    assert.deepStrictEqual(docs.map(d => d.id).sort(), [1, 2, 3])
  })

  it('onlyTrashed returns just trashed rows', async () => {
    const docs = await Doc.query().onlyTrashed().get()
    assert.deepStrictEqual(docs.map(d => d.id), [3])
  })

  it('count respects the soft-delete scope', async () => {
    assert.strictEqual(await Doc.count(), 2)
  })
})

describe('native read — casts on serialization', () => {
  it('boolean cast converts SQLite 0/1 to true/false in toJSON', async () => {
    const ada = await User.find(1)
    const grace = await User.find(3)
    assert.strictEqual(ada!.toJSON()['isActive'], true)
    assert.strictEqual(grace!.toJSON()['isActive'], false)
  })
})
