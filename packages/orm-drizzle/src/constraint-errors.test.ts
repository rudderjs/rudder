// ─── Constraint-violation error shapes — Drizzle adapter ────────────────────
//
// Audit P1-6 (docs/plans/2026-06-05-data-layer-test-audit.md), drizzle leg.
// Drizzle wraps driver errors in `Failed query: <sql>` (DrizzleQueryError)
// with the driver's error on `cause` — so the contract here is: the
// DISCRIMINATING FIELDS survive somewhere down the cause chain. User catch
// code does `err.cause?.code` (or walks); a drizzle/driver bump that breaks
// that chain should fail HERE:
//   • better-sqlite3 → `code: 'SQLITE_CONSTRAINT_*'`
//   • postgres-js   → `code: '23505' | '23503' | '42P01'`
//   • mysql2        → `errno: 1062 | 1452 | 1146`
//
// sqlite runs everywhere; pg/mysql blocks gate on PG_TEST_URL / MYSQL_TEST_URL.

import { describe, it, test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { drizzle as drizzleSqlite } from 'drizzle-orm/better-sqlite3'
import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core'
import { pgTable, serial, text as pgText, integer as pgInteger } from 'drizzle-orm/pg-core'
import { mysqlTable, serial as mysqlSerial, varchar as mysqlVarchar, int as mysqlInt } from 'drizzle-orm/mysql-core'
import { ModelRegistry } from '@rudderjs/orm'
import { DrizzleAdapter, drizzle, type DrizzleConfig } from './index.js'

const PG_URL = process.env['PG_TEST_URL']
const MYSQL_URL = process.env['MYSQL_TEST_URL']

/** True when any error down the cause chain satisfies `pred`. */
function chainHas(err: unknown, pred: (e: Record<string, unknown>) => boolean): boolean {
  for (let e = err as Record<string, unknown> | undefined; e; e = e['cause'] as Record<string, unknown> | undefined) {
    if (pred(e)) return true
  }
  return false
}

// ── SQLite (always runs) ────────────────────────────────────
describe('drizzle constraint error shapes — sqlite', () => {
  let adapter: DrizzleAdapter

  before(async () => {
    const client = new Database(':memory:')
    client.pragma('foreign_keys = ON')
    client.exec('CREATE TABLE dz_ce_users (id integer primary key autoincrement, email text not null unique)')
    client.exec('CREATE TABLE dz_ce_posts (id integer primary key autoincrement, user_id integer not null references dz_ce_users(id))')
    const users = sqliteTable('dz_ce_users', {
      id:    integer('id').primaryKey({ autoIncrement: true }),
      email: text('email').notNull(),
    })
    const posts = sqliteTable('dz_ce_posts', {
      id:      integer('id').primaryKey({ autoIncrement: true }),
      user_id: integer('user_id').notNull(),
    })
    const cfg: DrizzleConfig = { client: drizzleSqlite(client), dialect: 'sqlite', tables: { dz_ce_users: users, dz_ce_posts: posts } }
    adapter = await drizzle(cfg).create() as DrizzleAdapter
    ModelRegistry.reset()
    ModelRegistry.set(adapter)
  })

  it('unique violation carries SQLITE_CONSTRAINT_UNIQUE down the cause chain', async () => {
    await adapter.query('dz_ce_users').create({ email: 'a@x.io' })
    await assert.rejects(
      adapter.query('dz_ce_users').create({ email: 'a@x.io' }),
      (err: unknown) => chainHas(err, (e) => e['code'] === 'SQLITE_CONSTRAINT_UNIQUE'),
    )
  })

  it('FK violation carries SQLITE_CONSTRAINT_FOREIGNKEY', async () => {
    await assert.rejects(
      adapter.query('dz_ce_posts').create({ user_id: 99_999 }),
      (err: unknown) => chainHas(err, (e) => e['code'] === 'SQLITE_CONSTRAINT_FOREIGNKEY'),
    )
  })
})

// ── Postgres (live) ─────────────────────────────────────────
test('live pg: drizzle constraint error shapes (23505 / 23503 / 42P01 on the cause chain)', { skip: !PG_URL }, async () => {
  const users = `dz_ce_users_${process.pid}`
  const posts = `dz_ce_posts_${process.pid}`
  const usersTable = pgTable(users, {
    id:    serial('id').primaryKey(),
    email: pgText('email').notNull(),
  })
  const postsTable = pgTable(posts, {
    id:      serial('id').primaryKey(),
    user_id: pgInteger('user_id').notNull(),
  })
  const adapter = await DrizzleAdapter.make({
    driver: 'postgresql',
    url: PG_URL!,
    connectionName: `dz-ce-pg-${process.pid}`,
    tables: { [users]: usersTable, [posts]: postsTable },
  })
  ModelRegistry.reset()
  ModelRegistry.set(adapter)
  try {
    await adapter.affectingStatement(`drop table if exists ${posts}`, [])
    await adapter.affectingStatement(`drop table if exists ${users}`, [])
    await adapter.affectingStatement(`create table ${users} (id serial primary key, email text not null, constraint ${users}_email_uq unique (email))`, [])
    await adapter.affectingStatement(`create table ${posts} (id serial primary key, user_id integer not null references ${users}(id))`, [])

    await adapter.query(users).create({ email: 'a@x.io' })
    await assert.rejects(
      adapter.query(users).create({ email: 'a@x.io' }),
      (err: unknown) => chainHas(err, (e) => e['code'] === '23505' && e['constraint_name'] === `${users}_email_uq`),
    )
    await assert.rejects(
      adapter.query(posts).create({ user_id: 99_999 }),
      (err: unknown) => chainHas(err, (e) => e['code'] === '23503'),
    )
    await assert.rejects(
      adapter.selectRaw(`select * from dz_ce_nope_${process.pid}`, []),
      (err: unknown) => chainHas(err, (e) => e['code'] === '42P01'),
    )
  } finally {
    await adapter.affectingStatement(`drop table if exists ${posts}`, []).catch(() => {})
    await adapter.affectingStatement(`drop table if exists ${users}`, []).catch(() => {})
    await adapter.disconnect()
  }
})

// ── MySQL (live) ────────────────────────────────────────────
test('live mysql: drizzle constraint error shapes (1062 / 1452 / 1146 on the cause chain)', { skip: !MYSQL_URL }, async () => {
  const users = `dz_ce_users_${process.pid}`
  const posts = `dz_ce_posts_${process.pid}`
  const usersTable = mysqlTable(users, {
    id:    mysqlSerial('id').primaryKey(),
    email: mysqlVarchar('email', { length: 191 }).notNull(),
  })
  const postsTable = mysqlTable(posts, {
    id:      mysqlSerial('id').primaryKey(),
    user_id: mysqlInt('user_id').notNull(),
  })
  const adapter = await DrizzleAdapter.make({
    driver: 'mysql',
    url: MYSQL_URL!,
    connectionName: `dz-ce-mysql-${process.pid}`,
    tables: { [users]: usersTable, [posts]: postsTable },
  })
  ModelRegistry.reset()
  ModelRegistry.set(adapter)
  try {
    await adapter.affectingStatement(`drop table if exists ${posts}`, [])
    await adapter.affectingStatement(`drop table if exists ${users}`, [])
    await adapter.affectingStatement(`create table ${users} (id int auto_increment primary key, email varchar(191) not null unique)`, [])
    await adapter.affectingStatement(`create table ${posts} (id int auto_increment primary key, user_id int not null, foreign key (user_id) references ${users}(id))`, [])

    await adapter.query(users).create({ email: 'a@x.io' })
    await assert.rejects(
      adapter.query(users).create({ email: 'a@x.io' }),
      (err: unknown) => chainHas(err, (e) => e['errno'] === 1062 && e['code'] === 'ER_DUP_ENTRY'),
    )
    await assert.rejects(
      adapter.query(posts).create({ user_id: 99_999 }),
      (err: unknown) => chainHas(err, (e) => e['errno'] === 1452),
    )
    await assert.rejects(
      adapter.selectRaw(`select * from dz_ce_nope_${process.pid}`, []),
      (err: unknown) => chainHas(err, (e) => e['errno'] === 1146),
    )
  } finally {
    await adapter.affectingStatement(`drop table if exists ${posts}`, []).catch(() => {})
    await adapter.affectingStatement(`drop table if exists ${users}`, []).catch(() => {})
    await adapter.disconnect()
  }
})
