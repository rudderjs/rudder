// Pure type-generator conformance (GATE 7-types): SQLite column → TS type
// mapping, cast overrides, nullability, and the emitted registry.d.ts shape.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { RawColumn } from './introspect.js'
import {
  sqliteTypeToTs, pgTypeToTs, castToTs, resolveColumnType, buildTableTypes, emitRegistryDts,
} from './types-generator.js'

function col(name: string, type: string, over: Partial<RawColumn> = {}): RawColumn {
  return { name, type, notNull: false, dflt: null, pk: 0, ...over }
}

describe('pgTypeToTs — information_schema data_type mapping', () => {
  const cases: Array<[string, string]> = [
    ['boolean', 'boolean'],
    ['smallint', 'number'], ['integer', 'number'], ['bigint', 'number'],
    ['real', 'number'], ['double precision', 'number'],
    ['numeric', 'string'], ['money', 'string'],   // porsager keeps these as strings
    ['json', 'unknown'], ['jsonb', 'unknown'],
    ['bytea', 'Uint8Array'],
    ['date', 'Date'],
    ['timestamp with time zone', 'Date'], ['timestamp without time zone', 'Date'],
    ['character varying', 'string'], ['character', 'string'], ['text', 'string'],
    ['uuid', 'string'],
    ['time without time zone', 'string'], ['time with time zone', 'string'],
  ]
  for (const [pg, ts] of cases) {
    it(`${pg} → ${ts}`, () => assert.equal(pgTypeToTs(pg), ts))
  }
  it('is case-insensitive', () => assert.equal(pgTypeToTs('JSONB'), 'unknown'))
  it('unknown types fall back to unknown', () => assert.equal(pgTypeToTs('tsvector'), 'unknown'))
})

describe('resolveColumnType — per-dialect mapper', () => {
  it('uses pgTypeToTs when passed (jsonb → unknown, not the SQLite affinity)', () => {
    assert.equal(resolveColumnType(col('meta', 'jsonb', { notNull: true }), {}, pgTypeToTs).ts, 'unknown')
  })
  it('a cast still overrides the pg storage type', () => {
    assert.equal(resolveColumnType(col('meta', 'jsonb', { notNull: true }), { meta: 'json' }, pgTypeToTs).ts, 'unknown')
    assert.equal(resolveColumnType(col('active', 'integer', { notNull: true }), { active: 'boolean' }, pgTypeToTs).ts, 'boolean')
  })
  it('a nullable pg column widens with | null', () => {
    assert.equal(resolveColumnType(col('seen_at', 'timestamp with time zone'), {}, pgTypeToTs).ts, 'Date | null')
  })
  it('defaults to the SQLite mapper when no mapper is passed (back-compat)', () => {
    assert.equal(resolveColumnType(col('n', 'INTEGER', { notNull: true }), {}).ts, 'number')
  })
})

describe('sqliteTypeToTs — affinity mapping', () => {
  it('INT family → number', () => {
    for (const t of ['INTEGER', 'INT', 'BIGINT', 'TINYINT']) assert.equal(sqliteTypeToTs(t), 'number')
  })
  it('text family → string', () => {
    for (const t of ['TEXT', 'VARCHAR(255)', 'CHAR(3)', 'CLOB']) assert.equal(sqliteTypeToTs(t), 'string')
  })
  it('REAL/FLOAT/DOUBLE → number', () => {
    for (const t of ['REAL', 'FLOAT', 'DOUBLE']) assert.equal(sqliteTypeToTs(t), 'number')
  })
  it('BLOB / empty → Uint8Array', () => {
    assert.equal(sqliteTypeToTs('BLOB'), 'Uint8Array')
    assert.equal(sqliteTypeToTs(''), 'Uint8Array')
  })
  it('NUMERIC/DECIMAL → number', () => {
    assert.equal(sqliteTypeToTs('NUMERIC'), 'number')
    assert.equal(sqliteTypeToTs('DECIMAL(8,2)'), 'number')
  })
})

describe('castToTs — cast overrides storage type', () => {
  it('maps the built-in casts', () => {
    assert.equal(castToTs('boolean'), 'boolean')
    assert.equal(castToTs('date'), 'Date')
    assert.equal(castToTs('datetime'), 'Date')
    assert.equal(castToTs('json'), 'unknown')
    assert.equal(castToTs('integer'), 'number')
    assert.equal(castToTs('array'), 'unknown[]')
  })
  it('returns null for unknown casts (storage type wins)', () => {
    assert.equal(castToTs('vector'), null)
    assert.equal(castToTs('SomethingCustom'), null)
  })
})

describe('resolveColumnType — nullability + cast precedence', () => {
  it('NOT NULL column → non-null base type', () => {
    assert.deepEqual(resolveColumnType(col('name', 'TEXT', { notNull: true }), {}), { name: 'name', ts: 'string' })
  })
  it('nullable column → "| null"', () => {
    assert.deepEqual(resolveColumnType(col('bio', 'TEXT'), {}), { name: 'bio', ts: 'string | null' })
  })
  it('primary key stays non-null even though notNull may be 0', () => {
    assert.deepEqual(resolveColumnType(col('id', 'INTEGER', { pk: 1 }), {}), { name: 'id', ts: 'number' })
  })
  it('a boolean cast overrides the INTEGER storage type', () => {
    assert.deepEqual(resolveColumnType(col('active', 'INTEGER', { notNull: true }), { active: 'boolean' }), { name: 'active', ts: 'boolean' })
  })
  it('a date cast on a TEXT column → Date (nullable widens)', () => {
    assert.deepEqual(resolveColumnType(col('createdAt', 'TEXT'), { createdAt: 'date' }), { name: 'createdAt', ts: 'Date | null' })
  })
})

describe('emitRegistryDts — file shape', () => {
  it('emits a declare-module augmentation with sorted tables', () => {
    const users = buildTableTypes('users', [
      col('id', 'INTEGER', { pk: 1, notNull: true }),
      col('email', 'TEXT', { notNull: true }),
      col('active', 'INTEGER', { notNull: true }),
    ], { active: 'boolean' })
    const posts = buildTableTypes('posts', [col('id', 'INTEGER', { pk: 1, notNull: true })])

    // pass posts first to prove it sorts
    const dts = emitRegistryDts([posts, users])

    assert.match(dts, /AUTO-GENERATED by @rudderjs\/orm/)
    assert.match(dts, /declare module '@rudderjs\/orm'/)
    assert.match(dts, /interface SchemaRegistry/)
    // sorted: posts before users
    assert.ok(dts.indexOf('posts:') < dts.indexOf('users:'))
    // column types present, boolean cast applied
    assert.match(dts, /id: number/)
    assert.match(dts, /email: string/)
    assert.match(dts, /active: boolean/)
  })

  it('quotes non-identifier table/column keys', () => {
    const t = buildTableTypes('order-items', [col('full name', 'TEXT', { notNull: true })])
    const dts = emitRegistryDts([t])
    assert.match(dts, /"order-items":/)
    assert.match(dts, /"full name": string/)
  })

  it('an empty schema still emits a valid (empty) augmentation', () => {
    const dts = emitRegistryDts([])
    assert.match(dts, /interface SchemaRegistry/)
    assert.match(dts, /declare module '@rudderjs\/orm'/)
  })
})
