import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { FakeCacheAdapter } from '@rudderjs/cache'
import {
  Job,
  QueueRegistry,
  SyncAdapter,
  executeJob,
  type JobMiddleware,
  type ShouldBeUnique,
  type ShouldBeUniqueUntilProcessing,
} from './index.js'
import { _clearLocks } from './unique.js'

// ─── executeJob — middleware + failed() + unique-lock release ──

describe('executeJob — middleware pipeline', () => {
  it('runs job.middleware() before handle()', async () => {
    const calls: string[] = []
    class TraceMw implements JobMiddleware {
      async handle(_job: Job, next: () => Promise<void>): Promise<void> {
        calls.push('before')
        await next()
        calls.push('after')
      }
    }
    class Foo extends Job {
      override middleware(): JobMiddleware[] { return [new TraceMw()] }
      async handle(): Promise<void> { calls.push('handle') }
    }
    await executeJob(new Foo())
    assert.deepStrictEqual(calls, ['before', 'handle', 'after'])
  })

  it('a middleware skipping next() prevents handle from running', async () => {
    let handled = false
    class SkipMw implements JobMiddleware {
      async handle(_job: Job, _next: () => Promise<void>): Promise<void> { /* skip */ }
    }
    class Foo extends Job {
      override middleware(): JobMiddleware[] { return [new SkipMw()] }
      async handle(): Promise<void> { handled = true }
    }
    await executeJob(new Foo())
    assert.equal(handled, false)
  })

  it('a middleware that throws fires failed() with the thrown error', async () => {
    class BoomMw implements JobMiddleware {
      async handle(): Promise<void> { throw new Error('mw-boom') }
    }
    let failedWith: unknown
    class Foo extends Job {
      override middleware(): JobMiddleware[] { return [new BoomMw()] }
      async handle(): Promise<void> { /* unreachable */ }
      async failed(err: unknown): Promise<void> { failedWith = err }
    }
    await assert.rejects(() => executeJob(new Foo()), /mw-boom/)
    assert.ok(failedWith instanceof Error)
    assert.equal((failedWith as Error).message, 'mw-boom')
  })
})

describe('executeJob — failed() hook', () => {
  it('fires when handle() throws, then re-throws the original', async () => {
    let failedWith: unknown
    class Foo extends Job {
      async handle(): Promise<void> { throw new Error('boom') }
      async failed(err: unknown): Promise<void> { failedWith = err }
    }
    await assert.rejects(() => executeJob(new Foo()), /boom/)
    assert.equal((failedWith as Error).message, 'boom')
  })

  it('logs and continues when failed() itself throws', async () => {
    class Foo extends Job {
      async handle(): Promise<void> { throw new Error('original') }
      async failed(_e: unknown): Promise<void> { throw new Error('hook-error') }
    }
    const original = console.error
    let logged: unknown[] = []
    console.error = (...args: unknown[]) => { logged = args }
    try {
      await assert.rejects(() => executeJob(new Foo()), /original/)
    } finally {
      console.error = original
    }
    assert.ok(logged.length > 0, 'expected console.error to be called when the hook throws')
  })
})

describe('executeJob — ShouldBeUnique release', () => {
  let fake: FakeCacheAdapter
  beforeEach(() => { fake = FakeCacheAdapter.fake(); _clearLocks() })
  afterEach(()  => fake.restore())

  it('releases the unique lock after handle() returns (default)', async () => {
    class Foo extends Job implements ShouldBeUnique {
      uniqueId(): string { return 'foo-1' }
      uniqueFor(): number { return 60 }
      async handle(): Promise<void> { /* noop */ }
    }
    await fake.add('rudderjs:unique:foo-1', '1', 60)   // simulate dispatch-side acquire
    await executeJob(new Foo())
    fake.assertForgotten('rudderjs:unique:foo-1')
  })

  it('still releases the unique lock when handle() throws', async () => {
    class Foo extends Job implements ShouldBeUnique {
      uniqueId(): string { return 'foo-2' }
      uniqueFor(): number { return 60 }
      async handle(): Promise<void> { throw new Error('boom') }
    }
    await fake.add('rudderjs:unique:foo-2', '1', 60)
    await assert.rejects(() => executeJob(new Foo()), /boom/)
    fake.assertForgotten('rudderjs:unique:foo-2')
  })

  it('ShouldBeUniqueUntilProcessing releases the lock BEFORE handle() runs', async () => {
    let lockHeldAtHandle = false
    class Foo extends Job implements ShouldBeUniqueUntilProcessing {
      readonly releaseOnProcessing = true as const
      uniqueId(): string { return 'foo-3' }
      uniqueFor(): number { return 60 }
      async handle(): Promise<void> {
        lockHeldAtHandle = (await fake.get('rudderjs:unique:foo-3')) !== null
      }
    }
    await fake.add('rudderjs:unique:foo-3', '1', 60)
    await executeJob(new Foo())
    assert.equal(lockHeldAtHandle, false, 'lock must be released before handle() runs')
  })
})

// ─── End-to-end: SyncAdapter → executeJob → middleware ─────

describe('SyncAdapter → executeJob plumbing', () => {
  it('SyncAdapter.dispatch() exercises middleware on the driver path', async () => {
    const calls: string[] = []
    class TraceMw implements JobMiddleware {
      async handle(_job: Job, next: () => Promise<void>): Promise<void> {
        calls.push('mw'); await next()
      }
    }
    class Foo extends Job {
      override middleware(): JobMiddleware[] { return [new TraceMw()] }
      async handle(): Promise<void> { calls.push('handle') }
    }
    await new SyncAdapter().dispatch(new Foo())
    assert.deepStrictEqual(calls, ['mw', 'handle'])
  })

  it('SyncAdapter.dispatch() fires failed() on the driver path', async () => {
    let failedWith: unknown
    class Foo extends Job {
      async handle(): Promise<void> { throw new Error('sync-boom') }
      async failed(e: unknown): Promise<void> { failedWith = e }
    }
    await assert.rejects(() => new SyncAdapter().dispatch(new Foo()), /sync-boom/)
    assert.ok(failedWith instanceof Error)
  })
})

// ─── DispatchBuilder.send: ShouldBeUnique acquire-on-dispatch ──

describe('DispatchBuilder.send — ShouldBeUnique', () => {
  let fake: FakeCacheAdapter
  beforeEach(() => {
    fake = FakeCacheAdapter.fake()
    _clearLocks()
    QueueRegistry.reset()
    QueueRegistry.set(new SyncAdapter())
  })
  afterEach(() => { fake.restore(); QueueRegistry.reset() })

  it('two concurrent dispatches enqueue exactly one job', async () => {
    let runs = 0
    class Foo extends Job implements ShouldBeUnique {
      uniqueId(): string { return 'concurrent-1' }
      uniqueFor(): number { return 60 }
      async handle(): Promise<void> { runs++ }
    }
    await Promise.all([Foo.dispatch().send(), Foo.dispatch().send()])
    assert.equal(runs, 1, 'only one dispatch wins the lock')
  })

  it('a second dispatch after the first finishes succeeds (lock released)', async () => {
    let runs = 0
    class Foo extends Job implements ShouldBeUnique {
      uniqueId(): string { return 'sequential-1' }
      uniqueFor(): number { return 60 }
      async handle(): Promise<void> { runs++ }
    }
    await Foo.dispatch().send()
    await Foo.dispatch().send()
    assert.equal(runs, 2, 'serial dispatches both run because the lock was released')
  })
})
