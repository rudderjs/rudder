import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { artisan } from '@boostkit/core'
import { Job, DispatchBuilder, QueueRegistry, SyncAdapter, queue, type QueueAdapter, type DispatchOptions } from './index.js'

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
  const cmd = artisan.getCommands().find(c => c.name === name)
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

  it('dispatch() accepts options without using them (sync runs immediately)', async () => {
    const job = new SimpleJob()
    await adapter.dispatch(job, { delay: 0, queue: 'default' })
    assert.strictEqual(job.result, 'done')
  })
})

// ─── queue() provider ──────────────────────────────────────

describe('queue() provider', () => {
  beforeEach(() => QueueRegistry.reset())

  it('boots with sync driver and registers the adapter', async () => {
    const Provider = queue({ default: 'sync', connections: { sync: { driver: 'sync' } } })
    await new Provider(fakeApp).boot?.()
    assert.ok(QueueRegistry.get() instanceof SyncAdapter)
  })

  it('falls back to sync driver when connection config is missing', async () => {
    const Provider = queue({ default: 'missing', connections: {} })
    await new Provider(fakeApp).boot?.()
    assert.ok(QueueRegistry.get() instanceof SyncAdapter)
  })

  it('throws on an unknown driver', async () => {
    const Provider = queue({ default: 'bad', connections: { bad: { driver: 'unsupported' } } })
    await assert.rejects(
      async () => new Provider(fakeApp).boot?.(),
      /Unknown driver "unsupported"/
    )
  })

  it('register() is a no-op', () => {
    const Provider = queue({ default: 'sync', connections: { sync: { driver: 'sync' } } })
    assert.doesNotThrow(() => new Provider(fakeApp).register?.())
  })
})

// ─── artisan commands — sync driver (no work/status/etc.) ──

describe('artisan commands — unsupported operations', () => {
  beforeEach(async () => {
    QueueRegistry.reset()
    artisan.reset()
    const Provider = queue({ default: 'sync', connections: { sync: { driver: 'sync' } } })
    await new Provider(fakeApp).boot?.()
  })

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

// ─── artisan commands — full mock adapter ──────────────────

describe('artisan commands — full adapter', () => {
  let worked:  string[]
  let cleared: string[]
  let retried: string[]

  beforeEach(async () => {
    worked  = []
    cleared = []
    retried = []

    QueueRegistry.reset()
    artisan.reset()

    const mockFull: QueueAdapter = {
      async dispatch() {},
      async work(queues = 'default') { worked.push(queues) },
      async status(q = 'default') {
        return { waiting: 2, active: 1, completed: 10, failed: 3, delayed: 0, paused: 0 }
      },
      async flush(q = 'default') { cleared.push(q) },
      async failures(q = 'default', _limit?: number) {
        return [{ id: '1', name: 'TestJob', data: {}, error: 'boom', failedAt: new Date(), attempts: 3 }]
      },
      async retryFailed(q = 'default') { retried.push(q); return 1 },
    }

    QueueRegistry.set(mockFull)

    // Register a fake provider that uses our mock adapter
    artisan.command('queue:work', async (args) => {
      await mockFull.work!(args[0] ?? 'default')
    })
    artisan.command('queue:status', async (args) => {
      await mockFull.status!(args[0] ?? 'default')
    })
    artisan.command('queue:clear', async (args) => {
      await mockFull.flush!(args[0] ?? 'default')
    })
    artisan.command('queue:failed', async (args) => {
      await mockFull.failures!(args[0] ?? 'default')
    })
    artisan.command('queue:retry', async (args) => {
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
