// whereHas OR/count operators on the native engine — orWhereHas /
// orWhereDoesntHave / has(rel, op, n) / orHas. Real better-sqlite3 end-to-end.

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { Model, ModelRegistry } from '../index.js'
import { NativeAdapter } from '@rudderjs/database/native'
import { BetterSqlite3Driver } from '@rudderjs/database/native'
import type { Driver } from '@rudderjs/database/native'

class User extends Model {
  static override table = 'users'
  static override relations = {
    posts: { type: 'hasMany' as const, model: () => Post, foreignKey: 'userId' },
  }
  id!: number
  name!: string
}

class Post extends Model {
  static override table = 'posts'
  id!: number
  userId!: number
  published!: number
}

let driver: Driver

// Ada: 3 posts (2 published) · Edsger: 2 posts (1 published)
// Alan: 1 post (0 published) · Grace: 0 posts
const users: Array<[number, string]> = [[1, 'Ada'], [2, 'Alan'], [3, 'Grace'], [4, 'Edsger']]
const posts: Array<[number, number, number]> = [
  [1, 1, 1], [2, 1, 1], [3, 1, 0],   // Ada
  [4, 2, 0],                          // Alan
  [5, 4, 1], [6, 4, 0],               // Edsger
]

beforeEach(async () => {
  driver = await BetterSqlite3Driver.open({ filename: ':memory:' })
  await driver.execute(`CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)`, [])
  await driver.execute(`CREATE TABLE posts (id INTEGER PRIMARY KEY, userId INTEGER, published INTEGER)`, [])
  ModelRegistry.reset()
  ModelRegistry.set(await NativeAdapter.make({ driverInstance: driver }))
  for (const [id, name] of users) await driver.execute(`INSERT INTO users (id, name) VALUES (?, ?)`, [id, name])
  for (const p of posts) await driver.execute(`INSERT INTO posts (id, userId, published) VALUES (?, ?, ?)`, p)
})

afterEach(async () => { await driver.close() })

const names = (rows: User[]): string[] => rows.map(r => r.name).sort()

describe('whereHas count/OR operators (native)', () => {
  it('has(rel, >=, n) counts matching children', async () => {
    assert.deepEqual(names(await User.has('posts', '>=', 2).get()), ['Ada', 'Edsger'])
    assert.deepEqual(names(await User.has('posts', '>=', 3).get()), ['Ada'])
  })

  it('has(rel, <, 1) selects rows with no children', async () => {
    assert.deepEqual(names(await User.has('posts', '<', 1).get()), ['Grace'])
  })

  it('has() with a constraint counts only matching children', async () => {
    // users with >= 2 PUBLISHED posts → only Ada (2 published)
    const rows = await User.has('posts', '>=', 2, q => q.where('published', 1)).get()
    assert.deepEqual(names(rows), ['Ada'])
  })

  it('orWhereHas OR-roots the existence predicate', async () => {
    // name = Grace OR has a published post
    const rows = await User.query()
      .where('name', 'Grace')
      .orWhereHas('posts', q => q.where('published', 1))
      .get()
    assert.deepEqual(names(rows), ['Ada', 'Edsger', 'Grace'])
  })

  it('orHas OR-roots a count comparison', async () => {
    // name = Grace OR has >= 3 posts
    const rows = await User.query().where('name', 'Grace').orHas('posts', '>=', 3).get()
    assert.deepEqual(names(rows), ['Ada', 'Grace'])
  })

  it('orWhereDoesntHave OR-roots a non-existence predicate', async () => {
    // name = Ada OR has no posts at all
    const rows = await User.query().where('name', 'Ada').orWhereDoesntHave('posts').get()
    assert.deepEqual(names(rows), ['Ada', 'Grace'])
  })

  it('plain whereHas/whereDoesntHave still AND-merge (unchanged)', async () => {
    assert.deepEqual(names(await User.whereHas('posts').get()), ['Ada', 'Alan', 'Edsger'])
    assert.deepEqual(names(await User.whereDoesntHave('posts').get()), ['Grace'])
  })
})
