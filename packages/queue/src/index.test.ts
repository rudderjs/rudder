import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { rudder } from '@rudderjs/core'
import { ConfigRepository, setConfigRepository, getConfigRepository } from '@rudderjs/core'
import { Job, DispatchBuilder, QueueRegistry, SyncAdapter, QueueProvider, type QueueAdapter, type DispatchOptions, type QueueConfig } from './index.js'

function withQueueConfig(cfg: QueueConfig): () => void {
  const previous = getConfigRepository()
  setConfigRepository(new ConfigRepository({ queue: cfg }))
  return () => setConfigRepository(previous ?? new ConfigRepository({}))
}

// ─── Helpers ───────────────────────────────────────────────

class SimpleJob extends Job {
  result: string | null = null
  async handle(): Promise<void> {
    this.result = 'done'
  }
}

class FailingJob extends Job {
  failedWith: unknown = null
  async handle(): Promise<void> {
    throw new Error('boom')
  }
  async failed(error: unknown): Promise<void> {
    this.failedWith = error
  }
}

class SlowJob extends Job {
  static override queue = 'slow'
  static override delay = 500
  async handle(): Promise<void> {}
}

const fakeApp = { instance: () => undefined } as never

function runCommand(name: string, args: string[] = []): Promise<void> {
  const cmd = rudder.getCommands().find(c => c.name === name)
  if (!cmd) throw new Error(`Command "${name}" not registered`)
  return Promise.resolve(cmd.handler(args, {})) as Promise<void>
}

// ─── Job ───────────────────────────────────────────────────

describe('Job', () => {
  it('has default static properties', () => {
    assert.strictEqual(Job.queue,   'default')
    assert.strictEqual(Job.retries, 3)
    assert.strictEqual(Job.delay,   0)
  })

  it('dispatch() returns a DispatchBuilder', () => {
    const builder = SimpleJob.dispatch()
    assert.ok(builder instanceof DispatchBuilder)
  })

  it('dispatch() accepts a subclass with a typed constructor', () => {
    // Regression: `this: new (...args: unknown[]) => T` rejected typed
    // constructors via contravariance. Relaxing to `any[]` lets subclasses
    // declare their own parameter shape and still get ConstructorParameters
    // type safety at the call site.
    class TypedJob extends Job {
      constructor(public readonly name: string, public readonly count: number) { super() }
      async handle(): Promise<void> { /* noop */ }
    }
    const builder = TypedJob.dispatch('hello', 42)
    assert.ok(builder instanceof DispatchBuilder)
  })

  it('subclass can override static properties', () => {
    assert.strictEqual(SlowJob.queue,  'slow')
    assert.strictEqual(SlowJob.delay,  500)
  })
})

// ─── DispatchBuilder ───────────────────────────────────────

describe('DispatchBuilder', () => {
  let dispatched: { job: Job; options: DispatchOptions }[] = []

  const mockAdapter: QueueAdapter = {
    async dispatch(job, options = {}) {
      dispatched.push({ job, options })
    },
  }

  beforeEach(() => {
    dispatched = []
    QueueRegistry.reset()
    QueueRegistry.set(mockAdapter)
  })

  it('send() dispatches the job via the registry adapter', async () => {
    const job = new SimpleJob()
    await new DispatchBuilder(job).send()
    assert.strictEqual(dispatched.length, 1)
    assert.strictEqual(dispatched[0]!.job, job)
  })

  it('picks up static queue and delay from the job class', async () => {
    await SlowJob.dispatch().send()
    assert.strictEqual(dispatched[0]!.options.queue, 'slow')
    assert.strictEqual(dispatched[0]!.options.delay, 500)
  })

  it('delay() overrides the static delay', async () => {
    await SimpleJob.dispatch().delay(1000).send()
    assert.strictEqual(dispatched[0]!.options.delay, 1000)
  })

  it('onQueue() overrides the static queue', async () => {
    await SimpleJob.dispatch().onQueue('high').send()
    assert.strictEqual(dispatched[0]!.options.queue, 'high')
  })

  it('delay() and onQueue() are chainable', async () => {
    await SimpleJob.dispatch().delay(200).onQueue('critical').send()
    assert.strictEqual(dispatched[0]!.options.delay, 200)
    assert.strictEqual(dispatched[0]!.options.queue, 'critical')
  })

  it('send() throws when no adapter is registered', async () => {
    QueueRegistry.reset()
    await assert.rejects(
      async () => SimpleJob.dispatch().send(),
      /No queue adapter registered/
    )
  })
})

// ─── QueueRegistry ─────────────────────────────────────────

describe('QueueRegistry', () => {
  beforeEach(() => QueueRegistry.reset())

  it('get() returns null when nothing is registered', () => {
    assert.strictEqual(QueueRegistry.get(), null)
  })

  it('set() + get() registers and retrieves the adapter', () => {
    const adapter = new SyncAdapter()
    QueueRegistry.set(adapter)
    assert.strictEqual(QueueRegistry.get(), adapter)
  })

  it('reset() clears the registered adapter', () => {
    QueueRegistry.set(new SyncAdapter())
    QueueRegistry.reset()
    assert.strictEqual(QueueRegistry.get(), null)
  })

  it('state lives on globalThis so it survives a second copy of @rudderjs/queue', () => {
    // Vite-bundled server apps inline `@rudderjs/queue` (Queue.dispatch and
    // worker boot read `QueueRegistry`) into entry.mjs, but driver packages
    // (`@rudderjs/queue-bullmq`) are externalized and resolve their own copy
    // of `@rudderjs/queue` from `node_modules`. Without a globalThis-routed
    // store, `set()` from the externalized driver would never be visible to
    // `get()` from the bundled copy. This test pins the contract: writes
    // from this module copy are visible on a global key the second copy
    // would also read from.
    const adapter = new SyncAdapter()
    QueueRegistry.set(adapter)
    const store = (globalThis as Record<string, unknown>)['__rudderjs_queue_registry__'] as { adapter: unknown } | undefined
    assert.ok(store, 'global store should exist after QueueRegistry.set()')
    assert.strictEqual(store.adapter, adapter)
  })
})

// ─── SyncAdapter ───────────────────────────────────────────

describe('SyncAdapter', () => {
  let adapter: SyncAdapter

  beforeEach(() => { adapter = new SyncAdapter() })

  it('dispatch() runs job.handle() in-process', async () => {
    const job = new SimpleJob()
    await adapter.dispatch(job)
    assert.strictEqual(job.result, 'done')
  })

  it('dispatch() calls job.failed() and re-throws on error', async () => {
    const job = new FailingJob()
    await assert.rejects(
      async () => adapter.dispatch(job),
      /boom/
    )
    assert.ok(job.failedWith instanceof Error)
    assert.strictEqual((job.failedWith as Error).message, 'boom')
  })

  it('dispatch() re-throws even without a failed() method', async () => {
    class BareJob extends Job {
      async handle(): Promise<void> { throw new Error('bare') }
    }
    await assert.rejects(async () => { await adapter.dispatch(new BareJob()) })
  })

  it('dispatch() propagates the original error when failed() hook throws', async () => {
    class HookThrowsJob extends Job {
      async handle(): Promise<void> { throw new Error('original') }
      async failed(_e: unknown): Promise<void> { throw new Error('hook-error') }
    }
    const originalErrorFn = console.error
    let logged: unknown = null
    console.error = (...args: unknown[]) => { logged = args }
    try {
      await assert.rejects(
        async () => adapter.dispatch(new HookThrowsJob()),
        /original/,
      )
    } finally {
      console.error = originalErrorFn
    }
    assert.ok(logged, 'expected console.error to be called when hook throws')
  })

  it('dispatch() accepts options without using them (sync runs immediately)', async () => {
    const job = new SimpleJob()
    await adapter.dispatch(job, { delay: 0, queue: 'default' })
    assert.strictEqual(job.result, 'done')
  })
})

// ─── QueueProvider ─────────────────────────────────────────

describe('QueueProvider', () => {
  let restore: () => void
  beforeEach(() => QueueRegistry.reset())
  afterEach(() => restore?.())

  it('boots with sync driver and registers the adapter', async () => {
    restore = withQueueConfig({ default: 'sync', connections: { sync: { driver: 'sync' } } })
    await new QueueProvider(fakeApp).boot?.()
    assert.ok(QueueRegistry.get() instanceof SyncAdapter)
  })

  it('falls back to sync driver when connection config is missing', async () => {
    restore = withQueueConfig({ default: 'missing', connections: {} })
    await new QueueProvider(fakeApp).boot?.()
    assert.ok(QueueRegistry.get() instanceof SyncAdapter)
  })

  it('throws on an unknown driver', async () => {
    restore = withQueueConfig({ default: 'bad', connections: { bad: { driver: 'unsupported' } } })
    await assert.rejects(
      async () => new QueueProvider(fakeApp).boot?.(),
      /Unknown driver "unsupported"/
    )
  })

  it('register() is a no-op', () => {
    restore = withQueueConfig({ default: 'sync', connections: { sync: { driver: 'sync' } } })
    assert.doesNotThrow(() => new QueueProvider(fakeApp).register?.())
  })
})

// ─── rudder commands — sync driver (no work/status/etc.) ──

describe('rudder commands — unsupported operations', () => {
  let restore: () => void
  beforeEach(async () => {
    QueueRegistry.reset()
    rudder.reset()
    restore = withQueueConfig({ default: 'sync', connections: { sync: { driver: 'sync' } } })
    await new QueueProvider(fakeApp).boot?.()
  })
  afterEach(() => restore())

  it('queue:work throws for sync driver', async () => {
    await assert.rejects(() => runCommand('queue:work'), /does not support workers/)
  })

  it('queue:status throws for sync driver', async () => {
    await assert.rejects(() => runCommand('queue:status'), /does not support queue:status/)
  })

  it('queue:clear throws for sync driver', async () => {
    await assert.rejects(() => runCommand('queue:clear'), /does not support queue:clear/)
  })

  it('queue:failed throws for sync driver', async () => {
    await assert.rejects(() => runCommand('queue:failed'), /does not support queue:failed/)
  })

  it('queue:retry throws for sync driver', async () => {
    await assert.rejects(() => runCommand('queue:retry'), /does not support queue:retry/)
  })
})

// ─── rudder commands — full mock adapter ──────────────────

describe('rudder commands — full adapter', () => {
  let worked:  string[]
  let cleared: string[]
  let retried: string[]

  beforeEach(async () => {
    worked  = []
    cleared = []
    retried = []

    QueueRegistry.reset()
    rudder.reset()

    const mockFull: QueueAdapter = {
      async dispatch() {},
      async work(queues = 'default') { worked.push(queues) },
      async status(_q = 'default') {
        return { waiting: 2, active: 1, completed: 10, failed: 3, delayed: 0, paused: 0 }
      },
      async flush(q = 'default') { cleared.push(q) },
      async failures(_q = 'default', _limit?: number) {
        return [{ id: '1', name: 'TestJob', data: {}, error: 'boom', failedAt: new Date(), attempts: 3 }]
      },
      async retryFailed(q = 'default') { retried.push(q); return 1 },
    }

    QueueRegistry.set(mockFull)

    // Register a fake provider that uses our mock adapter
    rudder.command('queue:work', async (args) => {
      await mockFull.work!(args[0] ?? 'default')
    })
    rudder.command('queue:status', async (args) => {
      await mockFull.status!(args[0] ?? 'default')
    })
    rudder.command('queue:clear', async (args) => {
      await mockFull.flush!(args[0] ?? 'default')
    })
    rudder.command('queue:failed', async (args) => {
      await mockFull.failures!(args[0] ?? 'default')
    })
    rudder.command('queue:retry', async (args) => {
      await mockFull.retryFailed!(args[0] ?? 'default')
    })
  })

  it('queue:work invokes adapter.work() with queue arg', async () => {
    await runCommand('queue:work', ['emails'])
    assert.deepStrictEqual(worked, ['emails'])
  })

  it('queue:work defaults to "default" queue', async () => {
    await runCommand('queue:work')
    assert.deepStrictEqual(worked, ['default'])
  })

  it('queue:clear invokes adapter.flush() with queue arg', async () => {
    await runCommand('queue:clear', ['emails'])
    assert.deepStrictEqual(cleared, ['emails'])
  })

  it('queue:retry invokes adapter.retryFailed() and returns count', async () => {
    await runCommand('queue:retry', ['default'])
    assert.deepStrictEqual(retried, ['default'])
  })

  it('queue:status invokes adapter.status()', async () => {
    await assert.doesNotReject(() => runCommand('queue:status'))
  })

  it('queue:failed invokes adapter.failures()', async () => {
    await assert.doesNotReject(() => runCommand('queue:failed'))
  })
})

// ─── QueueObserverRegistry ────────────────────────────────

describe('QueueObserverRegistry', () => {
  it('fan-outs events to every subscriber', async () => {
    const { QueueObserverRegistry } = await import('./observers.js')
    const reg = new QueueObserverRegistry()
    const calls: string[] = []
    reg.subscribe((e) => calls.push(`a:${e.kind}`))
    reg.subscribe((e) => calls.push(`b:${e.kind}`))

    reg.emit({
      kind: 'job.dispatched', jobId: '1', name: 'J', queue: 'default',
      payload: {}, attempts: 0, dispatchedAt: new Date(),
    })
    assert.deepStrictEqual(calls, ['a:job.dispatched', 'b:job.dispatched'])
  })

  it('unsubscribe removes the observer', async () => {
    const { QueueObserverRegistry } = await import('./observers.js')
    const reg = new QueueObserverRegistry()
    const calls: string[] = []
    const off = reg.subscribe(() => calls.push('x'))
    off()
    reg.emit({
      kind: 'job.dispatched', jobId: '1', name: 'J', queue: 'default',
      payload: {}, attempts: 0, dispatchedAt: new Date(),
    })
    assert.deepStrictEqual(calls, [])
  })

  it('swallows observer errors so the queue never breaks', async () => {
    const { QueueObserverRegistry } = await import('./observers.js')
    const reg = new QueueObserverRegistry()
    reg.subscribe(() => { throw new Error('observer bug') })
    const good: string[] = []
    reg.subscribe((e) => good.push(e.kind))

    reg.emit({
      kind: 'job.dispatched', jobId: '1', name: 'J', queue: 'default',
      payload: {}, attempts: 0, dispatchedAt: new Date(),
    })
    assert.deepStrictEqual(good, ['job.dispatched'])
  })

  it('global singleton is installed on globalThis', async () => {
    const { queueObservers } = await import('./observers.js')
    assert.ok(queueObservers)
    const g = globalThis as Record<string, unknown>
    assert.equal(g['__rudderjs_queue_observers__'], queueObservers)
  })

  it('reset clears subscribers', async () => {
    const { QueueObserverRegistry } = await import('./observers.js')
    const reg = new QueueObserverRegistry()
    const calls: string[] = []
    reg.subscribe(() => calls.push('x'))
    reg.reset()
    reg.emit({
      kind: 'job.dispatched', jobId: '1', name: 'J', queue: 'default',
      payload: {}, attempts: 0, dispatchedAt: new Date(),
    })
    assert.deepStrictEqual(calls, [])
  })
})

// ─── SyncAdapter emissions ────────────────────────────────

describe('SyncAdapter emissions', () => {
  it('fires dispatched → active → completed in order on success', async () => {
    const { queueObservers } = await import('./observers.js')
    const events: { kind: string; jobId: string; queue: string; name: string }[] = []
    const off = queueObservers.subscribe((e) =>
      events.push({ kind: e.kind, jobId: e.jobId, queue: e.queue, name: e.name }))

    try {
      const adapter = new SyncAdapter()
      const job = new SimpleJob()
      await adapter.dispatch(job, { queue: 'default' })

      assert.deepStrictEqual(events.map(e => e.kind), [
        'job.dispatched', 'job.active', 'job.completed',
      ])
      assert.equal(job.result, 'done')
      const ids = new Set(events.map(e => e.jobId))
      assert.equal(ids.size, 1, 'all events share one jobId')
      for (const e of events) assert.equal(e.queue, 'default')
      for (const e of events) assert.equal(e.name, 'SimpleJob')
    } finally {
      off()
    }
  })

  it('fires dispatched → active → failed when handle throws, and rethrows', async () => {
    const { queueObservers } = await import('./observers.js')
    const events: { kind: string; error?: string }[] = []
    const off = queueObservers.subscribe((e) =>
      events.push(e.kind === 'job.failed'
        ? { kind: e.kind, error: e.error }
        : { kind: e.kind }))

    try {
      const adapter = new SyncAdapter()
      const job = new FailingJob()
      await assert.rejects(() => adapter.dispatch(job, { queue: 'default' }), /boom/)
      assert.deepStrictEqual(events.map(e => e.kind), [
        'job.dispatched', 'job.active', 'job.failed',
      ])
      assert.match(events[2]?.error ?? '', /boom/)
    } finally {
      off()
    }
  })

  it('completed event carries non-negative duration + matching timestamps', async () => {
    const { queueObservers } = await import('./observers.js')
    let completed: import('./observers.js').QueueEvent | null = null
    const off = queueObservers.subscribe((e) => {
      if (e.kind === 'job.completed') completed = e
    })

    try {
      await new SyncAdapter().dispatch(new SimpleJob(), { queue: 'default' })
      assert.ok(completed, 'completed event was emitted')
      const e = completed as unknown as { startedAt: Date; completedAt: Date; duration: number }
      assert.ok(e.duration >= 0)
      assert.ok(e.completedAt.getTime() >= e.startedAt.getTime())
    } finally {
      off()
    }
  })

  it('uses options.queue, falling back to Job.queue when not provided', async () => {
    const { queueObservers } = await import('./observers.js')
    const queues: string[] = []
    const off = queueObservers.subscribe((e) => {
      if (e.kind === 'job.dispatched') queues.push(e.queue)
    })

    try {
      await new SyncAdapter().dispatch(new SimpleJob(), { queue: 'override' })
      await new SyncAdapter().dispatch(new SlowJob())  // SlowJob.queue = 'slow'
      assert.deepStrictEqual(queues, ['override', 'slow'])
    } finally {
      off()
    }
  })
})
