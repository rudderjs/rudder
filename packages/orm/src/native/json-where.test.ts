// JSON-path predicates — arrow paths in where() (`where('meta->prefs->lang',
// 'en')`), whereJsonContains / whereJsonDoesntContain, and whereJsonLength
// (+ orWhere* forms), compiled through the per-dialect `jsonExtract` /
// `jsonContains` / `jsonLength` seams (sqlite json_extract/json_each, pg
// arrow-operator chains + @> / jsonb_array_length, mysql JSON_EXTRACT /
// JSON_CONTAINS / JSON_LENGTH).
//
// Compiler units pin the SQL text + positional binding order per dialect;
// injection tests prove path segments can't escape the SQL quoting; the sqlite
// E2E proves the path end-to-end on a real in-memory engine (incl. contains +
// length round-trips); a gated live-pg block (PG_TEST_URL) exercises the
// Postgres operators live. The adapter-guard test proves the Model-layer proxy
// throws a clear error on an adapter QB without the methods (Drizzle/Prisma
// until their follow-up).

import { describe, it, test, before, after, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import type { OrmAdapter, QueryBuilder, WhereOperator } from '@rudderjs/contracts'
import { compileSelect, type NativeQueryState, type ConditionNode } from '@rudderjs/database/native'
import { SqliteDialect, parseJsonPath, type JsonPathSegment } from '@rudderjs/database/native'
import { PgDialect } from '@rudderjs/database/native'
import { MysqlDialect } from '@rudderjs/database/native'
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

function jsonNode(
  segments: JsonPathSegment[],
  value: unknown,
  operator: WhereOperator = '=',
  boolean: 'AND' | 'OR' = 'AND',
): ConditionNode {
  return { kind: 'json', boolean, column: 'meta', segments, operator, value }
}

function containsNode(segments: JsonPathSegment[], value: unknown, negated = false, boolean: 'AND' | 'OR' = 'AND'): ConditionNode {
  return { kind: 'jsonContains', boolean, column: 'meta', segments, value, negated }
}

function lengthNode(segments: JsonPathSegment[], operator: WhereOperator, value: number, boolean: 'AND' | 'OR' = 'AND'): ConditionNode {
  return { kind: 'jsonLength', boolean, column: 'meta', segments, operator, value }
}

// ── parseJsonPath — segment validation (the injection boundary) ──

describe('parseJsonPath', () => {
  it('splits column and segments; all-digit segments become array indexes', () => {
    assert.deepStrictEqual(parseJsonPath('meta->prefs->lang'), { column: 'meta', segments: ['prefs', 'lang'] })
    assert.deepStrictEqual(parseJsonPath('meta->items->0'), { column: 'meta', segments: ['items', 0] })
  })

  it('allows keys with spaces and dots (quoted in the path literal)', () => {
    assert.deepStrictEqual(parseJsonPath('meta->a b->x.y'), { column: 'meta', segments: ['a b', 'x.y'] })
  })

  it('rejects quotes, backticks, backslashes, and control chars in segments', () => {
    for (const path of [
      `meta->x') OR ('1'='1`,   // single quote — pg `->'x'` escape attempt
      'meta->x"]) --',           // double quote — '$."x"' path-literal escape
      'meta->x`y',               // backtick
      'meta->x\\y',              // backslash
      'meta->x' + String.fromCharCode(1) + 'y', // control char
    ]) {
      assert.throws(() => parseJsonPath(path), /contains a quote, backslash, backtick, or control character/)
    }
  })

  it('rejects empty segments and a missing column', () => {
    assert.throws(() => parseJsonPath('meta->'), /Malformed JSON path/)
    assert.throws(() => parseJsonPath('->x'), /Malformed JSON path/)
    assert.throws(() => parseJsonPath('meta->->x'), /Malformed JSON path/)
  })
})

// ── Compiler units — SQL text + binding order per dialect ──

describe('json where — sqlite compilation', () => {
  it('arrow path compiles via json_extract with a quoted path literal', () => {
    const { sql, bindings } = compileSelect(baseState({ conditions: [jsonNode(['prefs', 'lang'], 'en')] }), sqlite)
    assert.strictEqual(sql, `SELECT * FROM "users" WHERE json_extract("meta", '$."prefs"."lang"') = ?`)
    assert.deepStrictEqual(bindings, ['en'])
  })

  it('numeric index segments render as $[n]', () => {
    const { sql } = compileSelect(baseState({ conditions: [jsonNode(['items', 0], 'a')] }), sqlite)
    assert.strictEqual(sql, `SELECT * FROM "users" WHERE json_extract("meta", '$."items"[0]') = ?`)
  })

  it('booleans bind as 1/0 (json_extract yields integers for json booleans)', () => {
    const { sql, bindings } = compileSelect(baseState({ conditions: [jsonNode(['active'], true)] }), sqlite)
    assert.strictEqual(sql, `SELECT * FROM "users" WHERE json_extract("meta", '$."active"') = ?`)
    assert.deepStrictEqual(bindings, [1])
  })

  it('null routes through IS NULL; IN expands the placeholder list', () => {
    const { sql: nullSql, bindings: nullBinds } = compileSelect(baseState({ conditions: [jsonNode(['gone'], null)] }), sqlite)
    assert.strictEqual(nullSql, `SELECT * FROM "users" WHERE json_extract("meta", '$."gone"') IS NULL`)
    assert.deepStrictEqual(nullBinds, [])

    const { sql: inSql, bindings: inBinds } = compileSelect(baseState({ conditions: [jsonNode(['lang'], ['en', 'de'], 'IN')] }), sqlite)
    assert.strictEqual(inSql, `SELECT * FROM "users" WHERE json_extract("meta", '$."lang"') IN (?, ?)`)
    assert.deepStrictEqual(inBinds, ['en', 'de'])
  })

  it('whereJsonContains emulates via a json_each EXISTS per element', () => {
    const { sql, bindings } = compileSelect(baseState({ conditions: [containsNode(['tags'], 'php')] }), sqlite)
    assert.strictEqual(
      sql,
      `SELECT * FROM "users" WHERE EXISTS (SELECT 1 FROM json_each("meta", '$."tags"') WHERE "json_each"."value" = ?)`,
    )
    assert.deepStrictEqual(bindings, ['php'])

    const multi = compileSelect(baseState({ conditions: [containsNode(['tags'], ['php', 'js'])] }), sqlite)
    assert.strictEqual(
      multi.sql,
      `SELECT * FROM "users" WHERE (EXISTS (SELECT 1 FROM json_each("meta", '$."tags"') WHERE "json_each"."value" = ?) ` +
        `AND EXISTS (SELECT 1 FROM json_each("meta", '$."tags"') WHERE "json_each"."value" = ?))`,
    )
    assert.deepStrictEqual(multi.bindings, ['php', 'js'])
  })

  it('whereJsonDoesntContain wraps in NOT; null elements match on json_each.type', () => {
    const { sql } = compileSelect(baseState({ conditions: [containsNode(['tags'], 'php', true)] }), sqlite)
    assert.strictEqual(
      sql,
      `SELECT * FROM "users" WHERE NOT (EXISTS (SELECT 1 FROM json_each("meta", '$."tags"') WHERE "json_each"."value" = ?))`,
    )

    const nullElem = compileSelect(baseState({ conditions: [containsNode(['tags'], null)] }), sqlite)
    assert.strictEqual(
      nullElem.sql,
      `SELECT * FROM "users" WHERE EXISTS (SELECT 1 FROM json_each("meta", '$."tags"') WHERE "json_each"."type" = 'null')`,
    )
    assert.deepStrictEqual(nullElem.bindings, [])
  })

  it('whereJsonContains throws on object values (no json_each equality form)', () => {
    assert.throws(
      () => compileSelect(baseState({ conditions: [containsNode(['tags'], { nested: true })] }), sqlite),
      /scalar values \(and arrays of scalars\) only/,
    )
  })

  it('whereJsonLength compiles via json_array_length (path + whole-column forms)', () => {
    const { sql, bindings } = compileSelect(baseState({ conditions: [lengthNode(['tags'], '>', 2)] }), sqlite)
    assert.strictEqual(sql, `SELECT * FROM "users" WHERE json_array_length("meta", '$."tags"') > ?`)
    assert.deepStrictEqual(bindings, [2])

    const whole = compileSelect(baseState({ conditions: [lengthNode([], '=', 0)] }), sqlite)
    assert.strictEqual(whole.sql, `SELECT * FROM "users" WHERE json_array_length("meta") = ?`)
  })
})

describe('json where — pg compilation (arrow chains + casts + $n)', () => {
  it('text comparison extracts via ->> on the last hop', () => {
    const { sql, bindings } = compileSelect(baseState({ conditions: [jsonNode(['prefs', 'lang'], 'en')] }), pg)
    assert.strictEqual(sql, `SELECT * FROM "users" WHERE "meta"->'prefs'->>'lang' = $1`)
    assert.deepStrictEqual(bindings, ['en'])

    const single = compileSelect(baseState({ conditions: [jsonNode(['theme'], 'dark')] }), pg)
    assert.strictEqual(single.sql, `SELECT * FROM "users" WHERE "meta"->>'theme' = $1`)
  })

  it('numbers cast ::numeric so operators compare typed values', () => {
    const { sql, bindings } = compileSelect(baseState({ conditions: [jsonNode(['score'], 6, '>')] }), pg)
    assert.strictEqual(sql, `SELECT * FROM "users" WHERE ("meta"->>'score')::numeric > $1`)
    assert.deepStrictEqual(bindings, [6])
  })

  it('booleans cast ::boolean and bind the boolean itself', () => {
    const { sql, bindings } = compileSelect(baseState({ conditions: [jsonNode(['active'], true)] }), pg)
    assert.strictEqual(sql, `SELECT * FROM "users" WHERE ("meta"->>'active')::boolean = $1`)
    assert.deepStrictEqual(bindings, [true])
  })

  it('numeric index segments splice bare (array index, not object key)', () => {
    const { sql } = compileSelect(baseState({ conditions: [jsonNode(['items', 0], 'a')] }), pg)
    assert.strictEqual(sql, `SELECT * FROM "users" WHERE "meta"->'items'->>0 = $1`)
  })

  it('whereJsonContains compiles to a ::jsonb @> with JSON-encoded binding', () => {
    const { sql, bindings } = compileSelect(baseState({ conditions: [containsNode(['tags'], 'php')] }), pg)
    assert.strictEqual(sql, `SELECT * FROM "users" WHERE ("meta"->'tags')::jsonb @> $1::jsonb`)
    assert.deepStrictEqual(bindings, ['"php"'])

    const arr = compileSelect(baseState({ conditions: [containsNode([], ['php', 'js'])] }), pg)
    assert.strictEqual(arr.sql, `SELECT * FROM "users" WHERE ("meta")::jsonb @> $1::jsonb`)
    assert.deepStrictEqual(arr.bindings, ['["php","js"]'])
  })

  it('whereJsonDoesntContain fully parenthesizes the @> under NOT', () => {
    const { sql } = compileSelect(baseState({ conditions: [containsNode(['tags'], 'php', true)] }), pg)
    assert.strictEqual(sql, `SELECT * FROM "users" WHERE NOT (("meta"->'tags')::jsonb @> $1::jsonb)`)
  })

  it('whereJsonLength compiles via jsonb_array_length over the cast chain', () => {
    const { sql, bindings } = compileSelect(baseState({ conditions: [lengthNode(['tags'], '>', 1)] }), pg)
    assert.strictEqual(sql, `SELECT * FROM "users" WHERE jsonb_array_length(("meta"->'tags')::jsonb) > $1`)
    assert.deepStrictEqual(bindings, [1])
  })

  it('keeps the shared positional $n order across mixed clauses', () => {
    const state = baseState({ conditions: [
      { kind: 'clause', boolean: 'AND', clause: { column: 'name', operator: '=', value: 'Ada' } },
      jsonNode(['score'], 6, '>'),
      containsNode(['tags'], 'php', false, 'OR'),
    ] })
    const { sql, bindings } = compileSelect(state, pg)
    assert.strictEqual(
      sql,
      `SELECT * FROM "users" WHERE "name" = $1 AND ("meta"->>'score')::numeric > $2 OR ("meta"->'tags')::jsonb @> $3::jsonb`,
    )
    assert.deepStrictEqual(bindings, ['Ada', 6, '"php"'])
  })
})

describe('json where — mysql compilation (JSON_EXTRACT/CONTAINS/LENGTH)', () => {
  it('text comparison extracts via JSON_UNQUOTE(JSON_EXTRACT(...))', () => {
    const { sql, bindings } = compileSelect(baseState({ conditions: [jsonNode(['prefs', 'lang'], 'en')] }), mysql)
    assert.strictEqual(sql, `SELECT * FROM \`users\` WHERE JSON_UNQUOTE(JSON_EXTRACT(\`meta\`, '$."prefs"."lang"')) = ?`)
    assert.deepStrictEqual(bindings, ['en'])
  })

  it('booleans skip UNQUOTE and splice the SQL literal true/false (a bound string coerces to a JSON *string* and never matches)', () => {
    const { sql, bindings } = compileSelect(baseState({ conditions: [jsonNode(['active'], true)] }), mysql)
    assert.strictEqual(sql, `SELECT * FROM \`users\` WHERE JSON_EXTRACT(\`meta\`, '$."active"') = true`)
    assert.deepStrictEqual(bindings, [])

    const neg = compileSelect(baseState({ conditions: [jsonNode(['active'], false)] }), mysql)
    assert.strictEqual(neg.sql, `SELECT * FROM \`users\` WHERE JSON_EXTRACT(\`meta\`, '$."active"') = false`)
  })

  it('null comparison unifies missing key and explicit json null via JSON_TYPE (Laravel grammar shape)', () => {
    const extract = `JSON_EXTRACT(\`meta\`, '$."nick"')`
    const eq = compileSelect(baseState({ conditions: [jsonNode(['nick'], null)] }), mysql)
    assert.strictEqual(eq.sql, `SELECT * FROM \`users\` WHERE (${extract} IS NULL OR JSON_TYPE(${extract}) = 'NULL')`)
    assert.deepStrictEqual(eq.bindings, [])

    // Negation ANDs the inverses — JSON_TYPE(NULL) is NULL, so the != arm
    // alone would be three-valued and let missing keys through.
    const ne = compileSelect(baseState({ conditions: [jsonNode(['nick'], null, '!=')] }), mysql)
    assert.strictEqual(ne.sql, `SELECT * FROM \`users\` WHERE (${extract} IS NOT NULL AND JSON_TYPE(${extract}) != 'NULL')`)
    assert.deepStrictEqual(ne.bindings, [])
  })

  it('whereJsonContains compiles to JSON_CONTAINS with the path argument', () => {
    const { sql, bindings } = compileSelect(baseState({ conditions: [containsNode(['tags'], ['php', 'js'])] }), mysql)
    assert.strictEqual(sql, `SELECT * FROM \`users\` WHERE JSON_CONTAINS(\`meta\`, ?, '$."tags"')`)
    assert.deepStrictEqual(bindings, ['["php","js"]'])
  })

  it('whereJsonLength compiles via JSON_LENGTH', () => {
    const { sql, bindings } = compileSelect(baseState({ conditions: [lengthNode(['tags'], '>=', 2)] }), mysql)
    assert.strictEqual(sql, `SELECT * FROM \`users\` WHERE JSON_LENGTH(\`meta\`, '$."tags"') >= ?`)
    assert.deepStrictEqual(bindings, [2])
  })
})

// ── sqlite E2E — real engine, Model layer + statics ──

class Pref extends Model {
  static override table = 'prefs'
  id!: number
  name!: string
  meta!: string
}

let driver: Driver

// [name, meta] — meta stored as JSON text (sqlite json_* read TEXT json).
const seed: Array<[string, Record<string, unknown>]> = [
  ['alice', { theme: 'dark',  score: 10, active: true,  'a b': 1, nick: null, prefs: { lang: 'en' },             tags: ['php', 'js'],         items: ['a', 'b', 'c'] }],
  ['bob',   { theme: 'light', score: 5,  active: false,          prefs: { lang: 'de' },             tags: ['js'],                items: ['x'] }],
  ['carol', { theme: 'dark',  score: 7,  active: true,           prefs: { lang: 'en', tz: 'UTC' },  tags: ['php', 'rust', 'js'], items: [] }],
]

describe('json where (native sqlite E2E)', () => {
  beforeEach(async () => {
    driver = await BetterSqlite3Driver.open({ filename: ':memory:' })
    await driver.execute(`CREATE TABLE prefs (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, meta TEXT)`, [])
    ModelRegistry.reset()
    ModelRegistry.set(await NativeAdapter.make({ driverInstance: driver }))
    for (const [name, meta] of seed) await Pref.create({ name, meta: JSON.stringify(meta) })
  })

  afterEach(async () => { await driver.close() })

  const names = (rows: Pref[]): string[] => rows.map(r => r.name).sort()

  it('where() detects arrow paths (2-arg + 3-arg forms)', async () => {
    assert.deepEqual(names(await Pref.where('meta->theme', 'dark').get()), ['alice', 'carol'])
    assert.deepEqual(names(await Pref.query().where('meta->prefs->lang', '=', 'en').get()), ['alice', 'carol'])
  })

  it('numbers compare with operators; booleans match json true/false', async () => {
    assert.deepEqual(names(await Pref.query().where('meta->score', '>', 6).get()), ['alice', 'carol'])
    assert.deepEqual(names(await Pref.where('meta->active', true).get()), ['alice', 'carol'])
    assert.deepEqual(names(await Pref.where('meta->active', false).get()), ['bob'])
  })

  it('numeric array-index segments address elements', async () => {
    assert.deepEqual(names(await Pref.where('meta->items->0', 'a').get()), ['alice'])
    assert.deepEqual(names(await Pref.where('meta->tags->1', 'rust').get()), ['carol'])
  })

  it('keys with spaces work via the quoted path form', async () => {
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
    // Explicit json null (alice's nick) counts as null too — same as a missing key.
    assert.deepEqual(names(await Pref.whereNull('meta->nick').get()), ['alice', 'bob', 'carol'])
    assert.deepEqual(names(await Pref.whereNotNull('meta->nick').get()), [])
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

  it('whereJsonLength: 2-arg equality, 3-arg operator, orWhere form', async () => {
    assert.deepEqual(names(await Pref.whereJsonLength('meta->items', 0).get()), ['carol'])
    assert.deepEqual(names(await Pref.whereJsonLength('meta->tags', '>', 1).get()), ['alice', 'carol'])
    assert.deepEqual(names(await Pref.whereJsonLength('meta->tags', 3).get()), ['carol'])
    assert.deepEqual(
      names(await Pref.where('name', 'alice').orWhereJsonLength('meta->items', '=', 1).get()),
      ['alice', 'bob'],
    )
  })

  it('rejects injection attempts in path segments at call time', () => {
    assert.throws(() => Pref.where(`meta->x') OR ('1'='1`, 'v'), /quote, backslash, backtick, or control character/)
    assert.throws(() => Pref.whereJsonContains('meta->x"]', 'v'), /quote, backslash, backtick, or control character/)
    assert.throws(() => Pref.whereJsonLength('meta->x`', 1), /quote, backslash, backtick, or control character/)
  })
})

// ── Adapter guard — clear error instead of a bare TypeError ──

describe('json where — unsupported-adapter guard', () => {
  it('throws a clear error when the adapter QB lacks the method', () => {
    // A minimal adapter whose QB has none of the JSON predicates (the Drizzle /
    // Prisma shape until their own implementations land).
    const bareQb = {} as QueryBuilder<unknown>
    const adapter = {
      query: () => bareQb,
      connect: async () => {},
      disconnect: async () => {},
    } as unknown as OrmAdapter
    ModelRegistry.reset()
    ModelRegistry.set(adapter)

    class Thing extends Model {
      static override table = 'things'
    }

    assert.throws(
      () => Thing.query().whereJsonContains('meta->tags', 'php'),
      /whereJsonContains\(\) is not supported on this adapter — use whereRaw\(\.\.\.\) or DB\.select\(\.\.\.\)/,
    )
    assert.throws(
      () => Thing.query().orWhereJsonLength('meta->tags', 2),
      /orWhereJsonLength\(\) is not supported on this adapter/,
    )
  })
})

// ── Live Postgres round-trip (arrow operators / @> / jsonb_array_length live) ──

const PG_URL = process.env['PG_TEST_URL']

if (!PG_URL) {
  test('native json where pg round-trip (skipped — set PG_TEST_URL to run)', { skip: true }, () => {})
} else {
  describe('json where (live pg)', () => {
    class PgPref extends Model {
      static override table = 'rudder_json_where_prefs'
      id!: number
      name!: string
      meta!: Record<string, unknown>
    }
    let pgDriver: PostgresDriver

    before(async () => {
      pgDriver = await PostgresDriver.open({ url: PG_URL })
      await pgDriver.execute(`DROP TABLE IF EXISTS rudder_json_where_prefs`, [])
      await pgDriver.execute(`CREATE TABLE rudder_json_where_prefs (id SERIAL PRIMARY KEY, name TEXT, meta JSONB)`, [])
      // Seed via SQL LITERALS, not bound params (#858 — bound strings shift
      // through postgres-js' serializer; same caution applies to jsonb params).
      for (const [name, meta] of seed) {
        const json = JSON.stringify(meta).replace(/'/g, "''")
        await pgDriver.execute(`INSERT INTO rudder_json_where_prefs (name, meta) VALUES ('${name}', '${json}'::jsonb)`, [])
      }
    })
    after(async () => {
      await pgDriver.execute(`DROP TABLE IF EXISTS rudder_json_where_prefs`, [])
      await pgDriver.close()
    })
    beforeEach(async () => {
      ModelRegistry.reset()
      ModelRegistry.set(await NativeAdapter.make({ driverInstance: pgDriver, dialect: new PgDialect() }))
    })

    const names = (rows: PgPref[]): string[] => rows.map(r => r.name).sort()

    it('arrow paths run live: text, ::numeric, and ::boolean comparisons', async () => {
      assert.deepStrictEqual(names(await PgPref.where('meta->theme', 'dark').get()), ['alice', 'carol'])
      assert.deepStrictEqual(names(await PgPref.query().where('meta->prefs->lang', '=', 'en').get()), ['alice', 'carol'])
      assert.deepStrictEqual(names(await PgPref.query().where('meta->score', '>', 6).get()), ['alice', 'carol'])
      assert.deepStrictEqual(names(await PgPref.where('meta->active', true).get()), ['alice', 'carol'])
      assert.deepStrictEqual(names(await PgPref.where('meta->items->0', 'a').get()), ['alice'])
    })

    it('whereJsonContains / whereJsonDoesntContain run live through @>', async () => {
      assert.deepStrictEqual(names(await PgPref.whereJsonContains('meta->tags', 'php').get()), ['alice', 'carol'])
      assert.deepStrictEqual(names(await PgPref.whereJsonContains('meta->tags', ['php', 'rust']).get()), ['carol'])
      assert.deepStrictEqual(names(await PgPref.whereJsonDoesntContain('meta->tags', 'php').get()), ['bob'])
    })

    it('whereJsonLength runs live through jsonb_array_length', async () => {
      assert.deepStrictEqual(names(await PgPref.whereJsonLength('meta->items', 0).get()), ['carol'])
      assert.deepStrictEqual(names(await PgPref.whereJsonLength('meta->tags', '>', 1).get()), ['alice', 'carol'])
    })

    it('whereNull/whereNotNull unify explicit json null and missing key', async () => {
      // alice carries nick: null (explicit), bob/carol have no nick key.
      assert.deepStrictEqual(names(await PgPref.whereNull('meta->nick').get()), ['alice', 'bob', 'carol'])
      assert.deepStrictEqual(names(await PgPref.whereNotNull('meta->nick').get()), [])
      assert.deepStrictEqual(names(await PgPref.whereNull('meta->prefs->tz').get()), ['alice', 'bob'])
      assert.deepStrictEqual(names(await PgPref.whereNotNull('meta->prefs->tz').get()), ['carol'])
    })
  })
}

// ── Live MySQL round-trip (JSON_EXTRACT / JSON_CONTAINS / JSON_LENGTH live) ──
//
// Notably pins the boolean shape live: `JSON_EXTRACT(…) = true` (spliced
// literal) matches json booleans — a BOUND 'true' string coerces to a JSON
// *string* in comparison context and matches nothing.

const MYSQL_URL = process.env['MYSQL_TEST_URL']

if (!MYSQL_URL) {
  test('native json where mysql round-trip (skipped — set MYSQL_TEST_URL to run)', { skip: true }, () => {})
} else {
  describe('json where (live mysql)', () => {
    class MyPref extends Model {
      static override table = 'rudder_json_where_prefs'
      id!: number
      name!: string
      meta!: Record<string, unknown>
    }
    let myDriver: MysqlDriver

    before(async () => {
      myDriver = await MysqlDriver.open({ url: MYSQL_URL })
      await myDriver.execute(`DROP TABLE IF EXISTS rudder_json_where_prefs`, [])
      await myDriver.execute(`CREATE TABLE rudder_json_where_prefs (id INT AUTO_INCREMENT PRIMARY KEY, name TEXT, meta JSON)`, [])
      // Seed via SQL LITERALS (same convention as the pg block above).
      for (const [name, meta] of seed) {
        const json = JSON.stringify(meta).replace(/'/g, "''")
        await myDriver.execute(`INSERT INTO rudder_json_where_prefs (name, meta) VALUES ('${name}', '${json}')`, [])
      }
    })
    after(async () => {
      await myDriver.execute(`DROP TABLE IF EXISTS rudder_json_where_prefs`, [])
      await myDriver.close()
    })
    beforeEach(async () => {
      ModelRegistry.reset()
      ModelRegistry.set(await NativeAdapter.make({ driverInstance: myDriver, dialect: new MysqlDialect() }))
    })

    const names = (rows: MyPref[]): string[] => rows.map(r => r.name).sort()

    it('arrow paths run live: text, numeric coercion, and boolean literals', async () => {
      assert.deepStrictEqual(names(await MyPref.where('meta->theme', 'dark').get()), ['alice', 'carol'])
      assert.deepStrictEqual(names(await MyPref.query().where('meta->prefs->lang', '=', 'en').get()), ['alice', 'carol'])
      assert.deepStrictEqual(names(await MyPref.query().where('meta->score', '>', 6).get()), ['alice', 'carol'])
      assert.deepStrictEqual(names(await MyPref.where('meta->active', true).get()), ['alice', 'carol'])
      assert.deepStrictEqual(names(await MyPref.where('meta->active', false).get()), ['bob'])
      assert.deepStrictEqual(names(await MyPref.where('meta->items->0', 'a').get()), ['alice'])
    })

    it('whereJsonContains / whereJsonDoesntContain run live through JSON_CONTAINS', async () => {
      assert.deepStrictEqual(names(await MyPref.whereJsonContains('meta->tags', 'php').get()), ['alice', 'carol'])
      assert.deepStrictEqual(names(await MyPref.whereJsonContains('meta->tags', ['php', 'rust']).get()), ['carol'])
      assert.deepStrictEqual(names(await MyPref.whereJsonDoesntContain('meta->tags', 'php').get()), ['bob'])
    })

    it('whereJsonLength runs live through JSON_LENGTH', async () => {
      assert.deepStrictEqual(names(await MyPref.whereJsonLength('meta->items', 0).get()), ['carol'])
      assert.deepStrictEqual(names(await MyPref.whereJsonLength('meta->tags', '>', 1).get()), ['alice', 'carol'])
    })

    it('whereNull/whereNotNull unify explicit json null and missing key (JSON_TYPE shape)', async () => {
      // alice carries nick: null (explicit json null — JSON_EXTRACT returns a
      // JSON null LITERAL, not SQL NULL); bob/carol have no nick key (SQL
      // NULL). A plain IS NULL matched bob/carol only before the JSON_TYPE fix.
      assert.deepStrictEqual(names(await MyPref.whereNull('meta->nick').get()), ['alice', 'bob', 'carol'])
      assert.deepStrictEqual(names(await MyPref.whereNotNull('meta->nick').get()), [])
      assert.deepStrictEqual(names(await MyPref.whereNull('meta->prefs->tz').get()), ['alice', 'bob'])
      assert.deepStrictEqual(names(await MyPref.whereNotNull('meta->prefs->tz').get()), ['carol'])
    })
  })
}
