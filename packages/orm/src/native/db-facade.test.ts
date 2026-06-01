import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DB } from '@rudderjs/database'
import { ModelRegistry } from '../index.js'
import { NativeAdapter } from './adapter.js'
// Side effect: registers ModelRegistry.getAdapter() as the DB facade's resolver.
import '../db-bridge.js'

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
