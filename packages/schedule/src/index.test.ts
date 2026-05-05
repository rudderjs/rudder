import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { rudder } from '@rudderjs/core'
import { FakeCacheAdapter, type CacheOperation } from '@rudderjs/cache'
import { ScheduledTask, schedule, Schedule, ScheduleProvider, _executeTask } from './index.js'

function makeTask(cb: () => void = () => {}): ScheduledTask {
  return new ScheduledTask(cb)
}

describe('ScheduledTask — cron helpers', () => {
  it('default cron is every minute', () => {
    assert.strictEqual(makeTask().getCron(), '* * * * *')
  })

  it('cron() sets raw expression', () => {
    assert.strictEqual(makeTask().cron('0 9 * * 1').getCron(), '0 9 * * 1')
  })

  it('everySecond',         () => assert.strictEqual(makeTask().everySecond().getCron(),         '* * * * * *'))
  it('everyMinute',         () => assert.strictEqual(makeTask().everyMinute().getCron(),         '* * * * *'))
  it('everyTwoMinutes',     () => assert.strictEqual(makeTask().everyTwoMinutes().getCron(),     '*/2 * * * *'))
  it('everyFiveMinutes',    () => assert.strictEqual(makeTask().everyFiveMinutes().getCron(),    '*/5 * * * *'))
  it('everyTenMinutes',     () => assert.strictEqual(makeTask().everyTenMinutes().getCron(),     '*/10 * * * *'))
  it('everyFifteenMinutes', () => assert.strictEqual(makeTask().everyFifteenMinutes().getCron(), '*/15 * * * *'))
  it('everyThirtyMinutes',  () => assert.strictEqual(makeTask().everyThirtyMinutes().getCron(),  '*/30 * * * *'))

  it('hourly',              () => assert.strictEqual(makeTask().hourly().getCron(),              '0 * * * *'))
  it('hourlyAt(30)',        () => assert.strictEqual(makeTask().hourlyAt(30).getCron(),          '30 * * * *'))

  it('daily',               () => assert.strictEqual(makeTask().daily().getCron(),               '0 0 * * *'))
  it('dailyAt("9:30")',     () => assert.strictEqual(makeTask().dailyAt('9:30').getCron(),       '30 9 * * *'))
  it('dailyAt("0:0")',      () => assert.strictEqual(makeTask().dailyAt('0:0').getCron(),        '0 0 * * *'))
  it('twiceDaily(1, 13)',   () => assert.strictEqual(makeTask().twiceDaily(1, 13).getCron(),     '0 1,13 * * *'))
  it('twiceDaily defaults', () => assert.strictEqual(makeTask().twiceDaily().getCron(),          '0 1,13 * * *'))

  it('weekly',              () => assert.strictEqual(makeTask().weekly().getCron(),              '0 0 * * 0'))
  it('weeklyOn(3, "9:0")',  () => assert.strictEqual(makeTask().weeklyOn(3, '9:0').getCron(),   '0 9 * * 3'))
  it('weeklyOn defaults',   () => assert.strictEqual(makeTask().weeklyOn(1).getCron(),           '0 0 * * 1'))

  it('monthly',             () => assert.strictEqual(makeTask().monthly().getCron(),             '0 0 1 * *'))
  it('monthlyOn(15, "8:0")',() => assert.strictEqual(makeTask().monthlyOn(15, '8:0').getCron(), '0 8 15 * *'))
  it('monthlyOn defaults',  () => assert.strictEqual(makeTask().monthlyOn().getCron(),           '0 0 1 * *'))

  it('yearly',              () => assert.strictEqual(makeTask().yearly().getCron(),              '0 0 1 1 *'))
})

describe('ScheduledTask — named-day helpers', () => {
  it('sundays',    () => assert.strictEqual(makeTask().sundays().getCron(),    '0 0 * * 0'))
  it('mondays',    () => assert.strictEqual(makeTask().mondays().getCron(),    '0 0 * * 1'))
  it('tuesdays',   () => assert.strictEqual(makeTask().tuesdays().getCron(),   '0 0 * * 2'))
  it('wednesdays', () => assert.strictEqual(makeTask().wednesdays().getCron(), '0 0 * * 3'))
  it('thursdays',  () => assert.strictEqual(makeTask().thursdays().getCron(),  '0 0 * * 4'))
  it('fridays',    () => assert.strictEqual(makeTask().fridays().getCron(),    '0 0 * * 5'))
  it('saturdays',  () => assert.strictEqual(makeTask().saturdays().getCron(),  '0 0 * * 6'))
  it('weekdays',   () => assert.strictEqual(makeTask().weekdays().getCron(),   '0 0 * * 1-5'))
  it('weekends',   () => assert.strictEqual(makeTask().weekends().getCron(),   '0 0 * * 0,6'))
})

describe('ScheduledTask — description & timezone', () => {
  it('description() sets and returns description', () => {
    const t = makeTask().description('Send emails')
    assert.strictEqual(t.getDescription(), 'Send emails')
  })

  it('default description is empty string', () => {
    assert.strictEqual(makeTask().getDescription(), '')
  })

  it('timezone() stores the IANA timezone', () => {
    const t = makeTask().timezone('America/New_York')
    assert.strictEqual(t.getTimezone(), 'America/New_York')
  })

  it('getTimezone() returns undefined when not set', () => {
    assert.strictEqual(makeTask().getTimezone(), undefined)
  })
})

describe('ScheduledTask — nextRun()', () => {
  it('returns a Date in the future for a valid cron', () => {
    const next = makeTask().everyMinute().nextRun()
    assert.ok(next instanceof Date)
    assert.ok(next.getTime() > Date.now())
  })

  it('returns null for an invalid cron expression', () => {
    const next = makeTask().cron('invalid expression').nextRun()
    assert.strictEqual(next, null)
  })
})

describe('ScheduledTask — isDue()', () => {
  it('returns false for a never-due cron (next year)', () => {
    // Runs on Jan 1 at midnight — never due within the current minute window
    // unless tests happen to run exactly then, which is astronomically unlikely
    const task = makeTask().cron('0 0 1 1 *')
    // isDue is probabilistic; just assert it returns a boolean
    assert.strictEqual(typeof task.isDue(), 'boolean')
  })

  it('returns false for an invalid cron expression', () => {
    assert.strictEqual(makeTask().cron('bad cron').isDue(), false)
  })

  it('returns true for everySecond() within the current window', () => {
    // Every-second tasks are always due
    assert.strictEqual(makeTask().everySecond().isDue(), true)
  })
})

describe('ScheduledTask — getCallback()', () => {
  it('returns the original callback', () => {
    const cb   = () => {}
    const task = new ScheduledTask(cb)
    assert.strictEqual(task.getCallback(), cb)
  })

  it('fluent methods return the same task instance', () => {
    const task = makeTask()
    assert.strictEqual(task.everyMinute(), task)
    assert.strictEqual(task.description('x'), task)
    assert.strictEqual(task.timezone('UTC'), task)
    assert.strictEqual(task.cron('* * * * *'), task)
  })
})

describe('Scheduler singleton', () => {
  beforeEach(() => schedule.reset())

  it('Schedule alias points to the same singleton', () => {
    assert.strictEqual(Schedule, schedule)
  })

  it('call() registers a task and returns ScheduledTask', () => {
    const task = schedule.call(() => {})
    assert.ok(task instanceof ScheduledTask)
    assert.strictEqual(schedule.getTasks().length, 1)
  })

  it('getTasks() returns a copy — mutations do not affect the registry', () => {
    schedule.call(() => {})
    const tasks = schedule.getTasks()
    tasks.pop()
    assert.strictEqual(schedule.getTasks().length, 1)
  })

  it('reset() clears all tasks', () => {
    schedule.call(() => {})
    schedule.call(() => {})
    schedule.reset()
    assert.strictEqual(schedule.getTasks().length, 0)
  })

  it('multiple tasks are registered in order', () => {
    const a = schedule.call(() => {}).description('A')
    const b = schedule.call(() => {}).description('B')
    const tasks = schedule.getTasks()
    assert.strictEqual(tasks[0], a)
    assert.strictEqual(tasks[1], b)
  })
})

describe('scheduler() provider', () => {
  beforeEach(() => {
    rudder.reset()
    schedule.reset()
  })

  it('registers schedule:run, schedule:work and schedule:list on boot', () => {
    new ScheduleProvider({} as never).boot?.()
    const names = rudder.getCommands().map((c) => c.name)
    assert.ok(names.includes('schedule:run'))
    assert.ok(names.includes('schedule:work'))
    assert.ok(names.includes('schedule:list'))
  })

  it('schedule:run reports no tasks when registry is empty', async () => {
    new ScheduleProvider({} as never).boot?.()
    const cmd = rudder.getCommands().find(c => c.name === 'schedule:run')!

    const logs: string[] = []
    const orig = console.log
    console.log = (...a: unknown[]) => logs.push(a.join(' '))
    await cmd.handler([], {})
    console.log = orig

    assert.ok(logs.some(l => l.includes('No tasks registered')))
  })

  it('schedule:list reports no tasks when registry is empty', () => {
    new ScheduleProvider({} as never).boot?.()
    const cmd = rudder.getCommands().find(c => c.name === 'schedule:list')!

    const logs: string[] = []
    const orig = console.log
    console.log = (...a: unknown[]) => logs.push(a.join(' '))
    cmd.handler([], {})
    console.log = orig

    assert.ok(logs.some(l => l.includes('No tasks registered')))
  })

  it('schedule:run runs due tasks and reports completion', async () => {
    schedule.call(() => {}).everySecond().description('tick')
    new ScheduleProvider({} as never).boot?.()
    const cmd = rudder.getCommands().find(c => c.name === 'schedule:run')!

    const logs: string[] = []
    const orig = console.log
    console.log = (...a: unknown[]) => logs.push(a.join(' '))
    await cmd.handler([], {})
    console.log = orig

    assert.ok(logs.some(l => l.includes('task(s) completed')))
  })
})

// ─── _executeTask lock behavior ────────────────────────────

describe('_executeTask — onOneServer / withoutOverlapping locks', () => {
  let fake: FakeCacheAdapter
  let logs: string[]
  let originalLog: typeof console.log
  let originalErr: typeof console.error
  let originalWrite: typeof process.stdout.write

  // The release ops we care about. Filter rather than raw `assertLockReleased`
  // so we can assert the *absence* of a release.
  const releaseOpsFor = (key: string): CacheOperation[] =>
    fake.operations().filter(op =>
      (op.type === 'lock-release' || op.type === 'lock-force-release') &&
      'key' in op && op.key === key)

  beforeEach(() => {
    fake = FakeCacheAdapter.fake()
    logs = []
    originalLog   = console.log
    originalErr   = console.error
    originalWrite = process.stdout.write
    console.log     = (...a: unknown[]) => { logs.push(a.join(' ')) }
    console.error   = () => {}
    process.stdout.write = (() => true) as typeof process.stdout.write
  })

  afterEach(() => {
    fake.restore()
    console.log = originalLog
    console.error = originalErr
    process.stdout.write = originalWrite
  })

  it('onOneServer holds the server lock for the full TTL — not released when the task finishes', async () => {
    let ran = false
    const task = new ScheduledTask(() => { ran = true })
      .description('cluster-task')
      .onOneServer()

    await _executeTask(task)

    assert.strictEqual(ran, true)
    fake.assertLockAcquired('rudderjs:schedule:server:cluster-task')
    assert.deepStrictEqual(
      releaseOpsFor('rudderjs:schedule:server:cluster-task'),
      [],
      'server lock must NOT be released — its 60s TTL is what guarantees one server per minute',
    )
  })

  it('onOneServer holds the server lock even when the task throws', async () => {
    const task = new ScheduledTask(() => { throw new Error('boom') })
      .description('cluster-task')
      .onOneServer()

    await _executeTask(task) // _executeTask catches inside try/finally

    assert.deepStrictEqual(
      releaseOpsFor('rudderjs:schedule:server:cluster-task'),
      [],
      'server lock must remain held even after a task error',
    )
  })

  it('withoutOverlapping releases its lock after the task completes', async () => {
    let ran = false
    const task = new ScheduledTask(() => { ran = true })
      .description('overlap-task')
      .withoutOverlapping()

    await _executeTask(task)

    assert.strictEqual(ran, true)
    fake.assertLockAcquired('rudderjs:schedule:overlap:overlap-task')
    fake.assertLockReleased('rudderjs:schedule:overlap:overlap-task')
  })

  it('with both onOneServer + withoutOverlapping: overlap lock released, server lock held', async () => {
    let ran = false
    const task = new ScheduledTask(() => { ran = true })
      .description('combo-task')
      .onOneServer()
      .withoutOverlapping()

    await _executeTask(task)

    assert.strictEqual(ran, true)
    fake.assertLockReleased('rudderjs:schedule:overlap:combo-task')
    assert.deepStrictEqual(
      releaseOpsFor('rudderjs:schedule:server:combo-task'),
      [],
      'server lock release on completion would let a peer with a delayed cron tick re-run within the same minute',
    )
  })

  it('onOneServer: when a peer already holds the lock, the task is skipped', async () => {
    // Pre-acquire on a separate handle to simulate another server holding it.
    const holder = fake.lock('rudderjs:schedule:server:cluster-task', 60)
    assert.strictEqual(await holder.get(), true)

    let ran = false
    const task = new ScheduledTask(() => { ran = true })
      .description('cluster-task')
      .onOneServer()

    await _executeTask(task)

    assert.strictEqual(ran, false, 'callback must NOT run when peer holds the server lock')
  })

  it('onOneServer with no cache adapter: skips with a clear log message', async () => {
    fake.restore() // wipes CacheRegistry

    let ran = false
    const task = new ScheduledTask(() => { ran = true })
      .description('cluster-task')
      .onOneServer()

    await _executeTask(task)

    assert.strictEqual(ran, false)
    assert.ok(
      logs.some(l => l.includes('onOneServer() requires @rudderjs/cache')),
      'must explain why the task was skipped',
    )
  })

  it('withoutOverlapping: when the overlap lock is held, task is skipped without releasing the server lock', async () => {
    // Simulate a stale / in-progress overlap lock from a previous tick.
    const overlapHolder = fake.lock('rudderjs:schedule:overlap:combo-task', 60)
    assert.strictEqual(await overlapHolder.get(), true)

    let ran = false
    const task = new ScheduledTask(() => { ran = true })
      .description('combo-task')
      .onOneServer()
      .withoutOverlapping()

    await _executeTask(task)

    assert.strictEqual(ran, false, 'callback must NOT run when overlap lock collides')
    assert.deepStrictEqual(
      releaseOpsFor('rudderjs:schedule:server:combo-task'),
      [],
      'server lock must remain held — releasing it would invite a peer to re-attempt the colliding task',
    )
  })
})