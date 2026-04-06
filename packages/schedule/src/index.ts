import { ServiceProvider, rudder, type Application } from '@rudderjs/core'
import { Cron } from 'croner'

// ─── Scheduled Task ────────────────────────────────────────

export class ScheduledTask {
  private _cron        = '* * * * *'
  private _description = ''
  private _timezone?:  string

  // ── Hooks (3.7) ───────────────────────────────────────
  private _beforeFn?:    () => void | Promise<void>
  private _afterFn?:     () => void | Promise<void>
  private _onSuccessFn?: () => void | Promise<void>
  private _onFailureFn?: (error: unknown) => void | Promise<void>
  private _withoutOverlapping   = false
  private _overlapExpiresAt     = 1440 // minutes (24h default)
  private _overlapKey?:         string
  private _evenInMaintenance    = false
  private _oneServer            = false

  constructor(private readonly callback: () => void | Promise<void>) {}

  // ── Cron ───────────────────────────────────────────────

  /** Set a raw cron expression (5 or 6-field) */
  cron(expression: string): this { this._cron = expression; return this }

  /** Set the IANA timezone for this task (e.g. 'America/New_York', 'UTC') */
  timezone(tz: string): this { this._timezone = tz; return this }

  // ── Sub-minute ─────────────────────────────────────────
  everySecond(): this          { return this.cron('* * * * * *') }
  everyFiveSeconds(): this     { return this.cron('*/5 * * * * *') }
  everyTenSeconds(): this      { return this.cron('*/10 * * * * *') }
  everyFifteenSeconds(): this  { return this.cron('*/15 * * * * *') }
  everyTwentySeconds(): this   { return this.cron('*/20 * * * * *') }
  everyThirtySeconds(): this   { return this.cron('*/30 * * * * *') }

  // ── Minute helpers ─────────────────────────────────────
  everyMinute(): this         { return this.cron('* * * * *') }
  everyTwoMinutes(): this     { return this.cron('*/2 * * * *') }
  everyFiveMinutes(): this    { return this.cron('*/5 * * * *') }
  everyTenMinutes(): this     { return this.cron('*/10 * * * *') }
  everyFifteenMinutes(): this { return this.cron('*/15 * * * *') }
  everyThirtyMinutes(): this  { return this.cron('*/30 * * * *') }

  // ── Hour helpers ───────────────────────────────────────
  hourly(): this                 { return this.cron('0 * * * *') }
  hourlyAt(minute: number): this { return this.cron(`${minute} * * * *`) }

  // ── Day helpers ────────────────────────────────────────
  daily(): this                      { return this.cron('0 0 * * *') }
  dailyAt(time: string): this {
    const [h = '0', m = '0'] = time.split(':')
    return this.cron(`${m} ${h} * * *`)
  }
  twiceDaily(h1 = 1, h2 = 13): this { return this.cron(`0 ${h1},${h2} * * *`) }

  // ── Named-day helpers ──────────────────────────────────
  sundays(): this    { return this.cron('0 0 * * 0') }
  mondays(): this    { return this.cron('0 0 * * 1') }
  tuesdays(): this   { return this.cron('0 0 * * 2') }
  wednesdays(): this { return this.cron('0 0 * * 3') }
  thursdays(): this  { return this.cron('0 0 * * 4') }
  fridays(): this    { return this.cron('0 0 * * 5') }
  saturdays(): this  { return this.cron('0 0 * * 6') }
  weekdays(): this   { return this.cron('0 0 * * 1-5') }
  weekends(): this   { return this.cron('0 0 * * 0,6') }

  // ── Week helpers ───────────────────────────────────────
  weekly(): this                            { return this.cron('0 0 * * 0') }
  weeklyOn(day: number, time = '0:0'): this {
    const [h = '0', m = '0'] = time.split(':')
    return this.cron(`${m} ${h} * * ${day}`)
  }

  // ── Month helpers ──────────────────────────────────────
  monthly(): this                        { return this.cron('0 0 1 * *') }
  monthlyOn(day = 1, time = '0:0'): this {
    const [h = '0', m = '0'] = time.split(':')
    return this.cron(`${m} ${h} ${day} * *`)
  }

  yearly(): this { return this.cron('0 0 1 1 *') }

  description(desc: string): this { this._description = desc; return this }

  // ── Hooks ──────────────────────────────────────────────

  /** Run a callback before the task executes. */
  before(fn: () => void | Promise<void>): this { this._beforeFn = fn; return this }

  /** Run a callback after the task executes (success or failure). */
  after(fn: () => void | Promise<void>): this { this._afterFn = fn; return this }

  /** Run a callback only when the task succeeds. */
  onSuccess(fn: () => void | Promise<void>): this { this._onSuccessFn = fn; return this }

  /** Run a callback only when the task fails. Receives the error. */
  onFailure(fn: (error: unknown) => void | Promise<void>): this { this._onFailureFn = fn; return this }

  /**
   * Prevent overlapping executions. If the task is already running,
   * skip this invocation. Uses a cache lock with the given expiry.
   *
   * @param expiresAt — lock expiry in minutes (default 24 hours)
   */
  withoutOverlapping(expiresAt = 1440): this {
    this._withoutOverlapping = true
    this._overlapExpiresAt   = expiresAt
    this._overlapKey         = `rudderjs:schedule:overlap:${this._description || this._cron}`
    return this
  }

  /** Run this task even when the application is in maintenance mode. */
  evenInMaintenanceMode(): this { this._evenInMaintenance = true; return this }

  /**
   * Only run this task on a single server in a multi-server deployment.
   * Uses a cache-backed distributed lock. Requires `@rudderjs/cache`.
   */
  onOneServer(): this { this._oneServer = true; return this }

  // ── Accessors ──────────────────────────────────────────
  getCron(): string              { return this._cron }
  getTimezone(): string | undefined { return this._timezone }
  getDescription(): string       { return this._description }
  getCallback(): () => void | Promise<void> { return this.callback }
  getBeforeFn(): (() => void | Promise<void>) | undefined { return this._beforeFn }
  getAfterFn(): (() => void | Promise<void>) | undefined { return this._afterFn }
  getOnSuccessFn(): (() => void | Promise<void>) | undefined { return this._onSuccessFn }
  getOnFailureFn(): ((error: unknown) => void | Promise<void>) | undefined { return this._onFailureFn }
  isWithoutOverlapping(): boolean { return this._withoutOverlapping }
  getOverlapExpiresAt(): number   { return this._overlapExpiresAt }
  getOverlapKey(): string         { return this._overlapKey ?? `rudderjs:schedule:overlap:${this._cron}` }
  isEvenInMaintenanceMode(): boolean { return this._evenInMaintenance }
  isOnOneServer(): boolean        { return this._oneServer }

  /** Returns the next scheduled run time, or null if the cron is invalid. */
  nextRun(): Date | null {
    try {
      const opts = this._timezone ? { timezone: this._timezone } : {}
      return new Cron(this._cron, { ...opts, paused: true }).nextRun() ?? null
    } catch {
      return null
    }
  }

  /**
   * Returns true if this task is due within the current one-minute window.
   * Used by `schedule:run` (the system-cron entry point).
   */
  isDue(): boolean {
    try {
      const opts = this._timezone ? { timezone: this._timezone } : {}
      const job  = new Cron(this._cron, { ...opts, paused: true })
      const next = job.nextRun(new Date(Date.now() - 60_000))
      return next !== null && next.getTime() <= Date.now()
    } catch {
      return false
    }
  }
}

// ─── Scheduler Singleton ───────────────────────────────────

class Scheduler {
  private readonly _tasks: ScheduledTask[] = []

  call(callback: () => void | Promise<void>): ScheduledTask {
    const task = new ScheduledTask(callback)
    this._tasks.push(task)
    return task
  }

  getTasks(): ScheduledTask[] { return [...this._tasks] }

  /** @internal — used for testing and hot-reload */
  reset(): void { this._tasks.length = 0 }
}

export const schedule = new Scheduler()
export const Schedule = schedule

// ─── Helpers ───────────────────────────────────────────────

// ─── Task execution with hooks/overlap/oneServer ──────────

interface CacheLike {
  get(key: string): Promise<unknown>
  put(key: string, value: unknown, ttl?: number): Promise<void>
  forget(key: string): Promise<void>
}

function _getCache(): CacheLike | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@rudderjs/cache') as { CacheRegistry?: { get(): CacheLike | null } }
    return mod.CacheRegistry?.get() ?? null
  } catch {
    return null
  }
}

async function _executeTask(task: ScheduledTask): Promise<void> {
  const label = task.getDescription() || task.getCron()
  const cache = _getCache()

  // ── onOneServer: acquire distributed lock ──────────
  if (task.isOnOneServer()) {
    if (!cache) {
      console.log(`[Schedule] Skipping "${label}" — onOneServer() requires @rudderjs/cache`)
      return
    }
    const lockKey = `rudderjs:schedule:server:${label}`
    const existing = await cache.get(lockKey)
    if (existing) return // another server is handling it
    await cache.put(lockKey, '1', 60) // 60s lock
  }

  // ── withoutOverlapping: acquire overlap lock ───────
  if (task.isWithoutOverlapping()) {
    const overlapKey = task.getOverlapKey()
    if (cache) {
      const locked = await cache.get(overlapKey)
      if (locked) {
        console.log(`[Schedule] Skipping "${label}" — already running (overlap lock)`)
        return
      }
      await cache.put(overlapKey, '1', task.getOverlapExpiresAt() * 60)
    }
  }

  // ── before hook ────────────────────────────────────
  if (task.getBeforeFn()) await task.getBeforeFn()!()

  process.stdout.write(`[Schedule] Running "${label}" ... `)

  try {
    await task.getCallback()()
    console.log('✔')

    // ── onSuccess hook ───────────────────────────────
    if (task.getOnSuccessFn()) await task.getOnSuccessFn()!()
  } catch (err) {
    console.log('✗')
    console.error(err)

    // ── onFailure hook ───────────────────────────────
    if (task.getOnFailureFn()) await task.getOnFailureFn()!(err)
  } finally {
    // ── after hook ───────────────────────────────────
    if (task.getAfterFn()) await task.getAfterFn()!()

    // ── release overlap lock ─────────────────────────
    if (task.isWithoutOverlapping() && cache) {
      await cache.forget(task.getOverlapKey())
    }
  }
}

// ─── Helpers ───────────────────────────────────────────────

function formatNextRun(date: Date | null): string {
  if (!date) return '—'
  const pad = (n: number) => String(n).padStart(2, '0')
  const d   = date
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

// ─── Service Provider Factory ──────────────────────────────

export function scheduler(): new (app: Application) => ServiceProvider {
  class ScheduleServiceProvider extends ServiceProvider {
    register(): void {}

    boot(): void {
      rudder.command('schedule:run', async () => {
        const tasks = schedule.getTasks()
        if (tasks.length === 0) {
          console.log('[Schedule] No tasks registered.')
          return
        }

        let ran = 0
        for (const task of tasks) {
          if (!task.isDue()) continue
          await _executeTask(task)
          ran++
        }

        if (ran === 0) console.log('[Schedule] No tasks due.')
        else           console.log(`[Schedule] ${ran} task(s) completed.`)
      }).description('Run all scheduled tasks that are due now')

      rudder.command('schedule:work', async () => {
        const tasks = schedule.getTasks()
        console.log(`[Schedule] Worker started — ${tasks.length} task(s) registered.`)
        console.log('[Schedule] Press Ctrl+C to stop.\n')

        const jobs: Cron[] = []

        for (const task of tasks) {
          const tz    = task.getTimezone()
          const opts  = tz ? { timezone: tz } : {}
          jobs.push(new Cron(task.getCron(), opts, async () => {
            await _executeTask(task)
          }))
        }

        await new Promise<void>((resolve) => {
          process.once('SIGINT', () => {
            for (const job of jobs) job.stop()
            console.log('\n[Schedule] Worker stopped.')
            resolve()
          })
        })
      }).description('Start the schedule worker (in-process cron, Ctrl+C to stop)')

      rudder.command('schedule:list', () => {
        const tasks = schedule.getTasks()
        if (tasks.length === 0) {
          console.log('[Schedule] No tasks registered.')
          return
        }

        const CRON_W = 22
        const DESC_W = 28
        const SEP    = '─'
        console.log('\n  Scheduled Tasks')
        console.log(`  ${SEP.repeat(CRON_W)} ${SEP.repeat(DESC_W)} ${SEP.repeat(19)}`)
        console.log(`  ${'CRON'.padEnd(CRON_W)} ${'DESCRIPTION'.padEnd(DESC_W)} NEXT RUN`)
        console.log(`  ${SEP.repeat(CRON_W)} ${SEP.repeat(DESC_W)} ${SEP.repeat(19)}`)
        for (const task of tasks) {
          const cron = task.getCron().padEnd(CRON_W)
          const desc = (task.getDescription() || '—').padEnd(DESC_W)
          const next = formatNextRun(task.nextRun())
          console.log(`  ${cron} ${desc} ${next}`)
        }
        console.log()
      }).description('List all registered scheduled tasks')
    }
  }

  return ScheduleServiceProvider
}