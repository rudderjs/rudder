// JSON-path predicates on the Drizzle adapter — arrow paths in where()
// (`where('meta->prefs->lang', 'en')`), whereJsonContains /
// whereJsonDoesntContain, and whereJsonLength (+ orWhere* forms). Same surface
// + semantics as the native engine (#871); the per-dialect SQL mirrors the
// native dialect seams (sqlite json_extract/json_each, pg arrow chains + @> /
// jsonb_array_length, mysql JSON_EXTRACT/JSON_CONTAINS/JSON_LENGTH).
//
// The sqlite branch runs end-to-end on real better-sqlite3 (Model layer +
// statics); the pg/mysql SQL shapes are pinned via the proxy drivers (no
// server) — including the two #871 review findings this implementation must
// not regress: the pg containment param binds SINGLE-encoded through a text
// cast (postgres-js re-stringifies a param described as jsonb), and the mysql
// boolean compares against the spliced literal true/false (a bound 'true'
// string coerces to a JSON *string* and never matches). Gated live-pg /
// live-mysql blocks prove both against real servers.

import { describe, it, test, before, after, beforeEach } from 'node:test'
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

const prefs = sqliteTable('prefs', {
  id:   integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  meta: text('meta').notNull(),
})

const posts = sqliteTable('posts', {
  id:     integer('id').primaryKey({ autoIncrement: true }),
  prefId: integer('prefId').notNull(),
  meta:   text('meta').notNull(),
})

class Pref extends Model {
  static override table = 'prefs'
  static override relations = {
    posts: { type: 'hasMany' as const, model: () => Post },
  }
  id!:   number
  name!: string
  meta!: string
}

class Post extends Model {
  static override table = 'posts'
  id!:     number
  prefId!: number
  meta!:   string
}

const names = (rows: Pref[]): string[] => rows.map(r => r.name).sort()

// [name, meta] — same seed as the native json-where suite.
const seed: Array<[string, Record<string, unknown>]> = [
  ['alice', { theme: 'dark',  score: 10, active: true,  'a b': 1, prefs: { lang: 'en' },            tags: ['php', 'js'],         items: ['a', 'b', 'c'] }],
  ['bob',   { theme: 'light', score: 5,  active: false,           prefs: { lang: 'de' },            tags: ['js'],                items: ['x'] }],
  ['carol', { theme: 'dark',  score: 7,  active: true,            prefs: { lang: 'en', tz: 'UTC' }, tags: ['php', 'rust', 'js'], items: [] }],
]

// ─── sqlite end-to-end (Model layer + statics) ─────────────

describe('Drizzle json where (sqlite E2E)', () => {
  beforeEach(async () => {
    const sqlite = new Database(':memory:')
    sqlite.exec(`CREATE TABLE prefs (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, meta TEXT NOT NULL);`)
    sqlite.exec(`CREATE TABLE posts (id INTEGER PRIMARY KEY AUTOINCREMENT, prefId INTEGER NOT NULL, meta TEXT NOT NULL);`)
    const cfg: DrizzleConfig = { client: drizzleSqlite(sqlite), dialect: 'sqlite', tables: { prefs, posts } }
    ModelRegistry.reset()
    ModelRegistry.set(await drizzle(cfg).create())
    for (const [name, meta] of seed) await Pref.create({ name, meta: JSON.stringify(meta) })
  })

  it('where() detects arrow paths (2-arg + 3-arg forms)', async () => {
    assert.deepEqual(names(await Pref.where('meta->theme', 'dark').get()), ['alice', 'carol'])
    assert.deepEqual(names(await Pref.query().where('meta->prefs->lang', '=', 'en').get()), ['alice', 'carol'])
  })

  it('numbers compare with operators; booleans match json true/false', async () => {
    assert.deepEqual(names(await Pref.query().where('meta->score', '>', 6).get()), ['alice', 'carol'])
    assert.deepEqual(names(await Pref.where('meta->active', true).get()), ['alice', 'carol'])
    assert.deepEqual(names(await Pref.where('meta->active', false).get()), ['bob'])
  })

  it('numeric array-index segments address elements; keys with spaces work', async () => {
    assert.deepEqual(names(await Pref.where('meta->items->0', 'a').get()), ['alice'])
    assert.deepEqual(names(await Pref.where('meta->tags->1', 'rust').get()), ['carol'])
    assert.deepEqual(names(await Pref.where('meta->a b', 1).get()), ['alice'])
  })

  it('composes with orWhere, group callbacks, whereNot, and the named sugar', async () => {
    assert.deepEqual(
      names(await Pref.where('name', 'bob').orWhere('meta->score', '>', 8).get()),
      ['alice', 'bob'],
    )
    assert.deepEqual(
      names(await Pref.where('meta->theme', 'dark').whereGroup(g => { g.where('meta->score', '<', 8).orWhere('name', 'alice') }).get()),
      ['alice', 'carol'],
    )
    assert.deepEqual(names(await Pref.whereNot(q => q.where('meta->theme', 'dark')).get()), ['bob'])
    assert.deepEqual(names(await Pref.whereIn('meta->prefs->lang', ['en']).get()), ['alice', 'carol'])
    // Missing key extracts SQL NULL — whereNull/whereNotNull sugar applies.
    assert.deepEqual(names(await Pref.whereNull('meta->prefs->tz').get()), ['alice', 'bob'])
    assert.deepEqual(names(await Pref.whereNotNull('meta->prefs->tz').get()), ['carol'])
  })

  it('arrow paths work inside whereHas constraint callbacks (related table)', async () => {
    const [alice, bob] = [await Pref.where('name', 'alice').first(), await Pref.where('name', 'bob').first()]
    await Post.create({ prefId: alice!.id, meta: JSON.stringify({ kind: 'tech' }) })
    await Post.create({ prefId: bob!.id,   meta: JSON.stringify({ kind: 'life' }) })

    const rows = await Pref.query().whereHas('posts', q => q.where('meta->kind', 'tech')).get()
    assert.deepEqual(names(rows as Pref[]), ['alice'])
  })

  it('whereJsonContains matches scalars and arrays (every element)', async () => {
    assert.deepEqual(names(await Pref.whereJsonContains('meta->tags', 'php').get()), ['alice', 'carol'])
    assert.deepEqual(names(await Pref.whereJsonContains('meta->tags', ['php', 'js']).get()), ['alice', 'carol'])
    assert.deepEqual(names(await Pref.whereJsonContains('meta->tags', ['php', 'rust']).get()), ['carol'])
  })

  it('whereJsonDoesntContain + orWhereJsonContains forms', async () => {
    assert.deepEqual(names(await Pref.whereJsonDoesntContain('meta->tags', 'php').get()), ['bob'])
    assert.deepEqual(
      names(await Pref.where('name', 'bob').orWhereJsonContains('meta->tags', 'rust').get()),
      ['bob', 'carol'],
    )
  })

  it('whereJsonContains throws on object values (no json_each equality form)', () => {
    assert.throws(
      () => Pref.whereJsonContains('meta->tags', { nested: true }),
      /scalar values \(and arrays of scalars\) only/,
    )
  })

  it('whereJsonLength: 2-arg equality, 3-arg operator, orWhere form', async () => {
    assert.deepEqual(names(await Pref.whereJsonLength('meta->items', 0).get()), ['carol'])
    assert.deepEqual(names(await Pref.whereJsonLength('meta->tags', '>', 1).get()), ['alice', 'carol'])
    assert.deepEqual(
      names(await Pref.where('name', 'alice').orWhereJsonLength('meta->items', '=', 1).get()),
      ['alice', 'bob'],
    )
  })

  it('rejects injection attempts in path segments at query-build time', async () => {
    // Arrow-in-where validates lazily at clause render — get() surfaces it.
    await assert.rejects(
      () => Pref.where(`meta->x') OR ('1'='1`, 'v').get(),
      /quote, backslash, backtick, or control character/,
    )
    // The named predicates parse eagerly at call time.
    assert.throws(() => Pref.whereJsonContains('meta->x"]', 'v'), /quote, backslash, backtick, or control character/)
    assert.throws(() => Pref.whereJsonLength('meta->x`', 1), /quote, backslash, backtick, or control character/)
  })

  it('throws a clear error when the base column is not on the schema', async () => {
    await assert.rejects(() => Pref.where('nope->x', 1).get(), /Column "nope" .* not declared/)
  })
})

// ─── pg / mysql SQL-shape pins (proxy drivers, no server) ──

const pgPrefs = pgTable('prefs', {
  id:   serial('id').primaryKey(),
  name: pgText('name').notNull(),
  meta: jsonb('meta').notNull(),
})

const mysqlPrefs = mysqlTable('prefs', {
  id:   mysqlSerial('id').primaryKey(),
  name: mysqlText('name').notNull(),
  meta: mysqlJson('meta').notNull(),
})

describe('Drizzle json where — pg SQL shapes', () => {
  let captured: Array<{ sql: string; params: unknown[] }>

  beforeEach(async () => {
    captured = []
    const db = drizzlePgProxy(async (sqlText: string, params: unknown[]) => {
      captured.push({ sql: sqlText, params }); return { rows: [] }
    })
    ModelRegistry.reset()
    ModelRegistry.set(await drizzle({ client: db, dialect: 'pg', tables: { prefs: pgPrefs } }).create())
  })

  it('text comparison extracts via ->> on the last hop; numbers cast ::numeric; booleans ::boolean', async () => {
    await Pref.where('meta->prefs->lang', 'en').get()
    await Pref.query().where('meta->score', '>', 6).get()
    await Pref.where('meta->active', true).get()
    assert.match(captured[0]!.sql, /"meta"->'prefs'->>'lang' = \$1/)
    assert.deepEqual(captured[0]!.params, ['en'])
    assert.match(captured[1]!.sql, /\("meta"->>'score'\)::numeric > \$1/)
    assert.deepEqual(captured[1]!.params, [6])
    assert.match(captured[2]!.sql, /\("meta"->>'active'\)::boolean = \$1/)
    assert.deepEqual(captured[2]!.params, [true])
  })

  it('numeric index segments splice bare (array index, not object key)', async () => {
    await Pref.where('meta->items->0', 'a').get()
    assert.match(captured[0]!.sql, /"meta"->'items'->>0 = \$1/)
  })

  it('whereJsonContains binds the candidate SINGLE-encoded through a text cast (postgres-js double-encode dodge)', async () => {
    await Pref.whereJsonContains('meta->tags', 'php').get()
    assert.match(captured[0]!.sql, /\("meta"->'tags'\)::jsonb @> cast\(\$1 as text\)::jsonb/)
    // The param is the JSON text ONCE — '"php"', not '"\\"php\\""'.
    assert.deepEqual(captured[0]!.params, ['"php"'])

    await Pref.whereJsonDoesntContain('meta->tags', ['php', 'js']).get()
    assert.match(captured[1]!.sql, /not \(\("meta"->'tags'\)::jsonb @> cast\(\$1 as text\)::jsonb\)/)
    assert.deepEqual(captured[1]!.params, ['["php","js"]'])
  })

  it('whereJsonLength compiles via jsonb_array_length over the cast chain', async () => {
    await Pref.whereJsonLength('meta->tags', '>', 1).get()
    assert.match(captured[0]!.sql, /jsonb_array_length\(\("meta"->'tags'\)::jsonb\) > \$1/)
    assert.deepEqual(captured[0]!.params, [1])
  })
})

describe('Drizzle json where — mysql SQL shapes', () => {
  let captured: Array<{ sql: string; params: unknown[] }>

  beforeEach(async () => {
    captured = []
    const db = drizzleMysqlProxy(async (sqlText: string, params: unknown[]) => {
      captured.push({ sql: sqlText, params }); return { rows: [] }
    })
    ModelRegistry.reset()
    ModelRegistry.set(await drizzle({ client: db, dialect: 'mysql', tables: { prefs: mysqlPrefs } }).create())
  })

  it('text comparison extracts via JSON_UNQUOTE(JSON_EXTRACT(...))', async () => {
    await Pref.where('meta->prefs->lang', 'en').get()
    assert.match(captured[0]!.sql, /JSON_UNQUOTE\(JSON_EXTRACT\(`meta`, '\$\."prefs"\."lang"'\)\) = \?/)
    assert.deepEqual(captured[0]!.params, ['en'])
  })

  it('booleans skip UNQUOTE and splice the SQL literal true/false (NO bound param)', async () => {
    await Pref.where('meta->active', true).get()
    await Pref.where('meta->active', false).get()
    assert.match(captured[0]!.sql, /JSON_EXTRACT\(`meta`, '\$\."active"'\) = true/)
    assert.deepEqual(captured[0]!.params, [])
    assert.match(captured[1]!.sql, /JSON_EXTRACT\(`meta`, '\$\."active"'\) = false/)
  })

  it('whereJsonContains / whereJsonLength compile to JSON_CONTAINS / JSON_LENGTH with the path', async () => {
    await Pref.whereJsonContains('meta->tags', ['php', 'js']).get()
    await Pref.whereJsonLength('meta->tags', '>=', 2).get()
    assert.match(captured[0]!.sql, /JSON_CONTAINS\(`meta`, \?, '\$\."tags"'\)/)
    assert.deepEqual(captured[0]!.params, ['["php","js"]'])
    assert.match(captured[1]!.sql, /JSON_LENGTH\(`meta`, '\$\."tags"'\) >= \?/)
  })
})

// ─── live Postgres (gated) — the real postgres-js bind path ──
//
// The proxy pins the SQL text; this proves the @> candidate survives the REAL
// postgres-js serializer (which re-stringifies params described as jsonb — the
// #871 native-driver bug) thanks to the text-cast bind shape.

const PG_URL = process.env['PG_TEST_URL']

test('live pg: arrow paths + containment + length round-trip through postgres-js', { skip: !PG_URL }, async () => {
  const table = `dz_json_where_${process.pid}`
  const livePrefs = pgTable(table, {
    id:   serial('id').primaryKey(),
    name: pgText('name').notNull(),
    meta: jsonb('meta').notNull(),
  })
  class LivePref extends Model {
    static override table = table
    id!:   number
    name!: string
    meta!: Record<string, unknown>
  }
  const adapter = await DrizzleAdapter.make({
    driver: 'postgresql',
    url: PG_URL!,
    connectionName: `dz-json-pg-${process.pid}`,
    tables: { [table]: livePrefs },
  })
  ModelRegistry.reset()
  ModelRegistry.set(adapter)
  try {
    await adapter.affectingStatement(`drop table if exists ${table}`, [])
    await adapter.affectingStatement(`create table ${table} (id serial primary key, name text not null, meta jsonb not null)`, [])
    // Seed via SQL literals (the #858 convention — no driver serializers in play).
    for (const [name, meta] of seed) {
      const json = JSON.stringify(meta).replace(/'/g, "''")
      await adapter.affectingStatement(`insert into ${table} (name, meta) values ('${name}', '${json}'::jsonb)`, [])
    }

    const liveNames = (rows: LivePref[]): string[] => rows.map(r => r.name).sort()
    assert.deepEqual(liveNames(await LivePref.where('meta->theme', 'dark').get()), ['alice', 'carol'])
    assert.deepEqual(liveNames(await LivePref.query().where('meta->score', '>', 6).get()), ['alice', 'carol'])
    assert.deepEqual(liveNames(await LivePref.where('meta->active', true).get()), ['alice', 'carol'])
    assert.deepEqual(liveNames(await LivePref.whereJsonContains('meta->tags', 'php').get()), ['alice', 'carol'])
    assert.deepEqual(liveNames(await LivePref.whereJsonContains('meta->tags', ['php', 'rust']).get()), ['carol'])
    assert.deepEqual(liveNames(await LivePref.whereJsonDoesntContain('meta->tags', 'php').get()), ['bob'])
    assert.deepEqual(liveNames(await LivePref.whereJsonLength('meta->items', 0).get()), ['carol'])
    assert.deepEqual(liveNames(await LivePref.whereJsonLength('meta->tags', '>', 1).get()), ['alice', 'carol'])
  } finally {
    await adapter.affectingStatement(`drop table if exists ${table}`, []).catch(() => {})
    await adapter.disconnect()
  }
})

// ─── live MySQL (gated) — boolean literal + JSON_CONTAINS live ──

const MYSQL_URL = process.env['MYSQL_TEST_URL']

test('live mysql: arrow paths + containment + length round-trip through mysql2', { skip: !MYSQL_URL }, async () => {
  const table = `dz_json_where_${process.pid}`
  const livePrefs = mysqlTable(table, {
    id:   mysqlSerial('id').primaryKey(),
    name: mysqlText('name').notNull(),
    meta: mysqlJson('meta').notNull(),
  })
  class LivePref extends Model {
    static override table = table
    id!:   number
    name!: string
    meta!: Record<string, unknown>
  }
  const adapter = await DrizzleAdapter.make({
    driver: 'mysql',
    url: MYSQL_URL!,
    connectionName: `dz-json-mysql-${process.pid}`,
    tables: { [table]: livePrefs },
  })
  ModelRegistry.reset()
  ModelRegistry.set(adapter)
  try {
    await adapter.affectingStatement(`drop table if exists ${table}`, [])
    await adapter.affectingStatement(`create table ${table} (id serial primary key, name text not null, meta json not null)`, [])
    for (const [name, meta] of seed) {
      const json = JSON.stringify(meta).replace(/'/g, "''")
      await adapter.affectingStatement(`insert into ${table} (name, meta) values ('${name}', '${json}')`, [])
    }

    const liveNames = (rows: LivePref[]): string[] => rows.map(r => r.name).sort()
    assert.deepEqual(liveNames(await LivePref.where('meta->theme', 'dark').get()), ['alice', 'carol'])
    assert.deepEqual(liveNames(await LivePref.query().where('meta->score', '>', 6).get()), ['alice', 'carol'])
    assert.deepEqual(liveNames(await LivePref.where('meta->active', true).get()), ['alice', 'carol'])
    assert.deepEqual(liveNames(await LivePref.where('meta->active', false).get()), ['bob'])
    assert.deepEqual(liveNames(await LivePref.whereJsonContains('meta->tags', 'php').get()), ['alice', 'carol'])
    assert.deepEqual(liveNames(await LivePref.whereJsonDoesntContain('meta->tags', 'php').get()), ['bob'])
    assert.deepEqual(liveNames(await LivePref.whereJsonLength('meta->items', 0).get()), ['carol'])
    assert.deepEqual(liveNames(await LivePref.whereJsonLength('meta->tags', '>', 1).get()), ['alice', 'carol'])
  } finally {
    await adapter.affectingStatement(`drop table if exists ${table}`, []).catch(() => {})
    await adapter.disconnect()
  }
})
