// JSON arrow-path UPDATE payloads (native) — `Model.update(id,
// { 'meta->prefs->lang': 'en' })` compiles through the per-dialect
// `Dialect.jsonSet` seam (sqlite json_set + json(?), mysql JSON_SET +
// CAST(? AS JSON), pg nested jsonb_set + ::jsonb), mirroring how jsonExtract
// carries the read side.
//
// Compiler units pin the SQL text + positional binding order per dialect
// (SET values before WHERE values; multi-write merge into ONE assignment per
// column — SQL forbids assigning a column twice); the byte-identical gate
// pins the plain-payload text against the pre-seam output; injection tests
// prove path segments can't escape; the sqlite E2E proves the write
// round-trips (sibling keys preserved); the adapter-guard test proves the
// Model-layer proxy throws a clear error on adapter QBs without the
// `supportsJsonPathUpdates` marker (Drizzle/Prisma until their follow-up);
// gated live-pg / live-mysql blocks run the seam live (mysql also covers the
// no-RETURNING re-select path).

import { describe, it, test, before, after, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import type { OrmAdapter, QueryBuilder } from '@rudderjs/contracts'
import { compileUpdate, type NativeQueryState } from '@rudderjs/database/native'
import { SqliteDialect } from '@rudderjs/database/native'
import { PgDialect } from '@rudderjs/database/native'
import { MysqlDialect } from '@rudderjs/database/native'
import { NativeOrmError } from '@rudderjs/database/native'
import { Model, ModelRegistry } from '../index.js'
import { NativeAdapter } from './adapter.js'
import { BetterSqlite3Driver } from '@rudderjs/database/native'
import { PostgresDriver } from '@rudderjs/database/native'
import { MysqlDriver } from '@rudderjs/database/native'
import type { Driver } from '@rudderjs/database/native'

const sqlite = new SqliteDialect()
const pg     = new PgDialect()
const mysql  = new MysqlDialect()

function baseState(overrides: Partial<NativeQueryState> = {}): NativeQueryState {
  return {
    table:           'users',
    primaryKey:      'id',
    conditions:      [],
    orders:          [],
    limitN:          null,
    offsetN:         null,
    softDelete:      'with',
    deletedAtColumn: 'deletedAt',
    ...overrides,
  }
}

// ── Compiler units — SQL text + binding order per dialect ──

describe('compileUpdate — arrow-path keys', () => {
  it('sqlite: one arrow key → json_set with json(?)-typed value', () => {
    const { sql, bindings } = compileUpdate(baseState(), sqlite, { 'meta->prefs->lang': 'en' })
    assert.strictEqual(sql, 'UPDATE "users" SET "meta" = json_set("meta", \'$."prefs"."lang"\', json(?))')
    assert.deepStrictEqual(bindings, ['"en"'])
  })

  it('sqlite: multiple writes on one column merge into ONE assignment', () => {
    const { sql, bindings } = compileUpdate(baseState(), sqlite, { 'meta->a': 1, 'meta->b': true })
    assert.strictEqual(sql,
      'UPDATE "users" SET "meta" = json_set("meta", \'$."a"\', json(?), \'$."b"\', json(?))')
    assert.deepStrictEqual(bindings, ['1', 'true'])
  })

  it('sqlite: plain + arrow keys interleave in first-seen order', () => {
    const { sql, bindings } = compileUpdate(baseState(), sqlite, {
      name: 'Ada',
      'meta->lang': 'en',
      age: 36,
    })
    assert.strictEqual(sql,
      'UPDATE "users" SET "name" = ?, "meta" = json_set("meta", \'$."lang"\', json(?)), "age" = ?')
    assert.deepStrictEqual(bindings, ['Ada', '"en"', 36])
  })

  it('sqlite: SET values bind before WHERE values (positional order)', () => {
    const state = baseState({
      conditions: [{ kind: 'clause', boolean: 'AND', clause: { column: 'name', operator: '=', value: 'Ada' } }],
    })
    const { sql, bindings } = compileUpdate(state, sqlite, { 'meta->lang': 'en' })
    assert.strictEqual(sql,
      'UPDATE "users" SET "meta" = json_set("meta", \'$."lang"\', json(?)) WHERE "name" = ?')
    assert.deepStrictEqual(bindings, ['"en"', 'Ada'])
  })

  it('sqlite: object/array/null values JSON-encode through the same shape', () => {
    const { bindings } = compileUpdate(baseState(), sqlite, {
      'meta->prefs': { theme: 'dark' },
      'meta->tags':  ['a', 'b'],
      'meta->gone':  null,
    })
    assert.deepStrictEqual(bindings, ['{"theme":"dark"}', '["a","b"]', 'null'])
  })

  it('sqlite: numeric segments render as array indexes', () => {
    const { sql } = compileUpdate(baseState(), sqlite, { 'meta->items->0': 'x' })
    assert.strictEqual(sql, 'UPDATE "users" SET "meta" = json_set("meta", \'$."items"[0]\', json(?))')
  })

  it('pg: jsonb_set with ARRAY path and ::jsonb-typed value', () => {
    const { sql, bindings } = compileUpdate(baseState(), pg, { 'meta->prefs->lang': 'en' })
    assert.strictEqual(sql,
      'UPDATE "users" SET "meta" = jsonb_set(("meta")::jsonb, ARRAY[\'prefs\', \'lang\'], $1::jsonb)')
    assert.deepStrictEqual(bindings, ['"en"'])
  })

  it('pg: multiple writes nest jsonb_set; numeric segments become text path elements', () => {
    const { sql, bindings } = compileUpdate(baseState(), pg, { 'meta->a': 1, 'meta->items->0': 'x' })
    assert.strictEqual(sql,
      'UPDATE "users" SET "meta" = jsonb_set(jsonb_set(("meta")::jsonb, ARRAY[\'a\'], $1::jsonb), ' +
      'ARRAY[\'items\', \'0\'], $2::jsonb)')
    assert.deepStrictEqual(bindings, ['1', '"x"'])
  })

  it('mysql: JSON_SET with CAST(? AS JSON)-typed value', () => {
    const { sql, bindings } = compileUpdate(baseState(), mysql, { 'meta->prefs->lang': 'en', 'meta->active': true })
    assert.strictEqual(sql,
      'UPDATE `users` SET `meta` = JSON_SET(`meta`, \'$."prefs"."lang"\', CAST(? AS JSON), ' +
      '\'$."active"\', CAST(? AS JSON))')
    assert.deepStrictEqual(bindings, ['"en"', 'true'])
  })

  it('plain payloads compile byte-identical to the pre-seam output (regression gate)', () => {
    const state = baseState({
      conditions: [{ kind: 'clause', boolean: 'AND', clause: { column: 'id', operator: '=', value: 7 } }],
    })
    const { sql, bindings } = compileUpdate(state, sqlite, { name: 'Ada', age: 36 }, { returning: true })
    assert.strictEqual(sql, 'UPDATE "users" SET "name" = ?, "age" = ? WHERE "id" = ? RETURNING *')
    assert.deepStrictEqual(bindings, ['Ada', 36, 7])
  })

  it('throws on a whole-column + arrow-path conflict (both orders)', () => {
    for (const data of [
      { meta: { fresh: true }, 'meta->lang': 'en' },
      { 'meta->lang': 'en', meta: { fresh: true } },
    ]) {
      assert.throws(
        () => compileUpdate(baseState(), sqlite, data),
        (e: unknown) => e instanceof NativeOrmError && e.code === 'NATIVE_JSON_SET_CONFLICT',
      )
    }
  })

  it('rejects injection attempts in path segments', () => {
    for (const key of [
      `meta->x') OR ('1'='1`,
      'meta->x"]) --',
      'meta->x`y',
      'meta->a\\b',
    ]) {
      assert.throws(
        () => compileUpdate(baseState(), sqlite, { [key]: 1 }),
        NativeOrmError,
      )
    }
  })
})

// ── End-to-end on real sqlite ──

class Pref extends Model {
  static override table = 'prefs'
  id!: number
  name!: string
  meta!: Record<string, unknown> | string | null
}

let driver: Driver

const metaOf = async (id: number): Promise<Record<string, unknown>> => {
  const row = await Pref.find(id)
  return JSON.parse(String((row as Pref).meta)) as Record<string, unknown>
}

describe('JSON arrow-path update (native, sqlite E2E)', () => {
  beforeEach(async () => {
    driver = await BetterSqlite3Driver.open({ filename: ':memory:' })
    await driver.execute(`CREATE TABLE prefs (id INTEGER PRIMARY KEY, name TEXT, meta TEXT)`, [])
    ModelRegistry.reset()
    ModelRegistry.set(await NativeAdapter.make({ driverInstance: driver }))
    await driver.execute(
      `INSERT INTO prefs (id, name, meta) VALUES (1, 'alice', ?)`,
      [JSON.stringify({ prefs: { lang: 'fr', theme: 'dark' }, score: 5 })],
    )
    await driver.execute(
      `INSERT INTO prefs (id, name, meta) VALUES (2, 'bob', ?)`,
      [JSON.stringify({ prefs: { lang: 'fr' } })],
    )
  })

  afterEach(async () => { await driver.close() })

  it('Model.update writes one path and preserves sibling keys', async () => {
    await Pref.update(1, { 'meta->prefs->lang': 'en' })
    const meta = await metaOf(1)
    assert.deepStrictEqual(meta, { prefs: { lang: 'en', theme: 'dark' }, score: 5 })
  })

  it('value types round-trip: number, boolean, null, object, array', async () => {
    await Pref.update(1, {
      'meta->score':  10,
      'meta->active': true,
      'meta->gone':   null,
      'meta->extra':  { a: 1 },
      'meta->tags':   ['x', 'y'],
    })
    const meta = await metaOf(1)
    assert.strictEqual(meta['score'], 10)
    assert.strictEqual(meta['active'], true)
    assert.strictEqual(meta['gone'], null)
    assert.deepStrictEqual(meta['extra'], { a: 1 })
    assert.deepStrictEqual(meta['tags'], ['x', 'y'])
  })

  it('mixed plain + arrow payload updates both', async () => {
    await Pref.update(1, { name: 'alicia', 'meta->prefs->lang': 'en' })
    const row = await Pref.find(1) as Pref
    assert.strictEqual(row.name, 'alicia')
    assert.deepStrictEqual((await metaOf(1))['prefs'], { lang: 'en', theme: 'dark' })
  })

  it('where().updateAll() with an arrow key updates matching rows', async () => {
    const n = await Pref.where('name', 'bob').updateAll({ 'meta->prefs->lang': 'de' })
    assert.strictEqual(n, 1)
    assert.deepStrictEqual((await metaOf(2))['prefs'], { lang: 'de' })
    assert.deepStrictEqual((await metaOf(1))['prefs'], { lang: 'fr', theme: 'dark' })
  })

  it('arrow writes compose with the JSON read path', async () => {
    await Pref.update(1, { 'meta->prefs->lang': 'en' })
    const rows = await Pref.where('meta->prefs->lang', 'en').get()
    assert.deepStrictEqual(rows.map(r => r.name), ['alice'])
  })

  it('whole-column + arrow conflict rejects', async () => {
    await assert.rejects(
      Pref.update(1, { meta: { fresh: true }, 'meta->lang': 'en' }),
      (e: unknown) => e instanceof NativeOrmError && e.code === 'NATIVE_JSON_SET_CONFLICT',
    )
  })

  it('injection attempt in an update key rejects before any SQL runs', async () => {
    await assert.rejects(
      Pref.update(1, { [`meta->x') OR ('1'='1`]: 1 }),
      NativeOrmError,
    )
  })

  it('fillable: the arrow key itself must be listed (Laravel parity)', async () => {
    class Locked extends Model {
      static override table = 'prefs'
      static override fillable = ['name', 'meta->prefs->lang']
      id!: number
      name!: string
      meta!: string
    }
    // listed arrow key writes; unlisted arrow key is dropped
    await Locked.update(1, { 'meta->prefs->lang': 'en' })
    assert.deepStrictEqual((await metaOf(1))['prefs'], { lang: 'en', theme: 'dark' })
    await Locked.update(1, { name: 'alicia', 'meta->score': 99 } as Record<string, unknown>)
    assert.strictEqual((await metaOf(1))['score'], 5)
  })
})

// ── Unsupported-adapter guard (Model layer) ──

describe('json update — unsupported-adapter guard', () => {
  it('throws a clear error when the adapter QB lacks the marker', async () => {
    // A minimal adapter QB without `supportsJsonPathUpdates` (the Drizzle /
    // Prisma shape until their own implementations land).
    const bareQb = {
      update:    async () => ({}),
      updateAll: async () => 0,
    } as unknown as QueryBuilder<unknown>
    const adapter = {
      query: () => bareQb,
      connect: async () => {},
      disconnect: async () => {},
    } as unknown as OrmAdapter
    ModelRegistry.reset()
    ModelRegistry.set(adapter)

    class Thing extends Model {
      static override table = 'things'
      name!: string
    }

    await assert.rejects(
      Thing.update(1, { 'meta->lang': 'en' }),
      /JSON-path update key "meta->lang" is not supported on this adapter/,
    )
    await assert.rejects(
      Thing.query().updateAll({ 'meta->lang': 'en' }),
      /JSON-path update key "meta->lang" is not supported on this adapter/,
    )
    // plain payloads pass straight through
    await Thing.query().updateAll({ name: 'x' })
  })
})

// ── Live Postgres round-trip ──

const PG_URL = process.env['PG_TEST_URL']

if (!PG_URL) {
  test('native json update pg round-trip (skipped — set PG_TEST_URL to run)', { skip: true }, () => {})
} else {
  describe('json update (live pg)', () => {
    class PgPref extends Model {
      static override table = 'rudder_json_update_prefs'
      id!: number
      name!: string
      meta!: Record<string, unknown>
    }
    let pgDriver: PostgresDriver

    before(async () => {
      pgDriver = await PostgresDriver.open({ url: PG_URL })
      await pgDriver.execute(`DROP TABLE IF EXISTS rudder_json_update_prefs`, [])
      await pgDriver.execute(`CREATE TABLE rudder_json_update_prefs (id SERIAL PRIMARY KEY, name TEXT, meta JSONB)`, [])
    })
    after(async () => {
      await pgDriver.execute(`DROP TABLE IF EXISTS rudder_json_update_prefs`, [])
      await pgDriver.close()
    })
    beforeEach(async () => {
      // Seed via SQL LITERALS, not bound params (#858 serializer caution).
      await pgDriver.execute(`DELETE FROM rudder_json_update_prefs`, [])
      await pgDriver.execute(
        `INSERT INTO rudder_json_update_prefs (id, name, meta) VALUES ` +
        `(1, 'alice', '{"prefs":{"lang":"fr","theme":"dark"},"score":5}'::jsonb)`, [])
      ModelRegistry.reset()
      ModelRegistry.set(await NativeAdapter.make({ driverInstance: pgDriver, dialect: new PgDialect() }))
    })

    it('jsonb_set writes one path live, preserving siblings', async () => {
      await PgPref.update(1, { 'meta->prefs->lang': 'en' })
      const row = await PgPref.find(1) as PgPref
      assert.deepStrictEqual(row.meta, { prefs: { lang: 'en', theme: 'dark' }, score: 5 })
    })

    it('typed values write live: number, boolean, object', async () => {
      await PgPref.update(1, { 'meta->score': 10, 'meta->active': true, 'meta->extra': { a: 1 } })
      const row = await PgPref.find(1) as PgPref
      assert.strictEqual((row.meta as Record<string, unknown>)['score'], 10)
      assert.strictEqual((row.meta as Record<string, unknown>)['active'], true)
      assert.deepStrictEqual((row.meta as Record<string, unknown>)['extra'], { a: 1 })
    })
  })
}

// ── Live MySQL round-trip (also covers the no-RETURNING re-select path) ──

const MYSQL_URL = process.env['MYSQL_TEST_URL']

if (!MYSQL_URL) {
  test('native json update mysql round-trip (skipped — set MYSQL_TEST_URL to run)', { skip: true }, () => {})
} else {
  describe('json update (live mysql)', () => {
    class MyPref extends Model {
      static override table = 'rudder_json_update_prefs'
      id!: number
      name!: string
      meta!: Record<string, unknown>
    }
    let myDriver: MysqlDriver

    before(async () => {
      myDriver = await MysqlDriver.open({ url: MYSQL_URL })
      await myDriver.execute(`DROP TABLE IF EXISTS rudder_json_update_prefs`, [])
      await myDriver.execute(`CREATE TABLE rudder_json_update_prefs (id INT PRIMARY KEY, name TEXT, meta JSON)`, [])
    })
    after(async () => {
      await myDriver.execute(`DROP TABLE IF EXISTS rudder_json_update_prefs`, [])
      await myDriver.close()
    })
    beforeEach(async () => {
      // Seed via SQL LITERALS (same convention as the pg block above).
      await myDriver.execute(`DELETE FROM rudder_json_update_prefs`, [])
      await myDriver.execute(
        `INSERT INTO rudder_json_update_prefs (id, name, meta) VALUES ` +
        `(1, 'alice', '{"prefs":{"lang":"fr","theme":"dark"},"score":5}')`, [])
      ModelRegistry.reset()
      ModelRegistry.set(await NativeAdapter.make({ driverInstance: myDriver, dialect: new MysqlDialect() }))
    })

    it('JSON_SET writes one path live, preserving siblings (re-select path)', async () => {
      const row = await MyPref.update(1, { 'meta->prefs->lang': 'en' })
      assert.deepStrictEqual(row.meta, { prefs: { lang: 'en', theme: 'dark' }, score: 5 })
    })

    it('typed values write live: number, boolean, object', async () => {
      await MyPref.update(1, { 'meta->score': 10, 'meta->active': true, 'meta->extra': { a: 1 } })
      const row = await MyPref.find(1) as MyPref
      assert.strictEqual((row.meta as Record<string, unknown>)['score'], 10)
      assert.strictEqual((row.meta as Record<string, unknown>)['active'], true)
      assert.deepStrictEqual((row.meta as Record<string, unknown>)['extra'], { a: 1 })
    })
  })
}
