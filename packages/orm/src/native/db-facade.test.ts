import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DB } from '@rudderjs/database'
import { Model, ModelRegistry } from '../index.js'
// Side effect: registers ModelRegistry.getAdapter() as the DB facade's resolver
// and `transaction()` as its transaction runner.
import '../db-bridge.js'
import { NativeAdapter } from '@rudderjs/database/native'

test('DB.select round-trips on the native engine', async () => {
  const adapter = await NativeAdapter.make({ driver: 'sqlite', url: ':memory:' })
  ModelRegistry.set(adapter)
  try {
    const rows = await DB.select('select 1 as one', [])
    assert.equal(rows.length, 1)
    assert.equal(rows[0]?.one, 1)
  } finally {
    await adapter.disconnect()
  }
})

test('DB write statements report rows affected on the native engine', async () => {
  const adapter = await NativeAdapter.make({ driver: 'sqlite', url: ':memory:' })
  ModelRegistry.set(adapter)
  try {
    await DB.statement('create table widgets (id integer primary key, name text)', [])
    const inserted = await DB.insert(
      "insert into widgets (name) values (?), (?) returning *",
      ['a', 'b'],
    )
    assert.equal(inserted, 2)
    const rows = await DB.select('select name from widgets order by id', [])
    assert.deepEqual(rows.map((r) => r.name), ['a', 'b'])
  } finally {
    await adapter.disconnect()
  }
})

// ── DB.transaction — Model + DB.* land on the same transaction ──
class Account extends Model {
  static override table = 'accounts'
  id!: number
  owner!: string
}

test('DB.transaction commits a Model write and a DB.* write on one connection', async () => {
  const adapter = await NativeAdapter.make({ driver: 'sqlite', url: ':memory:' })
  ModelRegistry.set(adapter)
  try {
    await DB.statement('create table accounts (id integer primary key autoincrement, owner text)', [])

    await DB.transaction(async () => {
      // Model write — routes through the ALS-scoped (transaction) adapter.
      await Account.create({ owner: 'via-model' })
      // DB.* write inside the same callback joins the same open transaction.
      await DB.insert('insert into accounts (owner) values (?)', ['via-db'])
    })

    const owners = (await DB.select('select owner from accounts order by id', []))
      .map((r) => r.owner)
    assert.deepEqual(owners, ['via-model', 'via-db'])
  } finally {
    await adapter.disconnect()
  }
})

test('DB.transaction rolls back both Model and DB.* writes when the callback throws', async () => {
  const adapter = await NativeAdapter.make({ driver: 'sqlite', url: ':memory:' })
  ModelRegistry.set(adapter)
  try {
    await DB.statement('create table accounts (id integer primary key autoincrement, owner text)', [])

    await assert.rejects(
      DB.transaction(async () => {
        await Account.create({ owner: 'doomed-model' })
        await DB.insert('insert into accounts (owner) values (?)', ['doomed-db'])
        throw new Error('boom')
      }),
      /boom/,
    )

    const count = (await DB.select('select count(*) as c from accounts', []))[0]?.c
    assert.equal(count, 0)
  } finally {
    await adapter.disconnect()
  }
})

test('DB.transaction returns the callback value', async () => {
  const adapter = await NativeAdapter.make({ driver: 'sqlite', url: ':memory:' })
  ModelRegistry.set(adapter)
  try {
    await DB.statement('create table accounts (id integer primary key autoincrement, owner text)', [])
    const result = await DB.transaction(async () => {
      await DB.insert('insert into accounts (owner) values (?)', ['x'])
      return 42
    })
    assert.equal(result, 42)
  } finally {
    await adapter.disconnect()
  }
})
