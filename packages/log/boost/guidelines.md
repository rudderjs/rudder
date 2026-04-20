# @rudderjs/log

## Overview

Structured logging — channels, log levels (RFC 5424), formatters, context propagation, and testing fakes. Laravel's `Log` facade rebuilt for Node.js. Drivers: `console`, `daily` (rotating file log), `stack` (multi-channel fanout), `null` (noop for tests). The `@rudderjs/core` `report()` helper routes through `Log` automatically when the provider is registered — otherwise falls back to `console.error`.

## Key Patterns

### Setup

```ts
// config/log.ts
export default {
  default: 'stack',
  channels: {
    stack:   { driver: 'stack', channels: ['console', 'daily'] },
    console: { driver: 'console', level: 'debug' },
    daily:   { driver: 'daily', path: 'storage/logs/rudderjs.log', days: 14 },
    null:    { driver: 'null' },
  },
} satisfies LogConfig

// bootstrap/providers.ts
import { log } from '@rudderjs/log'
export default [log(configs.log), ...]
```

### Usage

```ts
import { Log } from '@rudderjs/log'

// Levels (highest → lowest severity): emergency, alert, critical, error, warning, notice, info, debug
Log.emergency('System unusable')
Log.error('Payment failed', { orderId, error })
Log.warning('Cache miss spike', { rate: 0.87 })
Log.info('User signed in', { userId })
Log.debug('Cache key resolved', { key, hit: true })

// Target a specific channel
Log.channel('daily').error('Detailed diagnostic', { stack })
```

### Log context (request-scoped fields)

Add fields that get merged into every log call for the duration of a request or block:

```ts
Log.withContext({ requestId, userId }, async () => {
  Log.info('Processing request')   // includes requestId + userId
  await doWork()
})
```

Uses AsyncLocalStorage — scoped to the async chain, not global. Middleware that sets `requestId` at the top of a request gets it on every log line from that request's handlers.

### Testing

```ts
import { LogFake } from '@rudderjs/log'

const fake = LogFake.fake()
Log.info('hello')
fake.assertLogged('info', msg => msg.includes('hello'))
fake.assertNothingLogged()
fake.restore()
```

## Common Pitfalls

- **`daily` driver without a writable `path`.** Ensure the directory exists and the process has write permissions. `storage/logs/` is the convention — the scaffolder creates it.
- **`stack` driver referencing unknown channels.** The array must reference channel keys that exist in the same config. Typo = silent no-op for the bad channel.
- **Logging sensitive data.** Passwords, tokens, raw credit card numbers. `Log` does not redact — filter at the call site or use a custom formatter. `@rudderjs/telescope` does redact, but Log doesn't.
- **Log in hot paths.** The `daily` driver writes synchronously by default. High-throughput endpoints should log to `console` (fast) and ship off-process with a collector, not write to disk per-request.
- **`report()` without `log` provider.** `@rudderjs/core`'s `report()` tries `Log` first, falls back to `console.error`. Registering `log()` in providers routes reports through the log channel automatically — no manual wiring needed.
- **Logger timestamp vs app timestamp.** Log entries use the wall clock at log-time, not the request start time. If you need correlated timestamps, pass them explicitly in the context object.

## Key Imports

```ts
import { log, Log, LogFake } from '@rudderjs/log'

import type { LogConfig, LogLevel, LogEntry, LogChannel } from '@rudderjs/log'
```
