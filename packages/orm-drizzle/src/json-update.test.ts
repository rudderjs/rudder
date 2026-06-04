// JSON arrow-path keys in update() payloads on the Drizzle adapter.
//
// `Model.update(id, { 'meta->prefs->lang': 'en' })` writes ONE path inside a
// JSON column — the Drizzle mirror of the native engine's `Dialect.jsonSet`
// (#879). Values bind as JSON text re-typed in SQL per dialect (sqlite
// `json(?)`, mysql `CAST(? AS JSON)`, pg `cast(? as text)::jsonb` — the text
// cast sidesteps the postgres-js jsonb-param re-stringify double-encode the
// same way the #874 containment binding does). SQL shapes are pinned with the
// no-server pg-proxy / mysql-proxy drivers; sqlite runs the real round-trip;
// gated live blocks prove pg + mysql end-to-end.

import { describe, it, test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { drizzle as drizzleSqlite } from 'drizzle-orm/better-sqlite3'
import { drizzle as drizzlePgProxy } from 'drizzle-orm/pg-proxy'
import { drizzle as drizzleMysqlProxy } from 'drizzle-orm/mysql-proxy'
import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core'
import { pgTable, serial, text as pgText, jsonb } from 'drizzle-orm/pg-core'
import { mysqlTable, serial as mysqlSerial, text as mysqlText, json as mysqlJson } from 'drizzle-orm/mysql-core'
import { Model, ModelRegistry } from '@rudderjs/orm'
import { DrizzleAdapter, drizzle, type DrizzleConfig } from './index.js'

// ─── SQLite — real round-trip ───────────────────────────────────────────────

const prefs = sqliteTable('prefs', {
  id:   integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  meta: text('meta').notNull(), // JSON stored as TEXT — sqlite json_set works on it
})

class Pref extends Model {
  static override table = 'prefs'
  id!: number
  name!: string
  meta!: string
}

function makeSqliteAdapter() {
  const sqlite = new Database(':memory:')
  sqlite.exec(`CREATE TABLE prefs (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, meta TEXT NOT NULL)`)
  const cfg: DrizzleConfig = { client: drizzleSqlite(sqlite), dialect: 'sqlite', tables: { prefs } }
  return drizzle(cfg).create()
}

const meta = (p: Pref | null): Record<string, unknown> => JSON.parse(p!.meta) as Record<string, unknown>

describe('Drizzle JSON update — sqlite round-trip', () => {
  beforeEach(async () => {
    ModelRegistry.reset()
    ModelRegistry.set(await makeSqliteAdapter())
    await Pref.create({ name: 'ada', meta: JSON.stringify({ theme: 'dark', prefs: { lang: 'de' }, score: 1 }) })
  })

  it('writes one path and preserves sibling keys', async () => {
    const ada = (await Pref.where('name', 'ada').first())!
    await Pref.query().update(ada.id, { 'meta->prefs->lang': 'en' } as Partial<Pref>)
    const after = meta(await Pref.find(ada.id))
    assert.deepEqual(after['prefs'], { lang: 'en' })
    assert.equal(after['theme'], 'dark') // sibling untouched
  })

  it('value types round-trip: number, boolean, null, object, array', async () => {
    const ada = (await Pref.where('name', 'ada').first())!
    await Pref.query().update(ada.id, {
      'meta->score':  10,
      'meta->active': true,
      'meta->note':   null,
      'meta->obj':    { a: 1 },
      'meta->list':   [1, 'two'],
    } as Partial<Pref>)
    const after = meta(await Pref.find(ada.id))
    assert.equal(after['score'], 10)
    assert.equal(after['active'], true)
    assert.equal(after['note'], null)
    assert.deepEqual(after['obj'], { a: 1 })
    assert.deepEqual(after['list'], [1, 'two'])
  })

  it('mixed plain + arrow payload updates both', async () => {
    const ada = (await Pref.where('name', 'ada').first())!
    await Pref.query().update(ada.id, { name: 'lovelace', 'meta->theme': 'light' } as Partial<Pref>)
    const after = (await Pref.find(ada.id))!
    assert.equal(after.name, 'lovelace')
    assert.equal(meta(after)['theme'], 'light')
  })

  it('where().updateAll() with an arrow key updates matching rows', async () => {
    await Pref.create({ name: 'bob', meta: JSON.stringify({ theme: 'dark' }) })
    const n = await Pref.query().where('meta->theme', 'dark').updateAll({ 'meta->theme': 'auto' } as Partial<Pref>)
    assert.equal(n, 2)
    assert.equal(await Pref.query().where('meta->theme', 'auto').count(), 2)
  })

  it('whole-column + arrow conflict rejects (both orders)', async () => {
    const ada = (await Pref.where('name', 'ada').first())!
    await assert.rejects(
      Pref.query().update(ada.id, { meta: '{}', 'meta->theme': 'x' } as Partial<Pref>),
      /writes both the whole column/,
    )
    await assert.rejects(
      Pref.query().update(ada.id, { 'meta->theme': 'x', meta: '{}' } as Partial<Pref>),
      /writes both the whole column/,
    )
  })

  it('injection attempt in an update key rejects before any SQL runs', async () => {
    const ada = (await Pref.where('name', 'ada').first())!
    await assert.rejects(
      Pref.query().update(ada.id, { [`meta->x'); DROP TABLE prefs; --`]: 1 } as Partial<Pref>),
      /quote, backslash, backtick, or control character/,
    )
  })

  it('unknown base column throws a clear error', async () => {
    const ada = (await Pref.where('name', 'ada').first())!
    await assert.rejects(
      Pref.query().update(ada.id, { 'nope->x': 1 } as Partial<Pref>),
      /Unknown column "nope"/,
    )
  })

  it('the adapter QB advertises the capability marker', async () => {
    const qb = ModelRegistry.getAdapter().query('prefs') as unknown as { supportsJsonPathUpdates?: boolean }
    assert.equal(qb.supportsJsonPathUpdates, true)
  })
})

// ─── pg / mysql — SQL shapes pinned via the proxy drivers (no server) ───────

describe('Drizzle JSON update — pg SQL shape', () => {
  it('nests jsonb_set with a text-cast param and ARRAY path', async () => {
    const captured: Array<{ sql: string; params: unknown[] }> = []
    const pgPrefs = pgTable('prefs', { id: serial('id').primaryKey(), name: pgText('name'), meta: jsonb('meta') })
    const db = drizzlePgProxy(async (sql: string, params: unknown[], method: string) => {
      captured.push({ sql, params })
      return { rows: method === 'all' ? [] : [] }
    })
    const adapter = await drizzle({ client: db, dialect: 'pg', tables: { prefs: pgPrefs } } as DrizzleConfig).create()
    await adapter.query('prefs').updateAll({ 'meta->prefs->lang': 'en', 'meta->score': 10 } as Record<string, unknown>)

    const upd = captured[0]!
    assert.match(upd.sql, /jsonb_set\(jsonb_set\(\("prefs"\."meta"\)::jsonb, ARRAY\['prefs', 'lang'\], cast\(\$1 as text\)::jsonb\), ARRAY\['score'\], cast\(\$2 as text\)::jsonb\)/)
    assert.deepEqual(upd.params, ['"en"', '10']) // JSON text, bound — never interpolated
  })
})

describe('Drizzle JSON update — mysql SQL shape', () => {
  it('emits JSON_SET varargs with CAST(? AS JSON) values', async () => {
    const captured: Array<{ sql: string; params: unknown[] }> = []
    const myPrefs = mysqlTable('prefs', { id: mysqlSerial('id').primaryKey(), name: mysqlText('name'), meta: mysqlJson('meta') })
    const db = drizzleMysqlProxy(async (sql: string, params: unknown[]) => {
      captured.push({ sql, params })
      return { rows: [{ affectedRows: 1 }, null] }
    })
    const adapter = await drizzle({ client: db, dialect: 'mysql', tables: { prefs: myPrefs } } as DrizzleConfig).create()
    await adapter.query('prefs').updateAll({ 'meta->prefs->lang': 'en', 'meta->active': true } as Record<string, unknown>)

    const upd = captured[0]!
    assert.match(upd.sql, /JSON_SET\(`prefs`\.`meta`, '\$\."prefs"\."lang"', CAST\(\? AS JSON\), '\$\."active"', CAST\(\? AS JSON\)\)/)
    assert.deepEqual(upd.params, ['"en"', 'true'])
  })
})

// ─── Live blocks (gated) ────────────────────────────────────────────────────

const PG_URL = process.env['PG_TEST_URL']

test('live pg: jsonb_set writes one path, preserving siblings', { skip: !PG_URL }, async () => {
  const table = `dz_json_upd_${process.pid}`
  const livePrefs = pgTable(table, { id: serial('id').primaryKey(), name: pgText('name').notNull(), meta: jsonb('meta').notNull() })
  class LivePref extends Model {
    static override table = table
    id!: number
    name!: string
    meta!: Record<string, unknown>
  }
  const adapter = await DrizzleAdapter.make({
    driver: 'postgresql', url: PG_URL!, connectionName: `dz-json-upd-pg-${process.pid}`, tables: { [table]: livePrefs },
  })
  ModelRegistry.reset()
  ModelRegistry.set(adapter)
  try {
    await adapter.affectingStatement(`drop table if exists ${table}`, [])
    await adapter.affectingStatement(`create table ${table} (id serial primary key, name text not null, meta jsonb not null)`, [])
    await adapter.affectingStatement(`insert into ${table} (name, meta) values ('ada', '{"theme":"dark","prefs":{"lang":"de"}}')`, [])

    const ada = (await LivePref.where('name', 'ada').first())!
    await LivePref.query().update(ada.id, { 'meta->prefs->lang': 'en', 'meta->score': 10 } as Partial<LivePref>)
    const after = (await LivePref.find(ada.id))!.meta
    assert.deepEqual(after['prefs'], { lang: 'en' })
    assert.equal(after['theme'], 'dark')
    assert.equal(after['score'], 10)
    // typed value composes with the JSON read path
    assert.equal((await LivePref.query().where('meta->score', '>', 5).count()), 1)
  } finally {
    await adapter.affectingStatement(`drop table if exists ${table}`, []).catch(() => {})
    await adapter.disconnect()
  }
})

const MYSQL_URL = process.env['MYSQL_TEST_URL']

test('live mysql: JSON_SET writes one path, preserving siblings', { skip: !MYSQL_URL }, async () => {
  const table = `dz_json_upd_${process.pid}`
  const livePrefs = mysqlTable(table, { id: mysqlSerial('id').primaryKey(), name: mysqlText('name').notNull(), meta: mysqlJson('meta').notNull() })
  class LivePref extends Model {
    static override table = table
    id!: number
    name!: string
    meta!: Record<string, unknown>
  }
  const adapter = await DrizzleAdapter.make({
    driver: 'mysql', url: MYSQL_URL!, connectionName: `dz-json-upd-mysql-${process.pid}`, tables: { [table]: livePrefs },
  })
  ModelRegistry.reset()
  ModelRegistry.set(adapter)
  try {
    await adapter.affectingStatement(`drop table if exists ${table}`, [])
    await adapter.affectingStatement(`create table ${table} (id serial primary key, name text not null, meta json not null)`, [])
    await adapter.affectingStatement(`insert into ${table} (name, meta) values ('ada', '{"theme":"dark","prefs":{"lang":"de"}}')`, [])

    const ada = (await LivePref.where('name', 'ada').first())!
    // update() rides the mysql re-select path (no RETURNING) — the returned
    // instance carries the post-write row.
    const updated = await LivePref.query().update(ada.id, { 'meta->prefs->lang': 'en', 'meta->active': true } as Partial<LivePref>)
    const after = typeof updated.meta === 'string' ? JSON.parse(updated.meta as unknown as string) : updated.meta
    assert.deepEqual(after['prefs'], { lang: 'en' })
    assert.equal(after['theme'], 'dark')
    assert.equal(after['active'], true) // real JSON boolean, not the string "true"
    assert.equal((await LivePref.query().where('meta->active', true).count()), 1)
  } finally {
    await adapter.affectingStatement(`drop table if exists ${table}`, []).catch(() => {})
    await adapter.disconnect()
  }
})
