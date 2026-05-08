# @rudderjs/schedule

## Overview

Cron-based task scheduler with fluent API. Register tasks in `routes/console.ts`; run them with `pnpm rudder schedule:run`. In production, point an external cron to `schedule:run` every minute — the scheduler fires all matching tasks for that minute. Tasks can call functions, invoke rudder commands, or shell out.

## Key Patterns

### Setup

```ts
// bootstrap/providers.ts
import { ScheduleProvider } from '@rudderjs/schedule'
export default [ScheduleProvider]
```

### Registering tasks

`schedule.call(callback)` is the only entry point — the scheduler does not have a `.command()` method. To run a rudder command on a schedule, invoke its handler from the callback (or shell out via `@rudderjs/process`).

```ts
// routes/console.ts
import { schedule } from '@rudderjs/schedule'

schedule.call(async () => {
  await syncData()
}).everyFiveMinutes().description('Sync external data')

schedule.call(async () => {
  await pruneCache()
}).dailyAt('2:00').description('Nightly cache prune')

schedule.call(async () => {
  await sendDigest()
}).dailyAt('9:00').timezone('America/New_York')
```

### Frequency helpers

| Method | Cron equivalent |
|---|---|
| `.everyMinute()` | `* * * * *` |
| `.everyFiveMinutes()` | `*/5 * * * *` |
| `.everyTenMinutes()` | `*/10 * * * *` |
| `.hourly()` / `.hourlyAt(15)` | `0 * * * *` / `15 * * * *` |
| `.daily()` / `.dailyAt('14:30')` | `0 0 * * *` / `30 14 * * *` |
| `.weekly()` / `.monthly()` / `.yearly()` | standard cron |
| `.weekdays()` / `.weekends()` | day filter |
| `.cron('*/3 * * * *')` | raw cron expression |

### Overlap & one-server protection

```ts
// Skip the run if the previous one is still in progress (uses @rudderjs/cache lock)
schedule.call(heavy).daily().withoutOverlapping()
schedule.call(heavy).daily().withoutOverlapping(120)   // lock TTL in minutes (default 1440 = 24h)

// Run on a single host even when multiple workers are scheduled (cache lock)
schedule.call(weeklyReport).weekly().onOneServer()

// Run even when the app is in maintenance mode
schedule.call(criticalTask).hourly().evenInMaintenanceMode()
```

There is no `when()` / `skip()` / `runInBackground()` — branch inside the `.call(callback)` to skip a run, and use `@rudderjs/queue` for fire-and-forget work instead.

### Lifecycle hooks

```ts
schedule.call(syncOrders).hourly()
  .before(() => log.info('starting'))
  .after(() => log.info('done'))
  .onSuccess(() => metrics.increment('sync.success'))
  .onFailure((err) => report(err))
```

### CLI

```bash
pnpm rudder schedule:list     # list all scheduled tasks with next-fire time
pnpm rudder schedule:run      # fire all tasks due this minute; intended for system cron
pnpm rudder schedule:work     # in-process worker — runs all tasks on their own crons until Ctrl+C
```

**Production setup — pick one:**

- **External cron** — one system cron entry running `pnpm rudder schedule:run` every minute. The scheduler picks matching tasks.
- **In-process worker** — long-running `pnpm rudder schedule:work` process. Self-contained; useful inside a single container where adding host cron is awkward.

### Timezones

```ts
schedule.call(t).dailyAt('9:00').timezone('America/New_York')
```

Defaults to the server's local timezone. Use named timezones (IANA format) for deterministic scheduling across deployments.

## Common Pitfalls

- **Forgetting to run `schedule:run` from cron.** Registering tasks doesn't start them — the scheduler is pull-based. A system cron or k8s CronJob must run `pnpm rudder schedule:run` every minute.
- **Overlapping long-running tasks.** Default is no overlap protection. If a task runs longer than its frequency, you get concurrent invocations. Use `.withoutOverlapping()` — it uses `@rudderjs/cache` for the lock, so cache must be registered.
- **Timezone drift.** If you don't set `.timezone(...)`, tasks run in the server's local TZ. Set it explicitly for anything time-sensitive — server TZ can change across deployments.
- **`.call(fn)` capturing stale references.** The function is captured at registration time. Don't reference `let` variables that mutate — use modules, config, or DI lookups inside the callback instead.
- **Telescope records scheduled tasks.** `@rudderjs/telescope`'s `schedule` collector records each fired task with output + duration + exit code.
- **Method-as-property bug.** `scheduledTask['description']` returns the fluent setter function, not the description string. Use `scheduledTask.getDescription()` or the private `_description` field. Bit collectors in earlier versions.

## Key Imports

```ts
import { ScheduleProvider, schedule, Schedule, ScheduledTask } from '@rudderjs/schedule'
// `schedule` and `Schedule` are the same singleton — both are exported for taste.
```
