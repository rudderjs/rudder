// Boolean-binding coverage for the native engine.
//
// better-sqlite3 binds only numbers, strings, bigints, buffers, and null — a
// raw JS `boolean` throws `TypeError: SQLite3 can only bind …`. The
// better-sqlite3 driver maps `true`/`false` to `1`/`0` (SQLite has no boolean
// type) so raw boolean values that bypass a column cast still bind. These tests
// exercise the three ways a raw boolean reaches the driver:
//   1. an untyped `where('flag', true)` predicate (where values never cast),
//   2. a `query().create({ flag: true })` bypass on an un-cast column,
//   3. the lower-level `Driver.execute(...)` call directly.
// A model whose column IS cast to `boolean` already serializes true→1 in the
// cast layer; the round-trip test below confirms both paths land on the same
// stored integer.
//
// The same driver-level normalization also maps `Date` → ISO-8601 UTC text
// (better-sqlite3 can't bind a Date): the ORM's timestamp/soft-delete stamping
// binds `Date` objects and relies on each driver to serialize them in its own
// wire format (a raw ISO string would be rejected by MySQL strict mode).
//
// A fresh in-memory DB per test keeps inserts from leaking between cases.

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { Model, ModelRegistry } from '../index.js'
import { NativeAdapter } from '@rudderjs/database/native'
import { BetterSqlite3Driver } from '@rudderjs/database/native'
import type { Driver } from '@rudderjs/database/native'

// Untyped: no `casts` entry for `flag`, so booleans reach the driver raw.
class Flag extends Model {
  static override table = 'flags'
  id!: number
  label!: string
  flag!: number
}

// Typed: `active` is cast to boolean — the cast layer serializes true→1 before
// the value ever reaches the driver, and re-hydrates 1→true on `toJSON()`.
class Account extends Model {
  static override table = 'accounts'
  static override casts = { active: 'boolean' } as const
  id!: number
  active!: boolean
}

let driver: Driver

beforeEach(async () => {
  driver = await BetterSqlite3Driver.open({ filename: ':memory:' })
  await driver.execute(`CREATE TABLE flags (id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT, flag INTEGER)`, [])
  await driver.execute(`CREATE TABLE accounts (id INTEGER PRIMARY KEY AUTOINCREMENT, active INTEGER)`, [])
  await driver.execute(`INSERT INTO flags (id, label, flag) VALUES (?, ?, ?)`, [1, 'on', 1])
  await driver.execute(`INSERT INTO flags (id, label, flag) VALUES (?, ?, ?)`, [2, 'off', 0])
  ModelRegistry.reset()
  ModelRegistry.set(await NativeAdapter.make({ driverInstance: driver }))
})

afterEach(async () => { await driver.close() })

describe('native boolean binding — Driver.execute', () => {
  it('binds a true/false WHERE value (maps to 1/0) instead of throwing', async () => {
    const onRows  = await driver.execute(`SELECT id FROM flags WHERE flag = ?`, [true])
    const offRows = await driver.execute(`SELECT id FROM flags WHERE flag = ?`, [false])
    assert.deepStrictEqual(onRows.map(r => r['id']),  [1])
    assert.deepStrictEqual(offRows.map(r => r['id']), [2])
  })

  it('binds a boolean on an INSERT (stored as 1)', async () => {
    await driver.execute(`INSERT INTO flags (label, flag) VALUES (?, ?)`, ['inserted', true])
    const rows = await driver.execute(`SELECT flag FROM flags WHERE label = ?`, ['inserted'])
    assert.strictEqual(rows[0]?.['flag'], 1)
  })

  it('leaves a non-boolean binding untouched (null, number, string)', async () => {
    const rows = await driver.execute(`SELECT ? AS a, ? AS b, ? AS c`, [null, 7, 'x'])
    assert.deepStrictEqual({ ...rows[0] }, { a: null, b: 7, c: 'x' })
  })
})

describe('native boolean binding — Model API (untyped column)', () => {
  it('where("flag", true) filters without throwing', async () => {
    const on = await Flag.query().where('flag', true).get()
    assert.deepStrictEqual(on.map(f => f.id), [1])
  })

  it('where("flag", false) filters without throwing', async () => {
    const off = await Flag.query().where('flag', false).get()
    assert.deepStrictEqual(off.map(f => f.id), [2])
  })

  it('query().create({ flag: true }) persists 1', async () => {
    const created = await Flag.query().create({ label: 'created', flag: true as unknown as number })
    const back = await Flag.find(created.id)
    assert.strictEqual(back?.flag, 1)
  })
})

describe('native Date binding — Driver.execute', () => {
  it('binds a Date on an INSERT (stored as ISO-8601 UTC text)', async () => {
    const stamp = new Date('2026-06-07T12:34:56.789Z')
    await driver.execute(`INSERT INTO flags (label, flag) VALUES (?, ?)`, [stamp, 1])
    const rows = await driver.execute(`SELECT label FROM flags WHERE flag = ? AND id > ?`, [1, 2])
    assert.strictEqual(rows[0]?.['label'], '2026-06-07T12:34:56.789Z')
  })

  it('binds a Date in a WHERE predicate (matches the stored ISO text)', async () => {
    const stamp = new Date('2020-01-02T03:04:05.000Z')
    await driver.execute(`INSERT INTO flags (label, flag) VALUES (?, ?)`, ['2020-01-02T03:04:05.000Z', 0])
    const rows = await driver.execute(`SELECT id FROM flags WHERE label = ?`, [stamp])
    assert.strictEqual(rows.length, 1)
  })
})

describe('native boolean binding — typed boolean cast', () => {
  it('create({ active: true }) stores 1 and re-hydrates true on toJSON()', async () => {
    const acc = await Account.create({ active: true })
    const back = await Account.find(acc.id)
    // The cast serialized true→1 on write, so the raw stored value is the
    // integer 1 — it never reached the driver as a JS boolean.
    assert.strictEqual(back?.active as unknown, 1)
    // The boolean cast re-hydrates 1→true on serialization.
    assert.strictEqual((back?.toJSON() as { active: boolean }).active, true)
  })
})
