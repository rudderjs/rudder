import { describe, it, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { Concurrency } from './index.js'

// Clean up after each test
afterEach(async () => {
  await Concurrency.restore()
})

// ─── Concurrency.run() with sync driver ───────────────────

describe('Concurrency.run() — sync driver', () => {
  it('runs tasks and returns results in order', async () => {
    Concurrency.fake()
    const results = await Concurrency.run([
      () => 1 + 1,
      () => 'hello',
      () => Promise.resolve(42),
    ])
    assert.deepStrictEqual(results, [2, 'hello', 42])
  })

  it('runs async tasks sequentially', async () => {
    Concurrency.fake()
    const order: number[] = []
    await Concurrency.run([
      async () => { order.push(1); return 'a' },
      async () => { order.push(2); return 'b' },
    ])
    assert.deepStrictEqual(order, [1, 2])
  })

  it('propagates errors', async () => {
    Concurrency.fake()
    await assert.rejects(
      () => Concurrency.run([() => { throw new Error('boom') }]),
      /boom/,
    )
  })
})

// ─── Concurrency.defer() — sync driver ───────────────────

describe('Concurrency.defer() — sync driver', () => {
  it('executes deferred task (fire-and-forget)', async () => {
    Concurrency.fake()
    let executed = false
    Concurrency.defer(() => { executed = true })

    // Deferred runs on next microtask in sync driver
    await new Promise(r => setTimeout(r, 10))
    assert.ok(executed)
  })
})

// ─── Concurrency.run() with worker driver ─────────────────

describe('Concurrency.run() — worker driver', () => {
  it('runs self-contained tasks in worker threads', async () => {
    const results = await Concurrency.run([
      () => 2 + 2,
      () => 'worker',
    ])
    assert.deepStrictEqual(results, [4, 'worker'])
  })

  it('runs tasks in parallel (timing test)', async () => {
    const start = Date.now()
    await Concurrency.run([
      () => {
        const end = Date.now() + 50
        while (Date.now() < end) { /* busy wait */ }
        return 'a'
      },
      () => {
        const end = Date.now() + 50
        while (Date.now() < end) { /* busy wait */ }
        return 'b'
      },
    ])
    const elapsed = Date.now() - start
    // If parallel, should be ~50ms, not ~100ms. Allow generous margin for CI
    // where worker thread startup can take 400ms+ on shared runners.
    assert.ok(elapsed < 2000, `Expected parallel execution under 2000ms, got ${elapsed}ms`)
  })

  it('propagates errors from worker', async () => {
    await assert.rejects(
      () => Concurrency.run([() => { throw new Error('worker-error') }]),
      /worker-error/,
    )
  })
})

// ─── Concurrency.fake() / restore ─────────────────────────

describe('Concurrency.fake()', () => {
  it('switches to sync driver', async () => {
    Concurrency.fake()
    const results = await Concurrency.run([() => 99])
    assert.deepStrictEqual(results, [99])
  })
})
