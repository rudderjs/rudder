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
import { LogProvider } from '@rudderjs/log'
export default [LogProvider]
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

### Log context (sticky fields)

Add fields that get merged into every subsequent log call:

```ts
// Mutates the default channel's local context — sticky until withoutContext() / reset
Log.withContext({ requestId, userId })
Log.info('Processing request')        // includes requestId + userId
Log.withoutContext(['requestId'])     // drop a key
Log.withoutContext()                  // clear all local context

// Or share across every channel (current and future)
Log.shareContext({ deploymentId })
Log.flushSharedContext()
```

`withContext()` does NOT take a callback — there is no built-in scoped form, and the call mutates the channel until cleared. For per-request scoping, pair with `@rudderjs/context` (an AsyncLocalStorage data bag): set fields on the request scope and read them inside a custom formatter or via a `Log.listen(...)` listener. If you instead use `Log.withContext()` per-request, you must call `withoutContext(keys)` at request end to avoid leakage across requests.

### Testing

```ts
import { LogFake, LogRegistry } from '@rudderjs/log'

const fake = new LogFake()
LogRegistry.register('fake', fake, 'debug')
LogRegistry.setDefault('fake')

Log.info('hello')
fake.assertLogged('info', 'hello')
fake.assertNotLogged('error', 'unexpected')
```

## Common Pitfalls

- **`daily` driver without a writable `path`.** Ensure the directory exists and the process has write permissions. `storage/logs/` is the convention — the scaffolder creates it.
- **`stack` driver referencing unknown channels.** The array must reference channel keys that exist in the same config. Typo = silent no-op for the bad channel.
- **Logging sensitive data.** Passwords, tokens, raw credit card numbers. `Log` does not redact — filter at the call site or use a custom formatter. `@rudderjs/telescope` does redact, but Log doesn't.
- **Log in hot paths.** The `daily` driver writes synchronously by default. High-throughput endpoints should log to `console` (fast) and ship off-process with a collector, not write to disk per-request.
- **`report()` without `LogProvider`.** `@rudderjs/core`'s `report()` tries `Log` first, falls back to `console.error`. Registering `LogProvider` routes reports through the log channel automatically — no manual wiring needed.
- **Logger timestamp vs app timestamp.** Log entries use the wall clock at log-time, not the request start time. If you need correlated timestamps, pass them explicitly in the context object.

## Key Imports

```ts
import { LogProvider, Log, LogFake, LogRegistry, logger } from '@rudderjs/log'

import type { LogConfig, LogLevel, LogEntry, LogChannel } from '@rudderjs/log'
```
