# @boostkit/schedule

Task scheduler with cron-based expressions and artisan integration.

## Installation

```bash
pnpm add @boostkit/schedule
```

## Setup

Register the scheduler provider in `bootstrap/providers.ts`:

```ts
// bootstrap/providers.ts
import { scheduler } from '@boostkit/schedule'

export default [
  // ...other providers
  scheduler(),
]
```

Define your scheduled tasks in a dedicated file (e.g., `routes/console.ts`) or inside a service provider's `boot()` method:

```ts
// routes/console.ts
import { schedule } from '@boostkit/schedule'
import { db } from '../app/Services/DatabaseSync.js'
import { Reports } from '../app/Services/Reports.js'

schedule.call(() => db.sync()).everyFiveMinutes()
schedule.call(() => Reports.generate()).daily()
schedule.command('db:seed').weekly()
```

## Scheduling Tasks

### `schedule.call(fn)`

Schedules an async or sync callback function:

```ts
import { schedule } from '@boostkit/schedule'

// Run every minute
schedule.call(async () => {
  await pingHealthCheck()
}).everyMinute()

// Run every five minutes
schedule.call(async () => {
  await syncExternalData()
}).everyFiveMinutes()

// Run hourly
schedule.call(async () => {
  await cleanExpiredSessions()
}).hourly()

// Run daily
schedule.call(async () => {
  await generateDailyReport()
}).daily()

// Run weekly
schedule.call(async () => {
  await archiveOldLogs()
}).weekly()
```

### `schedule.cron(expression, fn)`

Schedule a task using a raw cron expression for full control:

```ts
// Every hour at minute 0
schedule.cron('0 * * * *', async () => {
  await processHourlyQueue()
})

// Every weekday at 9am
schedule.cron('0 9 * * 1-5', async () => {
  await sendMorningDigest()
})
```

### `schedule.command(name)`

Schedule a registered artisan command by name:

```ts
schedule.command('db:sync').daily()
schedule.command('cache:prune').everyThirtyMinutes()
schedule.command('reports:generate').weekly()
```

## `ScheduledTask` API

Each call to `schedule.call()`, `schedule.cron()`, or `schedule.command()` returns a `ScheduledTask` instance with a fluent configuration API:

| Method | Cron Expression | Description |
|---|---|---|
| `.everyMinute()` | `* * * * *` | Run once per minute |
| `.everyFiveMinutes()` | `*/5 * * * *` | Run every 5 minutes |
| `.everyTenMinutes()` | `*/10 * * * *` | Run every 10 minutes |
| `.everyFifteenMinutes()` | `*/15 * * * *` | Run every 15 minutes |
| `.everyThirtyMinutes()` | `*/30 * * * *` | Run every 30 minutes |
| `.hourly()` | `0 * * * *` | Run at the top of every hour |
| `.daily()` | `0 0 * * *` | Run once per day at midnight |
| `.weekly()` | `0 0 * * 0` | Run once per week on Sunday |
| `.monthly()` | `0 0 1 * *` | Run once per month on the 1st |
| `.cron(expr)` | custom | Set a raw cron expression |
| `.description(text)` | — | Set a human-readable description shown in `schedule:list` |
| `.withoutOverlapping()` | — | Skip execution if a previous run is still in progress |

Example combining options:

```ts
schedule
  .call(async () => await processQueue())
  .everyFiveMinutes()
  .description('Process the background job queue')
  .withoutOverlapping()
```

## Artisan Commands

`@boostkit/schedule` registers three artisan commands automatically when `scheduler()` is included in providers:

### `schedule:run`

Evaluates all registered tasks and runs those that are due at the current time. Exits after all due tasks complete. Suitable for being triggered by an external cron job (e.g., a platform cron that fires every minute):

```bash
pnpm artisan schedule:run
```

### `schedule:work`

Long-running daemon that polls for due tasks every minute. The recommended approach for production environments where you manage the process lifecycle:

```bash
pnpm artisan schedule:work
```

### `schedule:list`

Prints a table of all registered tasks, their cron expressions, descriptions, and the next scheduled run time:

```bash
pnpm artisan schedule:list
```

Example output:

```
┌─────────────────────────────┬───────────────┬──────────────────────────────┐
│ Task                        │ Expression    │ Next Run                     │
├─────────────────────────────┼───────────────┼──────────────────────────────┤
│ Process the background queue│ */5 * * * *   │ 2026-03-03 14:15:00          │
│ Generate daily report       │ 0 0 * * *     │ 2026-03-04 00:00:00          │
│ db:sync                     │ 0 0 * * *     │ 2026-03-04 00:00:00          │
└─────────────────────────────┴───────────────┴──────────────────────────────┘
```

## Notes

- `@boostkit/schedule` uses [croner](https://github.com/hexagon/croner) under the hood for cron expression parsing and next-run calculation.
- `schedule:work` is the recommended production approach — run it as a persistent process under a process manager such as PM2 or a container supervisor.
- `schedule:run` is suited for deployments where an external platform cron (Kubernetes CronJob, Render cron service, etc.) fires every minute — the command evaluates due tasks and exits cleanly.
- `withoutOverlapping()` uses an in-memory lock; if your process restarts, the lock resets.
