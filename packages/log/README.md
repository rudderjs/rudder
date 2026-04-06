# @rudderjs/log

Structured logging for RudderJS — channels, log levels, formatters, context propagation, and testing fakes.

Laravel's `Log` facade, rebuilt for Node.js.

## Installation

```bash
pnpm add @rudderjs/log
```

## Quick Start

```ts
// bootstrap/providers.ts
import { log } from '@rudderjs/log'
import configs from '../config/index.js'

export default [
  log(configs.log),
  // ...other providers
]
```

```ts
// config/log.ts
import { Env } from '@rudderjs/core'
import type { LogConfig } from '@rudderjs/log'

export default {
  default: Env.get('LOG_CHANNEL', 'stack'),

  channels: {
    stack: {
      driver:   'stack',
      channels: ['console', 'daily'],
    },
    console: {
      driver: 'console',
      level:  Env.get('LOG_LEVEL', 'debug') as 'debug',
    },
    daily: {
      driver: 'daily',
      path:   'storage/logs/rudderjs.log',
      days:   14,
    },
    null: {
      driver: 'null',
    },
  },
} satisfies LogConfig
```

## Usage

```ts
import { Log } from '@rudderjs/log'

// Log levels (RFC 5424, highest → lowest severity)
Log.emergency('System is unusable')
Log.alert('Action must be taken immediately')
Log.critical('Critical condition')
Log.error('Runtime error', { exception: err.message })
Log.warning('Something unexpected happened')
Log.notice('Normal but significant event')
Log.info('User logged in', { userId: 42 })
Log.debug('Query executed', { sql: '...', ms: 12 })

// Generic log method
Log.log('info', 'message', { key: 'value' })
```

### `logger()` helper

```ts
import { logger } from '@rudderjs/log'

logger('quick debug message')        // logs at debug level
logger().info('or use the facade')   // returns Log facade
```

## Channels

### Selecting a channel

```ts
Log.channel('daily').error('Written to daily log only')
```

### On-demand stacks

```ts
Log.stack(['console', 'daily']).warning('Fan-out to multiple channels')
Log.stack(['console', 'daily'], true).error('Ignore sub-channel errors')
```

## Context

### Per-log context

```ts
Log.info('Order placed', { orderId: 123, total: 99.99 })
```

### Per-channel context (persists across calls)

```ts
Log.withContext({ requestId: 'abc-123' })
Log.info('Processing request')   // context: { requestId: 'abc-123' }

Log.withoutContext(['requestId'])  // remove specific keys
Log.withoutContext()               // clear all channel context
```

### Shared context (all channels)

```ts
Log.shareContext({ appVersion: '1.2.0', environment: 'production' })

// Clear it later
Log.flushSharedContext()
```

**Merge priority**: inline context > channel context > shared context.

## Listeners

```ts
Log.listen((entry) => {
  // entry: { level, message, context, timestamp, channel }
  reportToErrorTracker(entry)
})
```

## Drivers

| Driver | Description |
|---|---|
| `console` | Colored output to stdout/stderr (errors → stderr) |
| `single` | Appends to a single log file |
| `daily` | Date-rotated files (`rudderjs-2026-04-06.log`), auto-cleanup |
| `stack` | Fan-out to multiple channels |
| `null` | Discards all messages (useful for testing) |

### `console`

```ts
console: {
  driver:    'console',
  level:     'debug',
  formatter: 'line',  // 'line' (default) | 'json'
}
```

### `single`

```ts
single: {
  driver:    'single',
  path:      'storage/logs/app.log',
  level:     'warning',
  formatter: 'json',
}
```

### `daily`

```ts
daily: {
  driver:    'daily',
  path:      'storage/logs/app.log',    // produces app-2026-04-06.log
  days:      14,                         // retain last 14 days (default)
  level:     'debug',
  formatter: 'line',
}
```

### `stack`

```ts
stack: {
  driver:           'stack',
  channels:         ['console', 'daily'],
  ignoreExceptions: false,  // true = swallow sub-channel errors
}
```

## Formatters

### `LineFormatter` (default)

```
[2026-04-06T12:00:00.000Z] app.INFO      User logged in {"userId":42}
[2026-04-06T12:00:01.000Z] app.ERROR     Database failed {"code":500}
```

### `JsonFormatter`

```json
{"timestamp":"2026-04-06T12:00:00.000Z","channel":"app","level":"info","message":"User logged in","context":{"userId":42}}
```

Set per channel: `formatter: 'json'`

## Custom Drivers

```ts
import { extendLog } from '@rudderjs/log'

extendLog('sentry', (config) => ({
  log(entry) {
    Sentry.captureMessage(entry.message, {
      level: entry.level,
      extra: entry.context,
    })
  },
}))
```

Then use in config:

```ts
sentry: {
  driver: 'sentry',
  level:  'error',
  dsn:    process.env.SENTRY_DSN,
}
```

## Direct API (without ServiceProvider)

```ts
import { LogRegistry, ConsoleAdapter, FileAdapter } from '@rudderjs/log'

LogRegistry.register('console', new ConsoleAdapter(), 'debug')
LogRegistry.register('file', new FileAdapter('storage/logs/app.log'), 'warning')
LogRegistry.setDefault('console')
```

## Testing

Use `LogFake` to capture and assert on log entries in tests:

```ts
import { LogFake, LogRegistry, Log } from '@rudderjs/log'

const fake = new LogFake()
LogRegistry.register('fake', fake, 'debug')
LogRegistry.setDefault('fake')

// ... code under test ...

fake.assertLogged('error', 'Payment failed')
fake.assertLogged('info', (msg, ctx) => ctx['userId'] === 42)
fake.assertNotLogged('debug')
fake.assertLoggedTimes('warning', 3)
fake.assertNothingLogged()
fake.clear()
```

### Assertion API

| Method | Description |
|---|---|
| `assertLogged(level, match?)` | Assert an entry exists at `level`, optionally matching a string or predicate |
| `assertNotLogged(level, match?)` | Assert no matching entry exists |
| `assertLoggedTimes(level, count, match?)` | Assert exact number of matching entries |
| `assertNothingLogged()` | Assert the log is empty |
| `clear()` | Reset captured entries |

## Log Levels

RFC 5424 severity order (0 = most severe):

| Level | Severity | Use case |
|---|---|---|
| `emergency` | 0 | System is unusable |
| `alert` | 1 | Immediate action required |
| `critical` | 2 | Critical conditions |
| `error` | 3 | Runtime errors |
| `warning` | 4 | Unexpected but recoverable |
| `notice` | 5 | Normal but significant |
| `info` | 6 | Informational messages |
| `debug` | 7 | Debug information |

Setting a channel's `level` filters out messages with **lower** severity (higher number). For example, `level: 'warning'` drops `notice`, `info`, and `debug`.
