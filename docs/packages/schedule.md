# @rudderjs/schedule

Task scheduler with cron-based expressions, fluent API, and rudder commands.

## Installation

```bash
pnpm add @rudderjs/schedule
```

## Setup

Register the scheduler provider in `bootstrap/providers.ts`:

```ts
// bootstrap/providers.ts
import { scheduler } from '@rudderjs/schedule'

export default [
  // ...other providers
  scheduler(),
]
```

Define scheduled tasks in `routes/console.ts` or inside a service provider's `boot()` method:

```ts
// routes/console.ts
import { schedule } from '@rudderjs/schedule'

schedule.call(async () => {
  await syncExternalData()
}).everyFiveMinutes().description('Sync external data')

schedule.call(async () => {
  await generateDailyReport()
}).daily().description('Generate daily report')

schedule.call(async () => {
  await sendMorningDigest()
}).weekdays().dailyAt('9:00').timezone('America/New_York').description('Morning digest')
```

## Scheduling Tasks

### `schedule.call(fn)`

Schedules an async or sync callback. Returns a `ScheduledTask` with a fluent configuration API:

```ts
import { schedule } from '@rudderjs/schedule'

schedule.call(async () => {
  await pingHealthCheck()
}).everyMinute().description('Health check')

// Use a raw cron expression for full control
schedule.call(async () => {
  await processHourlyQueue()
}).cron('0 * * * *').description('Process queue')
```

## `ScheduledTask` API

### Frequency helpers

| Method | Cron | Description |
|--------|------|-------------|
| `.everySecond()` | `* * * * * *` | Every second |
| `.everyMinute()` | `* * * * *` | Every minute |
| `.everyTwoMinutes()` | `*/2 * * * *` | Every 2 minutes |
| `.everyFiveMinutes()` | `*/5 * * * *` | Every 5 minutes |
| `.everyTenMinutes()` | `*/10 * * * *` | Every 10 minutes |
| `.everyFifteenMinutes()` | `*/15 * * * *` | Every 15 minutes |
| `.everyThirtyMinutes()` | `*/30 * * * *` | Every 30 minutes |
| `.hourly()` | `0 * * * *` | Top of every hour |
| `.hourlyAt(minute)` | `M * * * *` | Specific minute each hour |
| `.daily()` | `0 0 * * *` | Midnight daily |
| `.dailyAt('H:M')` | `M H * * *` | Specific time daily |
| `.twiceDaily(h1, h2)` | `0 H1,H2 * * *` | Twice a day (default 1am + 1pm) |
| `.weekly()` | `0 0 * * 0` | Sunday midnight |
| `.weeklyOn(day, 'H:M')` | custom | Specific weekday + time |
| `.monthly()` | `0 0 1 * *` | 1st of each month at midnight |
| `.monthlyOn(day, 'H:M')` | custom | Specific day of month + time |
| `.yearly()` | `0 0 1 1 *` | Jan 1st at midnight |
| `.cron(expr)` | custom | Raw 5 or 6-field cron expression |

### Named-day helpers

| Method | Runs at midnight on… |
|--------|----------------------|
| `.sundays()` | Every Sunday |
| `.mondays()` | Every Monday |
| `.tuesdays()` | Every Tuesday |
| `.wednesdays()` | Every Wednesday |
| `.thursdays()` | Every Thursday |
| `.fridays()` | Every Friday |
| `.saturdays()` | Every Saturday |
| `.weekdays()` | Mon–Fri |
| `.weekends()` | Sat + Sun |

### Other options

| Method | Description |
|--------|-------------|
| `.description(text)` | Human-readable label shown in `schedule:list` |
| `.timezone(tz)` | IANA timezone (e.g. `'America/New_York'`, `'UTC'`) |

### Introspection

```ts
const task = schedule.call(fn).everyFiveMinutes()

task.nextRun()        // Date | null — next scheduled execution
task.getCron()        // '*/5 * * * *'
task.getDescription() // ''
task.getTimezone()    // undefined
```

## Rudder Commands

`@rudderjs/schedule` registers three commands automatically when `scheduler()` is included in providers:

### `schedule:run`

Runs all tasks that are due at the current time, then exits. Designed to be triggered by an external cron job firing every minute:

```bash
pnpm rudder schedule:run
```

### `schedule:work`

Long-running in-process daemon — starts all tasks and keeps them running on their cron schedules. Press Ctrl+C to stop:

```bash
pnpm rudder schedule:work
```

### `schedule:list`

Prints all registered tasks with their cron expression, description, and next run time:

```bash
pnpm rudder schedule:list
```

```
  Scheduled Tasks
  ────────────────────── ──────────────────────────── ───────────────────
  CRON                   DESCRIPTION                  NEXT RUN
  ────────────────────── ──────────────────────────── ───────────────────
  */5 * * * *            Sync external data           2026-03-08 01:05:00
  0 0 * * *              Generate daily report        2026-03-09 00:00:00
  0 9 * * 1-5            Morning digest               2026-03-09 09:00:00
```

## Sub-Minute Scheduling

```ts
schedule.call(() => pollExternalApi()).everyFiveSeconds()
schedule.call(() => checkHealth()).everyTenSeconds()
schedule.call(() => syncMetrics()).everyFifteenSeconds()
schedule.call(() => heartbeat()).everyTwentySeconds()
schedule.call(() => flushBuffer()).everyThirtySeconds()
```

---

## Hooks

Attach callbacks to task execution lifecycle:

```ts
schedule.call(() => generateReport())
  .daily()
  .before(() => console.log('Starting report...'))
  .after(() => console.log('Report finished (success or failure)'))
  .onSuccess(() => sendSlackNotification('Report ready!'))
  .onFailure((err) => reportError(err))
  .description('Daily report')
```

| Hook | Description |
|---|---|
| `before(fn)` | Runs before the task executes |
| `after(fn)` | Runs after the task (success or failure) |
| `onSuccess(fn)` | Runs only on success |
| `onFailure(fn)` | Runs only on failure — receives the error |

---

## Overlap Prevention

Prevent a task from running if the previous execution is still in progress:

```ts
schedule.call(() => longRunningImport())
  .everyMinute()
  .withoutOverlapping()           // default: 24h lock expiry
  .withoutOverlapping(60)         // custom: 60-minute lock expiry
```

Uses `@rudderjs/cache` for the lock. Without cache, runs without overlap protection.

---

## Single-Server Execution

In multi-server deployments, ensure a task runs on only one server:

```ts
schedule.call(() => pruneDatabase())
  .daily()
  .onOneServer()
```

Uses a cache-backed distributed lock. Requires `@rudderjs/cache`.

---

## Maintenance Mode

By default, tasks are skipped during maintenance mode. Override with:

```ts
schedule.call(() => healthCheck())
  .everyMinute()
  .evenInMaintenanceMode()
```

---

## Notes

- Uses [croner](https://github.com/hexagon/croner) for cron parsing and scheduling.
- `schedule:run` is suited for platform crons (Kubernetes CronJob, Render, etc.) firing every minute.
- `schedule:work` is for environments where you manage the process (PM2, Docker, systemd).
- Sub-minute scheduling uses 6-field cron expressions (seconds field).
- `withoutOverlapping()` and `onOneServer()` require `@rudderjs/cache` — without it, tasks run without locking.
