import { ServiceProvider, artisan, type Application } from '@boostkit/core'
import { Cron } from 'croner'

// ─── Scheduled Task ────────────────────────────────────────

export class ScheduledTask {
  private _cron        = '* * * * *'
  private _description = ''

  constructor(private readonly callback: () => void | Promise<void>) {}

  // ── Cron ───────────────────────────────────────────────
  /** Set a raw cron expression (5-field: min hour dom month dow) */
  cron(expression: string): this { this._cron = expression; return this }

  // ── Convenience helpers ────────────────────────────────
  everySecond(): this         { return this.cron('* * * * * *') }
  everyMinute(): this         { return this.cron('* * * * *') }
  everyTwoMinutes(): this     { return this.cron('*/2 * * * *') }
  everyFiveMinutes(): this    { return this.cron('*/5 * * * *') }
  everyTenMinutes(): this     { return this.cron('*/10 * * * *') }
  everyFifteenMinutes(): this { return this.cron('*/15 * * * *') }
  everyThirtyMinutes(): this  { return this.cron('*/30 * * * *') }

  hourly(): this                 { return this.cron('0 * * * *') }
  hourlyAt(minute: number): this { return this.cron(`${minute} * * * *`) }

  daily(): this                      { return this.cron('0 0 * * *') }
  dailyAt(time: string): this        {
    const [h = '0', m = '0'] = time.split(':')
    return this.cron(`${m} ${h} * * *`)
  }
  twiceDaily(h1 = 1, h2 = 13): this { return this.cron(`0 ${h1},${h2} * * *`) }

  weekly(): this                            { return this.cron('0 0 * * 0') }
  weeklyOn(day: number, time = '0:0'): this {
    const [h = '0', m = '0'] = time.split(':')
    return this.cron(`${m} ${h} * * ${day}`)
  }

  monthly(): this                           { return this.cron('0 0 1 * *') }
  monthlyOn(day = 1, time = '0:0'): this    {
    const [h = '0', m = '0'] = time.split(':')
    return this.cron(`${m} ${h} ${day} * *`)
  }

  yearly(): this  { return this.cron('0 0 1 1 *') }

  description(desc: string): this { this._description = desc; return this }

  // ── Internal ───────────────────────────────────────────
  getCron(): string       { return this._cron }
  getDescription(): string { return this._description }
  getCallback(): () => void | Promise<void> { return this.callback }

  /**
   * Returns true if this task is due within the current one-minute window.
   * Used by `schedule:run` (the system-cron entry point).
   */
  isDue(): boolean {
    try {
      const job  = new Cron(this._cron, { paused: true })
      // Starting from 60 s ago, find the next scheduled run.
      // If it falls at or before now, the task is due this minute.
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

  /** Register a callback on the schedule and return the task for chaining. */
  call(callback: () => void | Promise<void>): ScheduledTask {
    const task = new ScheduledTask(callback)
    this._tasks.push(task)
    return task
  }

  getTasks(): ScheduledTask[] { return [...this._tasks] }
}

/** Global schedule singleton — define tasks in routes/console.ts */
export const schedule = new Scheduler()

// ─── Service Provider Factory ──────────────────────────────

/**
 * Returns a ScheduleServiceProvider that registers the `schedule:run` and
 * `schedule:work` artisan commands.
 *
 * Define scheduled tasks in routes/console.ts:
 *   import { schedule } from '@boostkit/schedule'
 *   schedule.call(() => Cache.forget('users:all')).everyFiveMinutes()
 *
 * Run via system cron (production):
 *   * * * * *  cd /app && node artisan schedule:run
 *
 * Run in-process (dev / simple deployments):
 *   pnpm artisan schedule:work
 */
export function scheduler(): new (app: Application) => ServiceProvider {
  class ScheduleServiceProvider extends ServiceProvider {
    register(): void {}

    boot(): void {
      // ── schedule:run ─────────────────────────────────────
      // Intended to be called every minute by a system cron job.
      // Runs only the tasks that are due in the current minute, then exits.
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

      // ── schedule:work ─────────────────────────────────────
      // Starts an in-process worker that runs tasks on their cron schedule.
      // Keeps the process alive — use Ctrl+C to stop.
      artisan.command('schedule:work', async () => {
        const tasks = schedule.getTasks()
        console.log(`[Schedule] Worker started — ${tasks.length} task(s) registered.`)
        console.log('[Schedule] Press Ctrl+C to stop.\n')

        const jobs: Cron[] = []

        for (const task of tasks) {
          const label = task.getDescription() || task.getCron()
          jobs.push(new Cron(task.getCron(), async () => {
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

        // Keep the process alive until Ctrl+C
        await new Promise<void>((resolve) => {
          process.once('SIGINT', () => {
            for (const job of jobs) job.stop()
            console.log('\n[Schedule] Worker stopped.')
            resolve()
          })
        })
        process.exit(0)
      }).description('Start the schedule worker (in-process cron, Ctrl+C to stop)')

      // ── schedule:list ─────────────────────────────────────
      artisan.command('schedule:list', () => {
        const tasks = schedule.getTasks()
        if (tasks.length === 0) {
          console.log('[Schedule] No tasks registered.')
          return
        }
        console.log('\n  Scheduled Tasks\n  ' + '─'.repeat(50))
        for (const task of tasks) {
          const desc = task.getDescription()
          console.log(`  ${task.getCron().padEnd(20)} ${desc || '(no description)'}`)
        }
        console.log()
      }).description('List all registered scheduled tasks')

      console.log(`[ScheduleServiceProvider] booted — ${schedule.getTasks().length} task(s) registered`)
    }
  }

  return ScheduleServiceProvider
}
