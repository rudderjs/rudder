import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { FakeCacheAdapter } from '@rudderjs/cache'
import { Job } from './index.js'
import { WithoutOverlapping } from './job-middleware.js'

class StubJob extends Job {
  async handle(): Promise<void> { /* noop */ }
}

describe('WithoutOverlapping', () => {
  let fake: FakeCacheAdapter

  beforeEach(() => { fake = FakeCacheAdapter.fake() })
  afterEach(()  => fake.restore())

  it('runs next() and releases the lock when nothing else is holding it', async () => {
    let called = false
    const mw = new WithoutOverlapping('import-1')
    await mw.handle(new StubJob(), async () => { called = true })

    assert.strictEqual(called, true)
    fake.assertLockAcquired('rudderjs:job-lock:import-1')
    fake.assertLockReleased('rudderjs:job-lock:import-1')
  })

  it('throws "already running" when the lock is held', async () => {
    // Pre-acquire on a separate handle.
    const holder = fake.lock('rudderjs:job-lock:import-1', 60)
    assert.strictEqual(await holder.get(), true)

    let called = false
    const mw = new WithoutOverlapping('import-1')
    await assert.rejects(
      mw.handle(new StubJob(), async () => { called = true }),
      /already running/,
    )
    assert.strictEqual(called, false, 'next() must NOT run when lock is held')
  })

  it('still releases the lock when next() throws', async () => {
    const mw = new WithoutOverlapping('import-1')
    await assert.rejects(
      mw.handle(new StubJob(), async () => { throw new Error('boom') }),
      /boom/,
    )
    // Released — next acquire works.
    const next = fake.lock('rudderjs:job-lock:import-1', 60)
    assert.strictEqual(await next.get(), true)
  })

  it('throws a clear error when no cache adapter is registered', async () => {
    fake.restore() // wipes CacheRegistry
    const mw = new WithoutOverlapping('import-1')
    await assert.rejects(
      mw.handle(new StubJob(), async () => {}),
      /WithoutOverlapping requires a cache adapter/,
    )
  })

  it('two concurrent middleware calls serialise — second sees the first holding', async () => {
    // Simulate two workers picking up the same job key in the same tick.
    const mw1 = new WithoutOverlapping('import-1', 60)
    const mw2 = new WithoutOverlapping('import-1', 60)

    let firstStarted  = false
    let firstFinished = false
    let firstError: unknown = null
    let releaseFirst:   () => void = () => {}
    const firstWait = new Promise<void>(r => { releaseFirst = r })

    const first = mw1.handle(new StubJob(), async () => {
      firstStarted = true
      await firstWait
      firstFinished = true
    }).catch(err => { firstError = err })

    // Wait until the first one has acquired the lock (or failed).
    const start = Date.now()
    while (!firstStarted && !firstError && Date.now() - start < 1000) {
      await new Promise(r => setImmediate(r))
    }
    assert.strictEqual(firstError, null, 'first handler must not error before lock is held')
    assert.strictEqual(firstStarted, true, 'first handler must have started')

    // Second handler should fail-fast — lock is held.
    await assert.rejects(
      mw2.handle(new StubJob(), async () => {
        assert.fail('second handler must not run while first is holding')
      }),
      /already running/,
    )

    releaseFirst()
    await first
    assert.strictEqual(firstFinished, true)

    // Now lock is released — third call succeeds.
    const mw3 = new WithoutOverlapping('import-1', 60)
    let thirdRan = false
    await mw3.handle(new StubJob(), async () => { thirdRan = true })
    assert.strictEqual(thirdRan, true)
  })
})
