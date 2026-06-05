// Type round-trips beyond bool/int/string — audit P2-13.
//
// `drivers/postgres.test.ts` / `drivers/mysql.test.ts` prove booleans
// (incl. TINY(1)), ints, and strings; the column types apps actually lose
// data on — DECIMAL precision, BIGINT range, timestamp instants, JSON
// documents — only had compile/typename coverage. One shared write→read
// scenario through the Model layer (so `decimal:N` / `date` / `json` casts
// fold in) on sqlite (always) + live Postgres + MySQL.
//
// Gated on PG_TEST_URL / MYSQL_TEST_URL (CI's orm-pg / orm-mysql jobs).

import { describe, it, test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { Model, ModelRegistry } from '../index.js'
import {
  NativeAdapter, BetterSqlite3Driver, PostgresDriver, MysqlDriver,
  PgDialect, MysqlDialect, SchemaBuilder, SqliteDialect,
} from '@rudderjs/database/native'
import type { Dialect, Driver } from '@rudderjs/database/native'

const PG_URL = process.env['PG_TEST_URL']
const MYSQL_URL = process.env['MYSQL_TEST_URL']

const TABLE = 'rudder_types_rows'

class TypeRow extends Model {
  static override table = TABLE
  static override casts = {
    amount: 'decimal:2',
    meta:   'json',
  } as const
  id!: number
  amount!: string
  big!: number
  seenAt!: Date | string
  meta!: Record<string, unknown>
}

// Read-side casts apply at serialization (`toJSON()`), not hydration — the
// instance fields hold the raw column values. Assert on the cast-applied view.
function castView(row: TypeRow): Record<string, unknown> {
  return row.toJSON() as Record<string, unknown>
}

/** A filler `seenAt` value bindable in the block's date mode. */
function seed(dateMode: 'native' | 'iso'): Date | string {
  return dateMode === 'native' ? new Date('2026-01-01T00:00:00.000Z') : '2026-01-01T00:00:00.000Z'
}

// `seenAt` deliberately carries NO cast: the point is the DRIVER's own
// timestamp symmetry (mysql2/porsager bind a JS Date natively and parse the
// column back to a Date — the #860 TZ ground). better-sqlite3 rejects raw
// Dates, so the sqlite block writes the ISO string the `datetime` cast would
// produce and reads the TEXT back.
function defineScenario(dateMode: 'native' | 'iso'): void {
  it('decimal:N — fixed-precision string round-trip, no float drift', async () => {
    const created = await TypeRow.create({ amount: 9.5 as never, big: 1, seenAt: seed(dateMode), meta: {} })
    const fresh = await TypeRow.findOrFail(created.id)
    assert.strictEqual(castView(fresh)['amount'], '9.50')

    // A value float math would mangle: 13 significant digits.
    const big = await TypeRow.create({ amount: '1234567890.12' as never, big: 1, seenAt: seed(dateMode), meta: {} })
    const freshBig = await TypeRow.findOrFail(big.id)
    assert.strictEqual(castView(freshBig)['amount'], '1234567890.12')
  })

  it('bigint — values beyond int32 range round-trip exactly', async () => {
    // 2^53 - 1: the top of JS's safe-integer range, far past int32.
    const value = 9007199254740991
    const created = await TypeRow.create({ amount: 0 as never, big: value, seenAt: seed(dateMode), meta: {} })
    const fresh = await TypeRow.findOrFail(created.id)
    assert.strictEqual(typeof fresh.big, 'number')
    assert.strictEqual(fresh.big, value)
  })

  it('timestamp — a Date instant survives write→read (UTC symmetric)', async () => {
    // Whole-second instant: mysql TIMESTAMP has second precision by default.
    const instant = new Date('2026-06-05T10:20:30.000Z')
    const written = dateMode === 'native' ? instant : instant.toISOString()
    const created = await TypeRow.create({ amount: 0 as never, big: 1, seenAt: written, meta: {} })
    const fresh = await TypeRow.findOrFail(created.id)
    const raw = fresh.seenAt as unknown
    const roundTripped = raw instanceof Date ? raw : new Date(String(raw))
    assert.strictEqual(roundTripped.getTime(), instant.getTime())
  })

  it('json — a document round-trips as a parsed object', async () => {
    const meta = { tags: ['a', 'b'], depth: { n: 2, ok: true }, note: 'naïve “quotes”' }
    const created = await TypeRow.create({ amount: 0 as never, big: 1, seenAt: seed(dateMode), meta })
    const fresh = await TypeRow.findOrFail(created.id)
    const out = castView(fresh)['meta']
    // Double-encode regression guard: a re-stringified write would read back
    // as a STRING here, not a parsed object.
    assert.deepStrictEqual(out, meta)
    assert.strictEqual(typeof out, 'object')
  })
}

async function createTable(driver: Driver, dialect: Dialect): Promise<void> {
  const schema = new SchemaBuilder(driver, dialect)
  await schema.dropIfExists(TABLE)
  await schema.create(TABLE, (t) => {
    t.id()
    t.decimal('amount', 14, 2)
    t.bigInteger('big')
    t.timestamp('seenAt')
    t.json('meta')
  })
}

// ─── SQLite (always runs) ────────────────────────────────────────────────────

describe('type round-trips — native sqlite', () => {
  let driver: Driver

  before(async () => {
    driver = await BetterSqlite3Driver.open({ filename: ':memory:' })
    await createTable(driver, new SqliteDialect())
  })

  beforeEach(async () => {
    ModelRegistry.reset()
    ModelRegistry.set(await NativeAdapter.make({ driverInstance: driver }))
    await driver.execute(`DELETE FROM ${TABLE}`, [])
  })

  defineScenario('iso')
})

// ─── Postgres (live) ─────────────────────────────────────────────────────────

if (!PG_URL) {
  test('type round-trips pg live tests (skipped — set PG_TEST_URL to run)', { skip: true }, () => {})
} else {
  describe('type round-trips — Postgres (live)', () => {
    let driver: PostgresDriver

    before(async () => {
      driver = await PostgresDriver.open({ url: PG_URL })
      await createTable(driver, new PgDialect())
    })

    after(async () => {
      await driver.execute(`DROP TABLE IF EXISTS ${TABLE}`, []).catch(() => {})
      await driver.close()
    })

    beforeEach(async () => {
      ModelRegistry.reset()
      ModelRegistry.set(await NativeAdapter.make({ driverInstance: driver, dialect: new PgDialect() }))
      await driver.execute(`DELETE FROM ${TABLE}`, [])
    })

    defineScenario('native')
  })
}

// ─── MySQL (live) ────────────────────────────────────────────────────────────

if (!MYSQL_URL) {
  test('type round-trips mysql live tests (skipped — set MYSQL_TEST_URL to run)', { skip: true }, () => {})
} else {
  describe('type round-trips — MySQL (live)', () => {
    let driver: MysqlDriver

    before(async () => {
      driver = await MysqlDriver.open({ url: MYSQL_URL })
      await createTable(driver, new MysqlDialect())
    })

    after(async () => {
      await driver.execute(`DROP TABLE IF EXISTS ${TABLE}`, []).catch(() => {})
      await driver.close()
    })

    beforeEach(async () => {
      ModelRegistry.reset()
      ModelRegistry.set(await NativeAdapter.make({ driverInstance: driver, dialect: new MysqlDialect() }))
      await driver.execute(`DELETE FROM ${TABLE}`, [])
    })

    defineScenario('native')
  })
}
