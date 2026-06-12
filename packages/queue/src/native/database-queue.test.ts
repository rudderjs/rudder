// Integration tests for the native database-backed queue driver, exercised
// against a REAL in-memory native SQLite engine (@rudderjs/orm/native) injected
// via config.adapter. Hermetic: each test gets a fresh :memory: database.
//
// If @rudderjs/orm isn't built or better-sqlite3 can't load, the suite skips
// rather than failing (build-order resilience).

import test from 'node:test'
import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rmSync } from 'node:fs'
import { Job } from '../index.js'
import { database } from './adapter.js'

// ── module-level observation hooks (jobs are reconstructed fresh) ──
let ran: string[] = []
let failedWith: unknown[] = []

class OkJob extends Job {
  static override queue = 'default'
  static override retries = 1
  label = ''
  handle(): void { ran.push(`ok:${this.label}`) }
}

class BoomJob extends Job {
  static override retries = 2
  handle(): void { ran.push('boom'); throw new Error('kaboom') }
  override failed(err: unknown): void { failedWith.push(err) }
}

// ── setup: fresh in-memory native engine + queue tables ──
// Loosely typed — the native adapter satisfies the driver's structural needs at
// runtime; the test asserts behavior, not types.
/* eslint-disable @typescript-eslint/no-explicit-any */
async function setup(): Promise<any> {
  const { NativeAdapter } = await import('@rudderjs/orm/native')
  const adapter = await NativeAdapter.make({ driver: 'sqlite', url: ':memory:' })
  const sb = adapter.schemaBuilder()
  await sb.create('jobs', (t: any) => {
    t.id(); t.string('queue').index(); t.text('payload')
    t.integer('attempts').default(0); t.integer('reserved_at').nullable()
    t.integer('available_at'); t.integer('created_at')
  })
  await sb.create('failed_jobs', (t: any) => {
    t.id(); t.string('uuid').unique(); t.text('connection'); t.text('queue')
    t.text('payload'); t.text('exception'); t.integer('failed_at')
  })
  return adapter
}

// Probe once so the whole suite can skip cleanly if the engine is unavailable.
let available = true
try {
  const a = await setup()
  await a.disconnect?.()
} catch {
  available = false
}

function reset(): void { ran = []; failedWith = [] }

test('dispatch → work(stopWhenEmpty) runs the job and removes it', { skip: !available }, async () => {
  reset()
  const adapter = await setup()
  const q = database({ adapter, jobs: [OkJob] }).create()

  const job = new OkJob(); job.label = 'a'
  await q.dispatch(job, { queue: 'default' })

  assert.equal(await adapter.query('jobs').where('queue', 'default').count(), 1)

  await q.work!('default', { stopWhenEmpty: true })

  assert.deepEqual(ran, ['ok:a'])
  assert.equal(await adapter.query('jobs').where('queue', 'default').count(), 0)
  await adapter.disconnect?.()
})

test('delayed dispatch is not run until due (shows as delayed)', { skip: !available }, async () => {
  reset()
  const adapter = await setup()
  const q = database({ adapter, jobs: [OkJob] }).create()

  const job = new OkJob(); job.label = 'later'
  await q.dispatch(job, { queue: 'default', delay: 60_000 })

  const stats = await q.status!('default')
  assert.equal(stats.delayed, 1)
  assert.equal(stats.waiting, 0)

  await q.work!('default', { stopWhenEmpty: true })
  assert.deepEqual(ran, [])                      // not due → never reserved
  assert.equal(await adapter.query('jobs').where('queue', 'default').count(), 1)
  await adapter.disconnect?.()
})

test('failing job retries up to maxTries, then lands in failed_jobs (failed() once)', { skip: !available }, async () => {
  reset()
  const adapter = await setup()
  const q = database({ adapter, jobs: [BoomJob] }).create()

  await q.dispatch(new BoomJob(), { queue: 'default' })

  // backoff 0 → released job is immediately due again, so stopWhenEmpty drains
  // all attempts to terminal in one worker pass.
  await q.work!('default', { stopWhenEmpty: true, backoff: 0 })

  assert.equal(ran.length, 2, 'handle attempted exactly maxTries (2) times')
  assert.equal(failedWith.length, 1, 'failed() invoked exactly once, on terminal failure')
  assert.equal(await adapter.query('jobs').where('queue', 'default').count(), 0)
  assert.equal(await adapter.query('failed_jobs').where('queue', 'default').count(), 1)
  await adapter.disconnect?.()
})

test('failures() lists failed jobs and retryFailed() re-enqueues them', { skip: !available }, async () => {
  reset()
  const adapter = await setup()
  const q = database({ adapter, jobs: [BoomJob] }).create()

  await q.dispatch(new BoomJob(), { queue: 'default' })
  await q.work!('default', { stopWhenEmpty: true, backoff: 0 })

  const failures = await q.failures!('default')
  assert.equal(failures.length, 1)
  assert.equal(failures[0]!.name, 'BoomJob')
  assert.match(failures[0]!.error, /kaboom/)

  const requeued = await q.retryFailed!('default')
  assert.equal(requeued, 1)
  assert.equal(await adapter.query('jobs').where('queue', 'default').count(), 1)
  assert.equal(await adapter.query('failed_jobs').where('queue', 'default').count(), 0)
  await adapter.disconnect?.()
})

test('retryFailed() re-enqueues each job inside a per-job transaction (atomic)', { skip: !available }, async () => {
  reset()
  const real = await setup()

  // Spy adapter: delegates to the real native engine but counts transaction()
  // calls and any create() issued on the OUTER (non-transactional) adapter.
  // The fix runs the re-enqueue + failed-row delete inside adapter.transaction()
  // per job, so during retryFailed outerCreate must stay 0 and txCount must
  // equal the number of failed jobs. Without it, the create() lands on the
  // outer adapter and no transaction is opened.
  let txCount = 0
  let outerCreate = 0
  const spy: any = {
    query(table: string) {
      const qb = real.query(table)
      return new Proxy(qb, {
        get(t: any, p: string) {
          if (p === 'create') return async (d: unknown) => { outerCreate++; return t.create(d) }
          const v = t[p]
          return typeof v === 'function' ? v.bind(t) : v
        },
      })
    },
    transaction(fn: (tx: unknown) => Promise<unknown>) { txCount++; return real.transaction(fn) },
    schemaBuilder: () => real.schemaBuilder(),
    disconnect: () => real.disconnect?.(),
  }

  const q = database({ adapter: spy, jobs: [BoomJob] }).create()

  // Drive two jobs to failure.
  await q.dispatch(new BoomJob(), { queue: 'default' })
  await q.dispatch(new BoomJob(), { queue: 'default' })
  await q.work!('default', { stopWhenEmpty: true, backoff: 0 })
  assert.equal(await real.query('failed_jobs').where('queue', 'default').count(), 2)

  // Only count what retryFailed itself does.
  txCount = 0
  outerCreate = 0
  const requeued = await q.retryFailed!('default')

  assert.equal(requeued, 2)
  assert.equal(txCount, 2, 'one transaction per failed job')
  assert.equal(outerCreate, 0, 're-enqueue must happen inside the transaction, not on the outer adapter')
  assert.equal(await real.query('jobs').where('queue', 'default').count(), 2)
  assert.equal(await real.query('failed_jobs').where('queue', 'default').count(), 0)
  await real.disconnect?.()
})

test('queue priority: higher-priority queue drains first', { skip: !available }, async () => {
  reset()
  const adapter = await setup()
  const q = database({ adapter, jobs: [OkJob] }).create()

  const low = new OkJob();  low.label  = 'low'
  const high = new OkJob(); high.label = 'high'
  await q.dispatch(low,  { queue: 'low' })
  await q.dispatch(high, { queue: 'high' })

  await q.work!('high,low', { stopWhenEmpty: true })

  assert.deepEqual(ran, ['ok:high', 'ok:low'])
  await adapter.disconnect?.()
})

test('dedicated engine connection auto-creates its own tables', { skip: !available }, async () => {
  reset()
  const file = join(tmpdir(), `rudder-queue-${process.pid}-${ran.length}.db`)
  rmSync(file, { force: true })
  // No injected adapter, no pre-created tables — the driver opens its own native
  // SQLite engine and ensures jobs/failed_jobs exist on first use.
  const q = database({ engine: 'sqlite', url: file, jobs: [OkJob] }).create()
  try {
    const job = new OkJob(); job.label = 'owned'
    await q.dispatch(job, { queue: 'default' })
    await q.work!('default', { stopWhenEmpty: true })
    assert.deepEqual(ran, ['ok:owned'])
  } finally {
    await q.disconnect?.()
    rmSync(file, { force: true })
    rmSync(`${file}-shm`, { force: true })
    rmSync(`${file}-wal`, { force: true })
  }
})

test('reservation locks with { skipLocked: true } (concurrent workers never queue on one row)', async () => {
  // A recording fake pins the lock arguments — the real engines no-op the lock
  // on SQLite, so the option is not observable through the e2e suite above.
  // Runs even when the native engine is unavailable (no `available` skip).
  const lockCalls: unknown[] = []
  function makeQb(): any {
    const qb: any = {}
    for (const m of ['where', 'whereGroup', 'orWhere', 'orderBy', 'limit']) qb[m] = () => qb
    qb.lockForUpdate = (...args: unknown[]) => { lockCalls.push(args[0] ?? null); return qb }
    qb.get = async () => []   // no runnable job → stopWhenEmpty exits after one pass
    qb.count = async () => 0
    qb.create = async (d: unknown) => d
    qb.updateAll = async () => 0
    qb.deleteAll = async () => 0
    return qb
  }
  const fake: any = {
    query: () => makeQb(),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(fake),
  }
  const q = database({ adapter: fake, jobs: [OkJob] }).create()
  await q.work!('default', { stopWhenEmpty: true })
  assert.deepEqual(lockCalls, [{ skipLocked: true }])
})
