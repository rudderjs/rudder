// insertUsing through the Model layer — the proxy must pass the TERMINAL's
// Promise through (the FORWARDED_QB_METHODS handler re-wraps chainables to the
// proxy but not Promise results), plus the Model static, a gated live-mysql
// round-trip (the no-RETURNING affectedRows count path), and the
// unsupported-adapter guard.

import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import type { OrmAdapter, QueryBuilder } from '@rudderjs/contracts'
import { Model, ModelRegistry } from '../index.js'
import { NativeAdapter, BetterSqlite3Driver } from '@rudderjs/database/native'
import type { Driver } from '@rudderjs/database/native'

class Order extends Model {
  static override table = 'orders'
  id!:    number
  name!:  string
  total!: number
}

class Archive extends Model {
  static override table = 'archive'
  id!:     number
  name!:   string
  amount!: number
}

let driver: Driver

describe('insertUsing (Model layer, native sqlite)', () => {
  before(async () => {
    driver = await BetterSqlite3Driver.open({ filename: ':memory:' })
    await driver.execute('CREATE TABLE orders (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, total INTEGER)', [])
    await driver.execute('CREATE TABLE archive (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, amount INTEGER)', [])
    ModelRegistry.reset()
    ModelRegistry.set(await NativeAdapter.make({ driverInstance: driver }))
    for (const [name, total] of [['a', 120], ['b', 40], ['c', 300]] as const) {
      await Order.create({ name, total })
    }
  })
  after(async () => { await driver.close() })

  it('Model static copies subquery rows and resolves the inserted count', async () => {
    const inserted = await Archive.insertUsing(
      ['name', 'amount'],
      Order.query().select('name', 'total').where('total', '>', 100),
    )
    assert.strictEqual(inserted, 2)
    const rows = await Archive.query().orderBy('amount', 'ASC').get()
    assert.deepEqual(rows.map(r => [r.name, r.amount]), [['a', 120], ['c', 300]])
    assert.ok(rows[0] instanceof Archive)
  })

  it('query-chain form returns a real Promise (not the proxy) — raw body', async () => {
    const out = Archive.query().insertUsing(['name', 'amount'], 'SELECT name, total FROM orders WHERE total > ?', [1000])
    assert.ok(out instanceof Promise)
    assert.strictEqual(await out, 0)
  })
})

// ── Live MySQL — the no-RETURNING count path reads driver affectedRows ──

const MYSQL_URL = process.env['MYSQL_TEST_URL']

if (!MYSQL_URL) {
  it('insertUsing mysql round-trip (skipped — set MYSQL_TEST_URL to run)', { skip: true }, () => {})
} else {
  describe('insertUsing (live mysql)', () => {
    class MyOrder extends Model {
      static override table = 'rudder_iu_orders'
      id!:    number
      name!:  string
      total!: number
    }
    class MyArchive extends Model {
      static override table = 'rudder_iu_archive'
      id!:     number
      name!:   string
      amount!: number
    }
    let myDriver: import('@rudderjs/database/native').MysqlDriver

    before(async () => {
      const { MysqlDriver, MysqlDialect, NativeAdapter: NA } = await import('@rudderjs/database/native')
      myDriver = await MysqlDriver.open({ url: MYSQL_URL })
      await myDriver.execute('DROP TABLE IF EXISTS rudder_iu_orders', [])
      await myDriver.execute('DROP TABLE IF EXISTS rudder_iu_archive', [])
      await myDriver.execute('CREATE TABLE rudder_iu_orders (id INT AUTO_INCREMENT PRIMARY KEY, name TEXT, total INT)', [])
      await myDriver.execute('CREATE TABLE rudder_iu_archive (id INT AUTO_INCREMENT PRIMARY KEY, name TEXT, amount INT)', [])
      for (const [name, total] of [['a', 120], ['b', 40], ['c', 300]] as const) {
        await myDriver.execute('INSERT INTO rudder_iu_orders (name, total) VALUES (?, ?)', [name, total])
      }
      ModelRegistry.reset()
      ModelRegistry.set(await NA.make({ driverInstance: myDriver, dialect: new MysqlDialect() }))
    })
    after(async () => {
      await myDriver.execute('DROP TABLE IF EXISTS rudder_iu_orders', [])
      await myDriver.execute('DROP TABLE IF EXISTS rudder_iu_archive', [])
      await myDriver.close()
    })

    it('counts inserted rows via affectedRows (no RETURNING on mysql)', async () => {
      const inserted = await MyArchive.insertUsing(
        ['name', 'amount'],
        MyOrder.query().select('name', 'total').where('total', '>', 100),
      )
      assert.strictEqual(inserted, 2)
      const rows = await MyArchive.query().orderBy('amount', 'ASC').get()
      assert.deepStrictEqual(rows.map(r => [r.name, r.amount]), [['a', 120], ['c', 300]])
    })
  })
}

// ── Live Postgres — the RETURNING count path on INSERT…SELECT (audit P2-10: was mysql-only) ──

const PG_URL = process.env['PG_TEST_URL']

if (!PG_URL) {
  it('insertUsing pg round-trip (skipped — set PG_TEST_URL to run)', { skip: true }, () => {})
} else {
  describe('insertUsing (live pg)', () => {
    class PgOrder extends Model {
      static override table = 'rudder_iu_orders'
      id!:    number
      name!:  string
      total!: number
    }
    class PgArchive extends Model {
      static override table = 'rudder_iu_archive'
      id!:     number
      name!:   string
      amount!: number
    }
    let pgDriver: import('@rudderjs/database/native').PostgresDriver

    before(async () => {
      const { PostgresDriver, PgDialect, NativeAdapter: NA } = await import('@rudderjs/database/native')
      pgDriver = await PostgresDriver.open({ url: PG_URL })
      await pgDriver.execute('DROP TABLE IF EXISTS rudder_iu_orders', [])
      await pgDriver.execute('DROP TABLE IF EXISTS rudder_iu_archive', [])
      await pgDriver.execute('CREATE TABLE rudder_iu_orders (id SERIAL PRIMARY KEY, name TEXT, total INT)', [])
      await pgDriver.execute('CREATE TABLE rudder_iu_archive (id SERIAL PRIMARY KEY, name TEXT, amount INT)', [])
      for (const [name, total] of [['a', 120], ['b', 40], ['c', 300]] as const) {
        await pgDriver.execute('INSERT INTO rudder_iu_orders (name, total) VALUES ($1, $2)', [name, total])
      }
      ModelRegistry.reset()
      ModelRegistry.set(await NA.make({ driverInstance: pgDriver, dialect: new PgDialect() }))
    })
    after(async () => {
      await pgDriver.execute('DROP TABLE IF EXISTS rudder_iu_orders', [])
      await pgDriver.execute('DROP TABLE IF EXISTS rudder_iu_archive', [])
      await pgDriver.close()
    })

    it('counts inserted rows via RETURNING (builder body, $n rebind)', async () => {
      const inserted = await PgArchive.insertUsing(
        ['name', 'amount'],
        PgOrder.query().select('name', 'total').where('total', '>', 100),
      )
      assert.strictEqual(inserted, 2)
      const rows = await PgArchive.query().orderBy('amount', 'ASC').get()
      assert.deepStrictEqual(rows.map(r => [r.name, r.amount]), [['a', 120], ['c', 300]])
    })

    it('raw-SQL body with ? placeholders rebinds to $n', async () => {
      await pgDriver.execute('DELETE FROM rudder_iu_archive', [])
      const inserted = await PgArchive.insertUsing(
        ['name', 'amount'],
        'SELECT name, total FROM rudder_iu_orders WHERE total > ?',
        [100],
      )
      assert.strictEqual(inserted, 2)
    })
  })
}

describe('insertUsing — unsupported-adapter guard', () => {
  it('throws the forward-or-throw error when the adapter QB lacks the method', () => {
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
      () => Thing.query().insertUsing(['a'], 'SELECT 1'),
      /insertUsing\(\) is not supported on this adapter/,
    )
  })
})
