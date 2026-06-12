# Task Scheduling

`@rudderjs/schedule` is the framework's cron-based task scheduler. You define recurring jobs in `routes/console.ts` with a fluent frequency API, then run a single supervisor command (`pnpm rudder schedule:work`) that fires the right tasks at the right times. No external cron entries needed.

## Setup

```bash
pnpm add @rudderjs/schedule
```

The provider is auto-discovered. Schedule definitions live in `routes/console.ts`:

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
}).cron('0 9 * * 1-5').timezone('America/New_York').description('Morning digest')
```

`schedule.call(fn)` returns a `ScheduledTask` with a fluent API. Chain frequency, time, timezone, and constraints; finish with `.description(...)` for the schedule listing.

## Running the scheduler

In production, run a supervisor process that ticks once per second:

```bash
pnpm rudder schedule:work
```

This is the only command that should run as a long-lived process. Run it under systemd, pm2, Docker `restart: always`, or your platform's equivalent. For serverless deployments, configure the platform's cron to invoke `pnpm rudder schedule:run` once per minute — the runner picks the tasks due in that minute and exits.

To list everything scheduled:

```bash
pnpm rudder schedule:list
# */5 * * * *    Sync external data
# 0 0 * * *      Generate daily report
# 0 9 * * 1-5    Morning digest (America/New_York)
```

## Frequency helpers

The full set of fluent helpers, most-used first:

| Method | Cron | Description |
|---|---|---|
| `.everyMinute()` | `* * * * *` | Every minute |
| `.everyFiveMinutes()` | `*/5 * * * *` | Every 5 minutes |
| `.everyFifteenMinutes()` | `*/15 * * * *` | Every 15 minutes |
| `.hourly()` | `0 * * * *` | Top of every hour |
| `.hourlyAt(min)` | `M * * * *` | Specific minute each hour |
| `.daily()` | `0 0 * * *` | Midnight daily |
| `.dailyAt('H:M')` | `M H * * *` | Specific time daily |
| `.twiceDaily(h1, h2)` | `0 H1,H2 * * *` | Twice a day |
| `.weekly()` | `0 0 * * 0` | Sunday midnight |
| `.weeklyOn(day, 'H:M')` | custom | Specific weekday + time |
| `.monthly()` | `0 0 1 * *` | 1st of each month |
| `.yearly()` | `0 0 1 1 *` | Jan 1st |
| `.cron(expr)` | custom | Raw cron expression |

For weekday filtering: `.weekdays()`, `.weekends()`, `.mondays()` … `.sundays()`. Each of these sets a complete cron expression — they do **not** compose with a time helper. Chaining `.weekdays().dailyAt('9:00')` overwrites the day filter and yields `0 9 * * *` (every day). For "9am Monday through Friday" use a raw expression: `.cron('0 9 * * 1-5')`.

## Timezones

```ts
schedule.call(syncData)
  .hourly()
  .timezone('America/New_York')          // run at NY time, not UTC
  .description('Sync (NY hours)')
```

By default, all times are UTC. Setting `.timezone('America/New_York')` shifts the cron evaluation to that zone.

There is no built-in `.between(...)` window or `.when(...)` / `.skip(...)` predicate today — branch inside the callback to skip a run, or use `.evenInMaintenanceMode()` to opt a task into running when the app is otherwise paused:

```ts
schedule.call(async () => {
  if (isHoliday())                    return
  if (new Date().getHours() < 9 ||
      new Date().getHours() >= 17)    return
  await syncData()
}).hourly().timezone('America/New_York')
```

## Lifecycle hooks

```ts
schedule.call(syncOrders)
  .hourly()
  .before(() => log.info('starting'))
  .after(() => log.info('done'))
  .onSuccess(() => metrics.increment('sync.success'))
  .onFailure((err) => report(err))
```

## Preventing overlap

For tasks that may run longer than their interval, prevent overlap:

```ts
schedule.call(syncData)
  .everyMinute()
  .withoutOverlapping()
  .description('Sync (no overlap)')
```

`withoutOverlapping()` uses a cache lock keyed by the task, so it requires `@rudderjs/cache` to be registered. Without a cache there is no lock at all — the overlap guard is skipped entirely, even within a single process. Register a cache for it to take effect.

## Single-server execution

For multi-server deployments where the same schedule runs on every host, mark a task to fire only once across the cluster:

```ts
schedule.call(generateMonthlyReport)
  .monthly()
  .onOneServer()
```

This also uses cache locks — Redis-backed cache is required.

## Running rudder commands on a schedule

`schedule.call(callback)` is the only entry point — there is no `schedule.command()` shortcut. Either extract the work into a plain function that both your rudder command and the schedule call into, or shell out via `@rudderjs/process`:

```ts
// Recommended — share the work as a function
import { cleanupDatabase } from '../app/Services/cleanup.js'

schedule.call(() => cleanupDatabase()).daily()

// Or shell out (prints the command's logs as well)
import { Process } from '@rudderjs/process'

schedule.call(async () => {
  await Process.run('pnpm rudder cache:clear --store=redis')
}).hourly()
```

## Testing

Schedule tasks are plain functions wrapped by the fluent API. To test the work itself, extract the function and unit-test it directly. To test that a task fires on the right schedule, inspect `pnpm rudder schedule:list`.

## Pitfalls

- **`schedule:work` not running.** Tasks are inert until the supervisor fires them. Confirm the process is alive in production.
- **Timezone surprises.** Default is UTC. A `.daily()` without `.timezone(...)` runs at UTC midnight, not local midnight.
- **Cron-based deploys clearing schedule lock.** If you use `--force` deploys that wipe the cache, in-flight `withoutOverlapping()` locks evaporate. Use `@rudderjs/cache` Redis driver and don't flush it on deploy.
- **Two schedulers running.** Don't run `schedule:work` on every server in a multi-instance deploy. Either run it on one designated host, or use `.onOneServer()` per task plus shared cache.
