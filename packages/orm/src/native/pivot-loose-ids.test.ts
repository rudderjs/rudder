// Pivot loose-id comparison — sqlite E2E (the pilotiq repro).
//
// belongsToMany with numeric autoincrement PKs and a UNIQUE(articleId, tagId)
// index: an HTML form re-submits the already-attached tag ids as STRINGS
// (`sync(["1","3"])`). Pre-fix, the strict Set diff re-attached "3" against
// the stored 3 → UNIQUE constraint violation (runtime 500). On a pivot
// WITHOUT the unique index the same diff was worse: the duplicate inserted,
// then the detach side deleted BOTH rows — a silent detach on a no-change
// form submit. Both modes are pinned here against a real better-sqlite3 DB.

import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { Model, ModelRegistry } from '../index.js'
import { NativeAdapter, BetterSqlite3Driver } from '@rudderjs/database/native'
import type { Driver } from '@rudderjs/database/native'

class Tag extends Model {
  static override table = 'tags'
  id!: number
  name!: string
}

class Article extends Model {
  static override table = 'articles'
  static override relations = {
    tags: { type: 'belongsToMany' as const, model: () => Tag, pivotTable: 'article_tag' },
  }
  id!: number
  title!: string
}

let driver: Driver

async function seed(): Promise<void> {
  await driver.execute(`CREATE TABLE articles (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT)`, [])
  await driver.execute(`CREATE TABLE tags (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)`, [])
  await driver.execute(
    `CREATE TABLE article_tag (
       articleId INTEGER NOT NULL,
       tagId     INTEGER NOT NULL,
       UNIQUE (articleId, tagId)
     )`, [])
  // Same shape, no unique index — pins the silent-double-row/delete mode.
  await driver.execute(`CREATE TABLE article_tag_loose (articleId INTEGER NOT NULL, tagId INTEGER NOT NULL)`, [])

  await driver.execute(`INSERT INTO articles (id, title) VALUES (1, 'first')`, [])
  for (const [id, name] of [[1, 'news'], [2, 'tech'], [3, 'sports'], [4, 'art']] as Array<[number, string]>) {
    await driver.execute(`INSERT INTO tags (id, name) VALUES (?, ?)`, [id, name])
  }
}

before(async () => { driver = await BetterSqlite3Driver.open({ filename: ':memory:' }); await seed() })
after(async () => { await driver.close() })
beforeEach(async () => {
  ModelRegistry.reset()
  ModelRegistry.set(await NativeAdapter.make({ driverInstance: driver }))
  await driver.execute(`DELETE FROM article_tag`, [])
  await driver.execute(`DELETE FROM article_tag_loose`, [])
})

const pivotIds = async (table = 'article_tag'): Promise<unknown[]> => {
  const rows = await driver.execute(`SELECT tagId FROM ${table} WHERE articleId = 1 ORDER BY tagId`, [])
  return rows.map(r => r['tagId'])
}

describe('native pivot — loose id sync (UNIQUE index)', () => {
  it('re-submitting an unchanged form does not violate the UNIQUE index', async () => {
    const article = (await Article.find(1))!
    const accessor = Model.belongsToMany(article, 'tags')
    await accessor.attach([1, 3])

    // The pilotiq repro: same ids back as strings.
    const result = await accessor.sync(['1', '3'])
    assert.deepStrictEqual(result.attached, [])
    assert.deepStrictEqual(result.detached, [])
    assert.deepStrictEqual(await pivotIds(), [1, 3])
  })

  it('string-id sync diffs correctly: attach new, detach dropped', async () => {
    const article = (await Article.find(1))!
    const accessor = Model.belongsToMany(article, 'tags')
    await accessor.attach([1, 3])

    const result = await accessor.sync(['1', '4'])
    assert.deepStrictEqual(result.attached, [4])
    assert.deepStrictEqual(result.detached, [3])
    assert.deepStrictEqual(await pivotIds(), [1, 4])
  })

  it('detach with string ids removes the numeric rows', async () => {
    const article = (await Article.find(1))!
    const accessor = Model.belongsToMany(article, 'tags')
    await accessor.attach([1, 2, 3])
    const removed = await accessor.detach(['2', '3'])
    assert.strictEqual(removed, 2)
    assert.deepStrictEqual(await pivotIds(), [1])
  })
})

describe('native pivot — loose id sync (no unique index)', () => {
  class LooseArticle extends Model {
    static override table = 'articles'
    static override relations = {
      tags: { type: 'belongsToMany' as const, model: () => Tag, pivotTable: 'article_tag_loose', foreignPivotKey: 'articleId' },
    }
    id!: number
  }

  it('no-change string sync neither duplicates nor silently deletes rows', async () => {
    const article = (await LooseArticle.find(1))!
    const accessor = Model.belongsToMany(article, 'tags')
    await accessor.attach([1, 3])

    // Pre-fix this inserted a duplicate "3" AND the detach IN-list then
    // deleted both copies — tag 3 vanished on a no-change submit.
    const result = await accessor.sync(['1', '3'])
    assert.deepStrictEqual(result.attached, [])
    assert.deepStrictEqual(result.detached, [])
    assert.deepStrictEqual(await pivotIds('article_tag_loose'), [1, 3])
  })
})
