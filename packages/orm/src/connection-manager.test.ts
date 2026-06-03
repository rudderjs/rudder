import assert from 'node:assert/strict'
import { test, beforeEach } from 'node:test'
import type { OrmAdapter } from '@rudderjs/contracts'
import { ConnectionManager } from './connection-manager.js'

function fakeAdapter(tag: string): OrmAdapter {
  return { __tag: tag } as unknown as OrmAdapter
}

beforeEach(() => {
  ConnectionManager.__reset()
})

test('register/has/names/peek — registering does not open', () => {
  let opened = 0
  ConnectionManager.register('reporting', async () => {
    opened++
    return fakeAdapter('reporting')
  })

  assert.equal(ConnectionManager.has('reporting'), true)
  assert.equal(ConnectionManager.has('missing'), false)
  assert.deepEqual(ConnectionManager.names(), ['reporting'])
  assert.equal(ConnectionManager.peek('reporting'), null)
  assert.equal(opened, 0)
})

test('ensure opens once, memoizes, and peek sees the opened adapter', async () => {
  let opened = 0
  const adapter = fakeAdapter('a')
  ConnectionManager.register('a', async () => {
    opened++
    return adapter
  })

  const first = await ConnectionManager.ensure('a')
  const second = await ConnectionManager.ensure('a')

  assert.equal(first, adapter)
  assert.equal(second, adapter)
  assert.equal(opened, 1)
  assert.equal(ConnectionManager.peek('a'), adapter)
})

test('ensure is single-flighted — concurrent callers share one open', async () => {
  let opened = 0
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  ConnectionManager.register('slow', async () => {
    opened++
    await gate
    return fakeAdapter('slow')
  })

  const p1 = ConnectionManager.ensure('slow')
  const p2 = ConnectionManager.ensure('slow')
  release()
  const [a1, a2] = await Promise.all([p1, p2])

  assert.equal(a1, a2)
  assert.equal(opened, 1)
})

test('a failed open does not poison the entry — the next ensure retries', async () => {
  let attempts = 0
  ConnectionManager.register('flaky', async () => {
    attempts++
    if (attempts === 1) throw new Error('connect refused')
    return fakeAdapter('flaky')
  })

  await assert.rejects(() => ConnectionManager.ensure('flaky'), /connect refused/)
  const adapter = await ConnectionManager.ensure('flaky')
  assert.equal(attempts, 2)
  assert.ok(adapter)
})

test('ensure on an unknown name lists the configured connections', async () => {
  ConnectionManager.register('sqlite', async () => fakeAdapter('sqlite'))
  ConnectionManager.register('reporting', async () => fakeAdapter('reporting'))

  await assert.rejects(
    () => ConnectionManager.ensure('reprting'),
    (err: Error) => {
      assert.match(err.message, /Unknown database connection 'reprting'/)
      assert.match(err.message, /'sqlite', 'reporting'/)
      return true
    },
  )
})

test('ensure with nothing registered points at the database provider', async () => {
  await assert.rejects(
    () => ConnectionManager.ensure('anything'),
    /No connections are registered — did a database provider boot\?/,
  )
})

test('re-register replaces the factory and clears the memoized adapter', async () => {
  ConnectionManager.register('c', async () => fakeAdapter('v1'))
  const v1 = await ConnectionManager.ensure('c')

  ConnectionManager.register('c', async () => fakeAdapter('v2'))
  assert.equal(ConnectionManager.peek('c'), null)
  const v2 = await ConnectionManager.ensure('c')

  assert.notEqual(v1, v2)
})

test('defaultName round-trips and resets', () => {
  assert.equal(ConnectionManager.defaultName(), null)
  ConnectionManager.setDefaultName('sqlite')
  assert.equal(ConnectionManager.defaultName(), 'sqlite')
  ConnectionManager.__reset()
  assert.equal(ConnectionManager.defaultName(), null)
})
