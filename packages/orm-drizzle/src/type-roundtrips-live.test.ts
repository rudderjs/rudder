// Type round-trips on the Drizzle adapter — LIVE Postgres (audit P2-13).
//
// The drizzle adapter's value handling for the lossy types — DECIMAL
// precision, BIGINT range, timestamp instants (the bound-timestamp TZ
// ground), and jsonb documents (the postgres-js double-encode trap, #874) —
// had compile/proxy coverage only. One write→read pass through the Model
// layer against a real Postgres pins each: a double-encoded jsonb write
// would read back as a STRING; a TZ-shifted timestamp write would move the
// instant; numeric must come back as the exact fixed-precision string.
//
// Gated on PG_TEST_URL (CI's orm-pg job).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pgTable, serial, numeric, bigint, timestamp, jsonb } from 'drizzle-orm/pg-core'
import { Model, ModelRegistry } from '@rudderjs/orm'
import { DrizzleAdapter } from './index.js'

const PG_URL = process.env['PG_TEST_URL']

const TABLE = 'dz_types_rows'

test('drizzle type round-trips — live pg', { skip: !PG_URL }, async () => {
  const rows = pgTable(TABLE, {
    id:     serial('id').primaryKey(),
    amount: numeric('amount', { precision: 14, scale: 2 }),
    big:    bigint('big', { mode: 'number' }),
    seenAt: timestamp('seenAt', { withTimezone: true, mode: 'date' }),
    meta:   jsonb('meta'),
  })
  class TypeRow extends Model {
    static override table = TABLE
    id!: number
    amount!: string
    big!: number
    seenAt!: Date
    meta!: Record<string, unknown>
  }

  const adapter = await DrizzleAdapter.make({
    driver: 'postgresql',
    url: PG_URL!,
    connectionName: `dz-types-pg-${process.pid}`,
    tables: { [TABLE]: rows },
  })
  ModelRegistry.reset()
  ModelRegistry.set(adapter)

  try {
    await adapter.affectingStatement(`drop table if exists ${TABLE}`, [])
    await adapter.affectingStatement(
      `create table ${TABLE} (id serial primary key, amount numeric(14,2), big bigint, "seenAt" timestamptz, meta jsonb)`,
      [],
    )

    // DECIMAL — exact fixed-precision string, no float drift.
    const dec = await TypeRow.create({ amount: '1234567890.12' })
    const freshDec = await TypeRow.findOrFail(dec.id)
    assert.strictEqual(freshDec.amount, '1234567890.12')

    // BIGINT — top of the JS safe-integer range round-trips as a number.
    const value = 9007199254740991
    const big = await TypeRow.create({ big: value })
    const freshBig = await TypeRow.findOrFail(big.id)
    assert.strictEqual(freshBig.big, value)

    // TIMESTAMPTZ — a Date write reads back as the same instant.
    const instant = new Date('2026-06-05T10:20:30.123Z')
    const ts = await TypeRow.create({ seenAt: instant })
    const freshTs = await TypeRow.findOrFail(ts.id)
    assert.ok(freshTs.seenAt instanceof Date)
    assert.strictEqual(freshTs.seenAt.getTime(), instant.getTime())

    // JSONB — parsed object back, NOT a re-stringified string (double-encode
    // regression: postgres-js re-stringifies params it describes as jsonb).
    const meta = { tags: ['a', 'b'], depth: { n: 2, ok: true }, note: 'naïve “quotes”' }
    const js = await TypeRow.create({ meta })
    const freshJs = await TypeRow.findOrFail(js.id)
    assert.strictEqual(typeof freshJs.meta, 'object')
    assert.deepStrictEqual(freshJs.meta, meta)
  } finally {
    await adapter.affectingStatement(`drop table if exists ${TABLE}`, []).catch(() => {})
    await adapter.disconnect()
  }
})
