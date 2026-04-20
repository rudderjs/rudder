# @rudderjs/schedule

## Overview

Cron-based task scheduler with fluent API. Register tasks in `routes/console.ts`; run them with `pnpm rudder schedule:run`. In production, point an external cron to `schedule:run` every minute — the scheduler fires all matching tasks for that minute. Tasks can call functions, invoke rudder commands, or shell out.

## Key Patterns

### Setup

```ts
// bootstrap/providers.ts
import { scheduler } from '@rudderjs/schedule'
export default [scheduler(), ...]
```

### Registering tasks

```ts
// routes/console.ts
import { schedule } from '@rudderjs/schedule'

schedule.call(async () => {
  await syncData()
}).everyFiveMinutes().description('Sync external data')

schedule.command('cache:prune').daily().at('02:00').description('Nightly cache prune')

schedule.call(async () => {
  await sendDigest()
}).weekdays().dailyAt('9:00').timezone('America/New_York')
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

### Filters & guards

```ts
schedule.call(cleanup).daily().when(() => config.cleanupEnabled)
schedule.call(sync).hourly().skip(() => isHoliday())
schedule.call(heavy).daily().withoutOverlapping()    // skip if previous run still running
schedule.call(t).hourly().runInBackground()          // don't await
```

### CLI

```bash
pnpm rudder schedule:list     # list all scheduled tasks with next-fire time
pnpm rudder schedule:run      # fire all tasks due this minute; intended for cron
pnpm rudder schedule:test     # dry-run — print what would fire at given time
```

**Production cron setup**: one system cron entry running `pnpm rudder schedule:run` every minute. The scheduler picks matching tasks.

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
import { scheduler, schedule } from '@rudderjs/schedule'

import type { ScheduledTask, Frequency } from '@rudderjs/schedule'
```
