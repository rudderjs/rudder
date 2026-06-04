// Transaction conformance for the native engine (Phase 4).
//
// Boots a REAL better-sqlite3 in-memory database, registers `NativeAdapter`, and
// drives `transaction()` / `Model.transaction()` against it — commit, rollback,
// cross-model scoping, nested SAVEPOINTs, and the no-support error path.
//
// The single shared in-memory connection is the whole point: a transaction must
// make every `Model.query()` issued inside the callback (any model) execute on
// that one open transaction, threaded transparently via AsyncLocalStorage.

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { Model, ModelRegistry, transaction } from '../index.js'
import type { OrmAdapter } from '@rudderjs/contracts'
import { NativeAdapter } from './adapter.js'
import { BetterSqlite3Driver } from '@rudderjs/database/native'
import type { Driver } from '@rudderjs/database/native'

// ── Models under test ────────────────────────────────────────
class Account extends Model {
  static override table = 'accounts'
  id!: number
  owner!: string
  balance!: number
}

class Ledger extends Model {
  static override table = 'ledgers'
  id!: number
  note!: string
}

let driver: Driver

beforeEach(async () => {
  driver = await BetterSqlite3Driver.open({ filename: ':memory:' })
  await driver.execute(
    `CREATE TABLE accounts (id INTEGER PRIMARY KEY AUTOINCREMENT, owner TEXT, balance INTEGER DEFAULT 0)`, [])
  await driver.execute(
    `CREATE TABLE ledgers (id INTEGER PRIMARY KEY AUTOINCREMENT, note TEXT)`, [])
  ModelRegistry.reset()
  ModelRegistry.set(await NativeAdapter.make({ driverInstance: driver }))
})

afterEach(async () => {
  await driver.close()
})

describe('native transactions — commit', () => {
  it('persists every write when the callback resolves', async () => {
    await transaction(async () => {
      const acct = await Account.create({ owner: 'Ada', balance: 100 })
      await Ledger.create({ note: `opened #${acct.id}` })
    })
    assert.strictEqual(await Account.count(), 1)
    assert.strictEqual(await Ledger.count(), 1)
  })

  it('returns the callback value', async () => {
    const id = await transaction(async () => {
      const acct = await Account.create({ owner: 'Grace', balance: 5 })
      return acct.id
    })
    assert.strictEqual(typeof id, 'number')
    const found = await Account.find(id)
    assert.strictEqual(found!.owner, 'Grace')
  })

  it('reads written rows back inside the same transaction', async () => {
    await transaction(async () => {
      const acct = await Account.create({ owner: 'Linus', balance: 1 })
      const seen = await Account.find(acct.id)
      assert.ok(seen, 'row created earlier in the tx is visible within it')
      assert.strictEqual(seen!.owner, 'Linus')
    })
  })
})

describe('native transactions — rollback', () => {
  it('rolls back every write when the callback throws, and re-throws', async () => {
    await assert.rejects(
      transaction(async () => {
        await Account.create({ owner: 'Ada', balance: 100 })
        await Ledger.create({ note: 'should vanish' })
        throw new Error('boom')
      }),
      /boom/,
    )
    assert.strictEqual(await Account.count(), 0)
    assert.strictEqual(await Ledger.count(), 0)
  })

  it('leaves the database usable after a rollback', async () => {
    await assert.rejects(transaction(async () => {
      await Account.create({ owner: 'doomed', balance: 1 })
      throw new Error('nope')
    }))
    // A normal write after the failed transaction still works.
    await Account.create({ owner: 'survivor', balance: 9 })
    assert.strictEqual(await Account.count(), 1)
  })
})

describe('native transactions — scoping', () => {
  it('routes queries to the base adapter again after the transaction ends', async () => {
    await transaction(async () => {
      await Account.create({ owner: 'inside', balance: 1 })
    })
    // Outside the callback the ALS store is cleared — this is a plain write.
    await Account.create({ owner: 'outside', balance: 2 })
    assert.strictEqual(await Account.count(), 2)
  })

  it('Model.transaction() is an alias for the free function', async () => {
    await Account.transaction(async () => {
      await Account.create({ owner: 'viaStatic', balance: 7 })
    })
    assert.strictEqual(await Account.count(), 1)
  })
})

describe('native transactions — nesting (savepoints)', () => {
  it('commits both levels when neither throws', async () => {
    await transaction(async () => {
      await Account.create({ owner: 'outer', balance: 1 })
      await transaction(async () => {
        await Account.create({ owner: 'inner', balance: 2 })
      })
    })
    assert.strictEqual(await Account.count(), 2)
  })

  it('a caught inner rollback discards only the inner work', async () => {
    await transaction(async () => {
      await Account.create({ owner: 'kept', balance: 1 })
      await assert.rejects(transaction(async () => {
        await Account.create({ owner: 'discarded', balance: 2 })
        throw new Error('inner boom')
      }), /inner boom/)
      // Outer continues and commits.
    })
    const owners = (await Account.all()).map((a) => a.owner)
    assert.deepStrictEqual(owners, ['kept'])
  })

  it('an uncaught inner error rolls back the whole outer transaction', async () => {
    await assert.rejects(transaction(async () => {
      await Account.create({ owner: 'outer', balance: 1 })
      await transaction(async () => {
        await Account.create({ owner: 'inner', balance: 2 })
        throw new Error('propagate')
      })
    }), /propagate/)
    assert.strictEqual(await Account.count(), 0)
  })
})

describe('native transactions — unsupported adapter', () => {
  it('throws a clear error when the active adapter has no transaction()', async () => {
    // A minimal adapter that omits the optional `transaction` capability.
    const noTx: OrmAdapter = {
      query: (() => { throw new Error('unused') }) as OrmAdapter['query'],
      async connect() { /* noop */ },
      async disconnect() { /* noop */ },
    }
    ModelRegistry.set(noTx)
    await assert.rejects(
      transaction(async () => { /* unreachable */ }),
      /does not support transactions/,
    )
  })
})
