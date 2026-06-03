import assert from 'node:assert/strict'
import { test, beforeEach } from 'node:test'
import type { OrmAdapter, QueryEvent, QueryListener } from '@rudderjs/contracts'
import { DB, registerAdapterResolver, __resetAdapterResolver } from './index.js'

beforeEach(() => {
  __resetAdapterResolver()
})

test('DB.listen throws a clear error when no resolver is registered', () => {
  assert.throws(() => DB.listen(() => {}), /No ORM adapter is available/)
})

test('DB.listen throws an adapter-named error when onQuery is missing', () => {
  const adapter = { constructor: { name: 'LegacyAdapter' } } as unknown as OrmAdapter
  registerAdapterResolver(() => adapter)

  assert.throws(
    () => DB.listen(() => {}),
    /LegacyAdapter does not implement onQuery\(\)/,
  )
})

test('DB.listen delegates the listener to the active adapter onQuery', () => {
  const registered: QueryListener[] = []
  const adapter = {
    onQuery(listener: QueryListener): void {
      registered.push(listener)
    },
  } as unknown as OrmAdapter
  registerAdapterResolver(() => adapter)

  const mine: QueryListener = () => {}
  DB.listen(mine)

  assert.deepEqual(registered, [mine])
})

test('DB.listen-registered listener receives the adapter-emitted query event', () => {
  let registered: QueryListener | undefined
  const adapter = {
    onQuery(listener: QueryListener): void {
      registered = listener
    },
  } as unknown as OrmAdapter
  registerAdapterResolver(() => adapter)

  const events: QueryEvent[] = []
  DB.listen((e) => events.push(e))
  registered?.({ sql: 'select 1', bindings: [1], duration: 0.5, connection: 'sqlite' })

  assert.equal(events.length, 1)
  assert.equal(events[0]?.sql, 'select 1')
  assert.equal(events[0]?.duration, 0.5)
})
