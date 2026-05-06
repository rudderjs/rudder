import { describe, it, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { drizzle as drizzleSqlite } from 'drizzle-orm/better-sqlite3'
import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core'
import type { QueryBuilder } from '@rudderjs/contracts'
import { drizzle, DrizzleAdapter, type DrizzleConfig } from './index.js'

// Real SQLite — proves the generated SQL groups conditions correctly.

const items = sqliteTable('items', {
  id:       integer('id').primaryKey({ autoIncrement: true }),
  status:   text('status').notNull(),
  priority: text('priority').notNull(),
  starred:  integer('starred', { mode: 'boolean' }).notNull().default(false),
  views:    integer('views').notNull().default(0),
})

type Item = {
  id: number
  status: string
  priority: string
  starred: boolean
  views: number
}

let adapter: DrizzleAdapter

async function makeAdapter(): Promise<DrizzleAdapter> {
  const sqlite = new Database(':memory:')
  sqlite.exec(`
    CREATE TABLE items (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      status    TEXT    NOT NULL,
      priority  TEXT    NOT NULL,
      starred   INTEGER NOT NULL DEFAULT 0,
      views     INTEGER NOT NULL DEFAULT 0
    );
  `)
  const db = drizzleSqlite(sqlite)
  const cfg: DrizzleConfig = { client: db, tables: { items } }
  return drizzle(cfg).create() as Promise<DrizzleAdapter>
}

async function seed(): Promise<void> {
  const qb = adapter.query<Item>('items')
  await qb.create({ status: 'active',   priority: 'high', starred: false, views: 100 })
  await qb.create({ status: 'active',   priority: 'low',  starred: true,  views: 200 })
  await qb.create({ status: 'archived', priority: 'high', starred: false, views: 300 })
  await qb.create({ status: 'archived', priority: 'low',  starred: false, views: 400 })
  await qb.create({ status: 'pending',  priority: 'high', starred: true,  views: 50  })
}

describe('DrizzleQueryBuilder.whereGroup — real SQLite', () => {
  before(async () => { adapter = await makeAdapter() })
  beforeEach(async () => {
    adapter = await makeAdapter()
    await seed()
  })

  it('where + whereGroup(or) → status = active AND (priority = high OR starred = TRUE)', async () => {
    const rows = await adapter.query<Item>('items')
      .where('status', 'active')
      .whereGroup(g => g.where('priority', 'high').orWhere('starred', true))
      .orderBy('id', 'ASC')
      .get()
    assert.deepEqual(
      rows.map((r: Item) => ({ status: r.status, priority: r.priority, starred: r.starred })),
      [
        { status: 'active', priority: 'high', starred: false },
        { status: 'active', priority: 'low',  starred: true  },
      ],
    )
  })

  it('orWhereGroup → adds an OR-rooted block', async () => {
    // status = active OR (priority = high AND starred = TRUE)
    const rows = await adapter.query<Item>('items')
      .where('status', 'active')
      .orWhereGroup(g => g.where('priority', 'high').where('starred', true))
      .orderBy('id', 'ASC')
      .get()
    const triples = rows.map((r: Item) => `${r.status}/${r.priority}/${r.starred ? 'star' : 'plain'}`)
    assert.deepEqual(triples, [
      'active/high/plain',
      'active/low/star',
      'pending/high/star',
    ])
  })

  it('empty group is a no-op', async () => {
    const rows = await adapter.query<Item>('items')
      .where('status', 'active')
      .whereGroup(_g => undefined)
      .get()
    assert.equal(rows.length, 2)
  })

  it('3-level nesting: a AND (b OR (c AND d))', async () => {
    // Match rows where status = active AND (priority = high OR (starred = true AND views > 100))
    const rows = await adapter.query<Item>('items')
      .where('status', 'active')
      .whereGroup(g1 =>
        g1.where('priority', 'high')
          .orWhereGroup(g2 =>
            g2.where('starred', true).where('views', '>', 100),
          ),
      )
      .orderBy('id', 'ASC')
      .get()
    assert.deepEqual(
      rows.map((r: Item) => ({ priority: r.priority, starred: r.starred, views: r.views })),
      [
        { priority: 'high', starred: false, views: 100 },
        { priority: 'low',  starred: true,  views: 200 },
      ],
    )
  })

  it('mixing whereGroup with regular where — group does not leak', async () => {
    // (priority = high OR priority = low) AND status = active
    // Without grouping, status = active AND priority = high OR priority = low
    // would match all rows with priority = low.
    const rows = await adapter.query<Item>('items')
      .whereGroup(g => g.where('priority', 'high').orWhere('priority', 'low'))
      .where('status', 'active')
      .orderBy('id', 'ASC')
      .get()
    assert.equal(rows.length, 2)
    assert.ok(rows.every((r: Item) => r.status === 'active'))
  })

  it('counter-example: without whereGroup, OR leaks across the chain', async () => {
    // Sanity check that the group is actually doing the wrapping. Without
    // it, status='active' AND priority='high' OR priority='low' matches
    // everything with priority='low' regardless of status.
    const rows = await adapter.query<Item>('items')
      .where('status', 'active')
      .where('priority', 'high')
      .orWhere('priority', 'low')
      .get()
    assert.ok(rows.length > 2, 'expected the OR to leak beyond status=active')
  })
})

describe('DrizzleQueryBuilder — sub-builder terminals throw', () => {
  before(async () => { adapter = await makeAdapter() })
  beforeEach(async () => {
    adapter = await makeAdapter()
    await seed()
  })

  async function expectSubTerminalRejects(
    invoke: (sub: QueryBuilder<unknown>) => Promise<unknown>,
  ): Promise<void> {
    const q = adapter.query<unknown>('items') as QueryBuilder<unknown>
    let captured: Promise<unknown> | null = null
    q.whereGroup((g) => { captured = invoke(g) })
    assert.ok(captured, 'callback did not run')
    await assert.rejects(
      captured as unknown as Promise<unknown>,
      /Sub-builder is for where\* chaining only/,
    )
  }

  it('get()      rejects', async () => { await expectSubTerminalRejects(g => g.get()) })
  it('first()    rejects', async () => { await expectSubTerminalRejects(g => g.first()) })
  it('find()     rejects', async () => { await expectSubTerminalRejects(g => g.find(1)) })
  it('count()    rejects', async () => { await expectSubTerminalRejects(g => g.count()) })
  it('paginate() rejects', async () => { await expectSubTerminalRejects(g => g.paginate(1, 10)) })
})
