// DB.afterCommit() — bridge delegation tests.
//
// `@rudderjs/database` can't import `@rudderjs/orm`, so these tests register a
// stub runner and pin the delegation shape: the root facade passes no
// connection, the scoped facade passes its name, and an unregistered runner
// throws the clear pointer error. The real queue semantics live in the orm
// package (`after-commit.test.ts` + `native/after-commit.test.ts`).

import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { DB } from './db.js'
import { registerAfterCommitRunner, resolveAfterCommitRunner, __resetAdapterResolver } from './registry-bridge.js'

beforeEach(() => __resetAdapterResolver())

describe('DB.afterCommit bridge', () => {
  it('throws a clear error when no runner is registered', async () => {
    await assert.rejects(DB.afterCommit(() => {}), /No after-commit runner is available/)
    assert.throws(() => resolveAfterCommitRunner(), /No after-commit runner is available/)
  })

  it('delegates to the registered runner with no connection', async () => {
    const calls: Array<[unknown, unknown]> = []
    registerAfterCommitRunner(async (fn, opts) => { calls.push([fn, opts]) })
    const cb = (): void => {}
    await DB.afterCommit(cb)
    assert.strictEqual(calls.length, 1)
    assert.strictEqual(calls[0]?.[0], cb)
    assert.strictEqual(calls[0]?.[1], undefined)
  })

  it('DB.connection(name).afterCommit() passes the connection name', async () => {
    const calls: Array<[unknown, unknown]> = []
    registerAfterCommitRunner(async (fn, opts) => { calls.push([fn, opts]) })
    const cb = (): void => {}
    await DB.connection('reporting').afterCommit(cb)
    assert.deepStrictEqual(calls[0]?.[1], { connection: 'reporting' })
    assert.strictEqual(calls[0]?.[0], cb)
  })

  it('last registration wins (HMR re-boot re-installs the runner)', async () => {
    const first: unknown[] = []
    const second: unknown[] = []
    registerAfterCommitRunner(async (fn) => { first.push(fn) })
    registerAfterCommitRunner(async (fn) => { second.push(fn) })
    await DB.afterCommit(() => {})
    assert.strictEqual(first.length, 0)
    assert.strictEqual(second.length, 1)
  })
})
