# @boostkit/schedule

Task scheduler with cron-based expressions, fluent API, and artisan commands.

## Installation

```bash
pnpm add @boostkit/schedule
```

## Setup

```ts
// bootstrap/providers.ts
import { scheduler } from '@boostkit/schedule'
export default [scheduler()]
```

```ts
// routes/console.ts
import { schedule } from '@boostkit/schedule'

schedule.call(async () => {
  await syncData()
}).everyFiveMinutes().description('Sync external data')

schedule.call(async () => {
  await sendDigest()
}).weekdays().dailyAt('9:00').timezone('America/New_York').description('Morning digest')
```

## Fluent API — `ScheduledTask`

Each `schedule.call(fn)` returns a `ScheduledTask` with a fluent configuration API:

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
| `.twiceDaily(h1, h2)` | `0 H1,H2 * * *` | Twice a day |
| `.weekly()` | `0 0 * * 0` | Sunday midnight |
| `.weeklyOn(day, 'H:M')` | custom | Specific day + time |
| `.monthly()` | `0 0 1 * *` | 1st of each month |
| `.monthlyOn(day, 'H:M')` | custom | Specific day of month |
| `.yearly()` | `0 0 1 1 *` | Jan 1st midnight |
| `.cron(expr)` | custom | Raw cron expression |

### Named-day helpers

| Method | Runs on |
|--------|---------|
| `.sundays()` | Every Sunday at midnight |
| `.mondays()` | Every Monday at midnight |
| `.tuesdays()` | Every Tuesday at midnight |
| `.wednesdays()` | Every Wednesday at midnight |
| `.thursdays()` | Every Thursday at midnight |
| `.fridays()` | Every Friday at midnight |
| `.saturdays()` | Every Saturday at midnight |
| `.weekdays()` | Mon–Fri at midnight |
| `.weekends()` | Sat + Sun at midnight |

### Other options

| Method | Description |
|--------|-------------|
| `.description(text)` | Human-readable label shown in `schedule:list` |
| `.timezone(tz)` | IANA timezone (e.g. `'America/New_York'`, `'UTC'`) |

### Introspection

| Method | Returns | Description |
|--------|---------|-------------|
| `.nextRun()` | `Date \| null` | Next scheduled run time |
| `.getCron()` | `string` | Current cron expression |
| `.getDescription()` | `string` | Current description |
| `.getTimezone()` | `string \| undefined` | Configured timezone |

## Artisan Commands

| Command | Description |
|---------|-------------|
| `pnpm artisan schedule:run` | Run all due tasks once and exit — for external cron triggers |
| `pnpm artisan schedule:work` | Long-running daemon, polls every minute (Ctrl+C to stop) |
| `pnpm artisan schedule:list` | Print all tasks with cron, description, and next run time |

## Notes

- Uses [croner](https://github.com/hexagon/croner) for cron parsing and scheduling.
- `schedule:run` is suited for platform crons (Kubernetes CronJob, Render, etc.) that fire every minute.
- `schedule:work` is for environments where you manage the process (PM2, Docker, etc.).