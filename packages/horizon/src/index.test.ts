import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { MemoryStorage, HorizonRegistry, Horizon } from './index.js'
import type { HorizonJob, QueueMetric, WorkerInfo } from './types.js'

// ─── Helpers ──────────────────────────────────────────────

function makeJob(overrides?: Partial<HorizonJob>): HorizonJob {
  return {
    id:           `job-${Math.random().toString(36).slice(2, 8)}`,
    name:         'SendEmail',
    queue:        'default',
    status:       'completed',
    payload:      { to: 'user@test.com' },
    attempts:     1,
    exception:    null,
    dispatchedAt: new Date(),
    startedAt:    new Date(),
    completedAt:  new Date(),
    duration:     150,
    tags:         ['mail'],
    ...overrides,
  }
}

function makeMetric(overrides?: Partial<QueueMetric>): QueueMetric {
  return {
    queue:      'default',
    throughput: 10,
    waitTime:   50,
    runtime:    200,
    pending:    5,
    active:     2,
    completed:  100,
    failed:     3,
    ...overrides,
  }
}

function makeWorker(overrides?: Partial<WorkerInfo>): WorkerInfo {
  return {
    id:        `worker-${Math.random().toString(36).slice(2, 8)}`,
    queue:     'default',
    status:    'active',
    jobsRun:   42,
    memoryMb:  128,
    startedAt: new Date(),
    lastJobAt: new Date(),
    ...overrides,
  }
}

// ─── MemoryStorage ────────────────────────────────────────

describe('MemoryStorage', () => {
  let storage: MemoryStorage

  beforeEach(() => {
    storage = new MemoryStorage(100)
  })

  // Jobs

  it('records and finds a job', () => {
    const job = makeJob({ id: 'j1' })
    storage.recordJob(job)

    const found = storage.findJob('default', 'j1')
    assert.ok(found)
    assert.equal(found.id, 'j1')
    assert.equal(found.name, 'SendEmail')
  })

  it('returns null for missing job', () => {
    assert.equal(storage.findJob('default', 'nonexistent'), null)
  })

  it('updates a job', () => {
    const job = makeJob({ id: 'j2', status: 'pending' })
    storage.recordJob(job)
    storage.updateJob('default', 'j2', { status: 'completed', duration: 200 })

    const found = storage.findJob('default', 'j2')
    assert.equal(found!.status, 'completed')
    assert.equal(found!.duration, 200)
  })

  it('keys jobs by (queue, id) — same id on different queues coexists', () => {
    storage.recordJob(makeJob({ id: '1', queue: 'default',  name: 'AliceJob' }))
    storage.recordJob(makeJob({ id: '1', queue: 'priority', name: 'VipJob' }))

    assert.equal(storage.findJob('default',  '1')!.name, 'AliceJob')
    assert.equal(storage.findJob('priority', '1')!.name, 'VipJob')
    assert.equal(storage.jobCount(), 2)
  })

  it('recentJobs returns all jobs', () => {
    storage.recordJob(makeJob({ id: 'a' }))
    storage.recordJob(makeJob({ id: 'b' }))

    const jobs = storage.recentJobs()
    assert.equal(jobs.length, 2)
  })

  it('failedJobs filters by status', () => {
    storage.recordJob(makeJob({ id: 'ok', status: 'completed' }))
    storage.recordJob(makeJob({ id: 'fail', status: 'failed' }))

    const failed = storage.failedJobs()
    assert.equal(failed.length, 1)
    assert.equal(failed[0]!.id, 'fail')
  })

  it('filters by queue', () => {
    storage.recordJob(makeJob({ id: 'a', queue: 'emails' }))
    storage.recordJob(makeJob({ id: 'b', queue: 'default' }))

    const jobs = storage.recentJobs({ queue: 'emails' })
    assert.equal(jobs.length, 1)
    assert.equal(jobs[0]!.queue, 'emails')
  })

  it('filters by search', () => {
    storage.recordJob(makeJob({ id: 'a', name: 'SendEmail' }))
    storage.recordJob(makeJob({ id: 'b', name: 'ProcessPayment' }))

    const jobs = storage.recentJobs({ search: 'email' })
    assert.equal(jobs.length, 1)
    assert.equal(jobs[0]!.name, 'SendEmail')
  })

  it('paginates results', () => {
    for (let i = 0; i < 10; i++) {
      storage.recordJob(makeJob({ id: `j${i}` }))
    }

    const page1 = storage.recentJobs({ page: 1, perPage: 3 })
    const page2 = storage.recentJobs({ page: 2, perPage: 3 })

    assert.equal(page1.length, 3)
    assert.equal(page2.length, 3)
  })

  it('respects maxJobs limit', () => {
    const small = new MemoryStorage(3)
    for (let i = 0; i < 5; i++) {
      small.recordJob(makeJob({ id: `j${i}` }))
    }
    assert.equal(small.jobCount(), 3)
  })

  it('deletes a job', () => {
    storage.recordJob(makeJob({ id: 'del' }))
    assert.ok(storage.findJob('default', 'del'))

    storage.deleteJob('default', 'del')
    assert.equal(storage.findJob('default', 'del'), null)
  })

  it('jobCount returns total and by status', () => {
    storage.recordJob(makeJob({ status: 'completed' }))
    storage.recordJob(makeJob({ status: 'completed' }))
    storage.recordJob(makeJob({ status: 'failed' }))

    assert.equal(storage.jobCount(), 3)
    assert.equal(storage.jobCount('completed'), 2)
    assert.equal(storage.jobCount('failed'), 1)
  })

  // Metrics

  it('records and retrieves current metrics', () => {
    storage.recordMetric(makeMetric({ queue: 'emails' }))
    storage.recordMetric(makeMetric({ queue: 'default' }))

    const current = storage.currentMetrics()
    assert.equal(current.length, 2)
  })

  it('records metric history', () => {
    storage.recordMetric(makeMetric({ queue: 'default', throughput: 10 }))
    storage.recordMetric(makeMetric({ queue: 'default', throughput: 20 }))

    const history = storage.metrics('default', new Date(0))
    assert.equal(history.length, 2)
  })

  // Workers

  it('records and retrieves workers', () => {
    storage.recordWorker(makeWorker({ id: 'w1' }))
    storage.recordWorker(makeWorker({ id: 'w2' }))

    const workers = storage.workers()
    assert.equal(workers.length, 2)
  })

  it('updates existing worker', () => {
    storage.recordWorker(makeWorker({ id: 'w1', jobsRun: 10 }))
    storage.recordWorker(makeWorker({ id: 'w1', jobsRun: 20 }))

    const workers = storage.workers()
    assert.equal(workers.length, 1)
    assert.equal(workers[0]!.jobsRun, 20)
  })

  // Pruning

  it('prunes jobs older than a date', () => {
    const old = new Date(Date.now() - 100_000)
    const recent = new Date()

    storage.recordJob(makeJob({ id: 'old', dispatchedAt: old }))
    storage.recordJob(makeJob({ id: 'new', dispatchedAt: recent }))

    storage.pruneOlderThan(new Date(Date.now() - 50_000))

    assert.equal(storage.findJob('default', 'old'), null)
    assert.ok(storage.findJob('default', 'new'))
  })
})

// ─── HorizonRegistry ─────────────────────────────────────

describe('HorizonRegistry', () => {
  beforeEach(() => {
    HorizonRegistry.reset()
  })

  it('starts with null', () => {
    assert.equal(HorizonRegistry.get(), null)
  })

  it('set and get round-trips', () => {
    const storage = new MemoryStorage()
    HorizonRegistry.set(storage)
    assert.strictEqual(HorizonRegistry.get(), storage)
  })

  it('reset clears storage', () => {
    HorizonRegistry.set(new MemoryStorage())
    HorizonRegistry.reset()
    assert.equal(HorizonRegistry.get(), null)
  })
})

// ─── Horizon Facade ───────────────────────────────────────

describe('Horizon facade', () => {
  beforeEach(() => {
    HorizonRegistry.reset()
  })

  it('throws when no storage registered', () => {
    assert.throws(() => Horizon.recentJobs(), /No storage registered/)
  })

  it('delegates to storage', () => {
    const storage = new MemoryStorage()
    storage.recordJob(makeJob({ id: 'test' }))
    HorizonRegistry.set(storage)

    const jobs = Horizon.recentJobs() as HorizonJob[]
    assert.equal(jobs.length, 1)
    assert.equal(jobs[0]!.id, 'test')
  })

  it('currentMetrics returns metrics', () => {
    const storage = new MemoryStorage()
    storage.recordMetric(makeMetric())
    HorizonRegistry.set(storage)

    const metrics = Horizon.currentMetrics() as QueueMetric[]
    assert.equal(metrics.length, 1)
  })

  it('workers returns worker list', () => {
    const storage = new MemoryStorage()
    storage.recordWorker(makeWorker())
    HorizonRegistry.set(storage)

    const workers = Horizon.workers() as WorkerInfo[]
    assert.equal(workers.length, 1)
  })

  it('jobCount returns count', () => {
    const storage = new MemoryStorage()
    storage.recordJob(makeJob())
    storage.recordJob(makeJob())
    HorizonRegistry.set(storage)

    assert.equal(Horizon.jobCount() as number, 2)
  })
})
