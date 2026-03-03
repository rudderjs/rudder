# @boostkit/schedule

Task scheduler primitives and provider factory with cron-based artisan commands.

## Installation

```bash
pnpm add @boostkit/schedule
```

## Usage

```ts
// bootstrap/providers.ts
import { scheduler } from '@boostkit/schedule'

export default [
  scheduler(),
]

import { schedule } from '@boostkit/schedule'
schedule.call(async () => {
  // task body
}).everyFiveMinutes().description('Example task')
```

## API Reference

- `ScheduledTask`
- `schedule` (global scheduler singleton)
- `scheduler()`

## Configuration

This package has no runtime config object.

## Notes

- Registers artisan commands: `schedule:run`, `schedule:work`, `schedule:list`.
- Uses `croner` for cron expression scheduling.
