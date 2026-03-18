import { ServiceProvider, artisan, type Application } from '@boostkit/core'
import { Cron } from 'croner'

// ─── Scheduled Task ────────────────────────────────────────

export class ScheduledTask {
  private _cron        = '* * * * *'
  private _description = ''
  private _timezone?:  string

  constructor(private readonly callback: () => void | Promise<void>) {}

  // ── Cron ───────────────────────────────────────────────

  /** Set a raw cron expression (5 or 6-field) */
  cron(expression: string): this { this._cron = expression; return this }

  /** Set the IANA timezone for this task (e.g. 'America/New_York', 'UTC') */
  timezone(tz: string): this { this._timezone = tz; return this }

  // ── Sub-minute ─────────────────────────────────────────
  everySecond(): this { return this.cron('* * * * * *') }

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

  // ── Accessors ──────────────────────────────────────────
  getCron(): string              { return this._cron }
  getTimezone(): string | undefined { return this._timezone }
  getDescription(): string       { return this._description }
  getCallback(): () => void | Promise<void> { return this.callback }

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
      artisan.command('schedule:run', async () => {
        const tasks = schedule.getTasks()
        if (tasks.length === 0) {
          console.log('[Schedule] No tasks registered.')
          return
        }

        let ran = 0
        for (const task of tasks) {
          if (!task.isDue()) continue
          const label = task.getDescription() || task.getCron()
          process.stdout.write(`[Schedule] Running "${label}" ... `)
          try {
            await task.getCallback()()
            console.log('✔')
          } catch (err) {
            console.log('✗')
            console.error(err)
          }
          ran++
        }

        if (ran === 0) console.log('[Schedule] No tasks due.')
        else           console.log(`[Schedule] ${ran} task(s) completed.`)
      }).description('Run all scheduled tasks that are due now')

      artisan.command('schedule:work', async () => {
        const tasks = schedule.getTasks()
        console.log(`[Schedule] Worker started — ${tasks.length} task(s) registered.`)
        console.log('[Schedule] Press Ctrl+C to stop.\n')

        const jobs: Cron[] = []

        for (const task of tasks) {
          const label = task.getDescription() || task.getCron()
          const tz    = task.getTimezone()
          const opts  = tz ? { timezone: tz } : {}
          jobs.push(new Cron(task.getCron(), opts, async () => {
            process.stdout.write(`[Schedule] Running "${label}" ... `)
            try {
              await task.getCallback()()
              console.log('✔')
            } catch (err) {
              console.log('✗')
              console.error(err)
            }
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

      artisan.command('schedule:list', () => {
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