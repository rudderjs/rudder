# @rudderjs/log

Structured logging with multiple channels, RFC 5424 log levels, formatters, and testing support.

## Installation

```bash
pnpm add @rudderjs/log
```

## Setup

### 1. Add logging config

```ts
// config/logging.ts
import { resolve } from 'node:path'

export default {
  default: 'stack',
  channels: {
    console: {
      driver: 'console',
      level:  'debug',
    },
    file: {
      driver: 'single',
      path:   resolve(import.meta.dirname, '../storage/logs/rudderjs.log'),
      level:  'info',
    },
    daily: {
      driver: 'daily',
      path:   resolve(import.meta.dirname, '../storage/logs/rudderjs.log'),
      level:  'info',
      days:   14,
    },
    stack: {
      driver:   'stack',
      channels: ['console', 'file'],
    },
    null: {
      driver: 'null',
    },
  },
}
```

### 2. Register provider

```ts
// bootstrap/providers.ts
import { log } from '@rudderjs/log'
import configs from '../config/index.js'

export default [
  // ...other providers
  log(configs.logging),
]
```

Once registered, unhandled exceptions are automatically routed through the default log channel via `setExceptionReporter()`.

## Log Facade

### Level methods

```ts
import { Log } from '@rudderjs/log'

Log.emergency('System is unusable')
Log.alert('Action must be taken immediately')
Log.critical('Critical condition', { service: 'payments' })
Log.error('Something failed', { error: err.message })
Log.warning('Deprecated API used')
Log.notice('Normal but significant event')
Log.info('User logged in', { userId: 42 })
Log.debug('Processing item', { itemId: 7 })

// Generic level method
Log.log('info', 'Custom level call')
```

All level methods accept an optional second argument for context:

```ts
Log.error('Payment failed', { orderId: 123, gateway: 'stripe' })
```

### Channel selection

```ts
// Log to a specific channel
Log.channel('file').info('Written to file only')

// Log to an ad-hoc stack of channels
Log.stack(['console', 'file']).error('Sent to both channels')
```

### Context propagation

```ts
// Per-channel context (default channel)
Log.withContext({ requestId: 'abc-123' })
Log.info('Processing')  // context includes requestId
Log.withoutContext(['requestId'])

// Shared context (all channels)
Log.shareContext({ environment: 'production' })
Log.sharedContext()        // { environment: 'production' }
Log.flushSharedContext()   // clear all shared context
```

## Log Levels

| Level | Severity | Description |
|---|---|---|
| `emergency` | 0 | System is unusable |
| `alert` | 1 | Action must be taken immediately |
| `critical` | 2 | Critical conditions |
| `error` | 3 | Error conditions |
| `warning` | 4 | Warning conditions |
| `notice` | 5 | Normal but significant |
| `info` | 6 | Informational messages |
| `debug` | 7 | Debug-level messages |

Each channel has a minimum level. Messages below that level are silently discarded.

## Facade Methods

| Method | Description |
|---|---|
| `Log.emergency(msg, ctx?)` | Log at emergency level |
| `Log.alert(msg, ctx?)` | Log at alert level |
| `Log.critical(msg, ctx?)` | Log at critical level |
| `Log.error(msg, ctx?)` | Log at error level |
| `Log.warning(msg, ctx?)` | Log at warning level |
| `Log.notice(msg, ctx?)` | Log at notice level |
| `Log.info(msg, ctx?)` | Log at info level |
| `Log.debug(msg, ctx?)` | Log at debug level |
| `Log.log(level, msg, ctx?)` | Log at an arbitrary level |
| `Log.channel(name)` | Get a specific channel |
| `Log.stack(channels)` | Create an ad-hoc stack |
| `Log.withContext(ctx)` | Add context to default channel |
| `Log.withoutContext(keys?)` | Remove context keys (all if no keys) |
| `Log.shareContext(ctx)` | Share context across all channels |
| `Log.sharedContext()` | Get current shared context |
| `Log.flushSharedContext()` | Clear all shared context |
| `Log.listen(fn)` | Listen for all log entries |

## Drivers

### `console`

Writes to stdout/stderr with ANSI colors. Errors (severity <= `error`) go to stderr.

```ts
{ driver: 'console', level: 'debug', formatter: 'line' }
```

### `single`

Appends to a single log file. Creates parent directories automatically.

```ts
{ driver: 'single', path: 'storage/logs/app.log', level: 'info' }
```

### `daily`

Daily-rotated log files with configurable retention. Old files beyond `days` are cleaned up automatically.

```ts
{ driver: 'daily', path: 'storage/logs/app.log', level: 'info', days: 14 }
// Creates: storage/logs/app-2026-04-06.log
```

### `stack`

Fan-out to multiple channels. Optionally swallow errors from sub-channels.

```ts
{ driver: 'stack', channels: ['console', 'file'], ignoreExceptions: true }
```

### `null`

Discard all messages. Useful for testing or disabling logging in specific environments.

```ts
{ driver: 'null' }
```

## Formatters

Every driver accepts a `formatter` option: `'line'` (default) or `'json'`.

**LineFormatter** output:

```
[2026-04-06T12:00:00.000Z] console.INFO      User logged in {"userId":42}
```

**JsonFormatter** output:

```json
{"timestamp":"2026-04-06T12:00:00.000Z","channel":"console","level":"info","message":"User logged in","context":{"userId":42}}
```

## Listeners

Listen for all log entries across all channels:

```ts
import { Log } from '@rudderjs/log'

Log.listen((entry) => {
  // entry.level, entry.message, entry.context, entry.timestamp, entry.channel
  if (entry.level === 'error') {
    sendToErrorTracker(entry)
  }
})
```

## Custom Drivers

Register a custom driver with `extendLog()`:

```ts
import { extendLog } from '@rudderjs/log'
import type { LogAdapter, LogEntry, LogChannelConfig } from '@rudderjs/log'

class SentryAdapter implements LogAdapter {
  constructor(private readonly dsn: string) {}

  async log(entry: LogEntry): Promise<void> {
    await sendToSentry(this.dsn, entry)
  }
}

extendLog('sentry', (config) => new SentryAdapter(config['dsn'] as string))
```

Then use it in config:

```ts
channels: {
  sentry: {
    driver: 'sentry',
    level:  'error',
    dsn:    Env.get('SENTRY_DSN', ''),
  },
}
```

## Testing

Use `LogFake` to capture and assert log entries in tests:

```ts
import { LogFake, LogRegistry } from '@rudderjs/log'

const fake = new LogFake()
LogRegistry.register('test', fake)
LogRegistry.setDefault('test')

// ...run code that logs...

fake.assertLogged('info', 'User logged in')
fake.assertNotLogged('error')
fake.assertLoggedTimes('info', 2)
fake.assertNothingLogged()
fake.clear()
```

### LogFake Methods

| Method | Description |
|---|---|
| `assertLogged(level, match?)` | Assert a log entry exists (string substring or predicate) |
| `assertNotLogged(level, match?)` | Assert no log entry matches |
| `assertLoggedTimes(level, count, match?)` | Assert exact count of matching entries |
| `assertNothingLogged()` | Assert zero entries |
| `clear()` | Clear all captured entries |

## `logger()` Helper

Shortcut function for quick access:

```ts
import { logger } from '@rudderjs/log'

logger('Quick debug message')      // logs at debug level
const log = logger()               // returns the Log facade
log.info('Using the facade')
```

## Configuration

```ts
interface LogChannelConfig {
  driver:            string
  level?:            LogLevel
  path?:             string      // single, daily
  days?:             number      // daily (default 14)
  channels?:         string[]    // stack
  ignoreExceptions?: boolean     // stack
  formatter?:        'line' | 'json'
  [key: string]:     unknown     // custom driver options
}

interface LogConfig {
  default:  string
  channels: Record<string, LogChannelConfig>
}
```

## Notes

- Registering the `log()` provider automatically wires unhandled exceptions to the default log channel via `setExceptionReporter()`.
- Stack channels are resolved after all other channels, so referenced channels must exist in the config.
- The `daily` driver creates files like `app-2026-04-06.log` and removes files older than `days`.
- Context merges in order: shared context, then per-channel context, then per-call context.
- `LogRegistry.forgetChannel(name)` frees memory and forces re-creation on next access.
- All log methods return `void | Promise<void>` — file-based drivers are async, console is sync.
