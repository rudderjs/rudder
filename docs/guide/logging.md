# Logging

`@rudderjs/log` is the framework's structured logger. It supports multiple channels, RFC 5424 log levels, line and JSON formatters, and a test fake. Once registered, unhandled exceptions automatically route to your default channel — no extra wiring.

## Setup

Add a logging config:

```ts
// config/log.ts — registered under the `log` key in config/index.ts
import { resolve } from 'node:path'

export default {
  default: 'stack',
  channels: {
    console: { driver: 'console', level: 'debug' },
    file:    { driver: 'single', path: resolve('storage/logs/app.log'), level: 'info' },
    daily:   { driver: 'daily',  path: resolve('storage/logs/app.log'), level: 'info', days: 14 },
    stack:   { driver: 'stack',  channels: ['console', 'file'] },
    null:    { driver: 'null' },
  },
}
```

Register the provider:

```ts
// bootstrap/providers.ts
import { LogProvider } from '@rudderjs/log'

export default [
  ...(await defaultProviders()),
  LogProvider,
]
```

`LogProvider` is auto-discovered when `@rudderjs/log` is installed, so the explicit import is only needed when you want to skip auto-discovery. Either way, registering it wires the global exception reporter — unhandled errors flow through your default channel automatically.

## Writing logs

The `Log` facade exposes one method per RFC 5424 level. Each takes a message and an optional context object:

```ts
import { Log } from '@rudderjs/log'

Log.emergency('System unusable')
Log.alert('Action required immediately')
Log.critical('Critical condition', { service: 'payments' })
Log.error('Payment failed',         { orderId: 123, gateway: 'stripe' })
Log.warning('Deprecated API used',  { endpoint: '/v1/users' })
Log.notice('Significant event',     { userId: 42 })
Log.info('User logged in',          { userId: 42 })
Log.debug('Processing item',        { itemId: 7 })

Log.log('info', 'Custom level call', { ... })
```

Context objects are serialized into the log entry. Stick to JSON-safe primitives so file-backed channels render cleanly.

## Channels and stacks

Channels are independent log destinations — each has its own driver, minimum level, and formatter. Pick one explicitly with `Log.channel(...)` or fan out with `Log.stack([...])`:

```ts
Log.channel('file').info('Written to the file channel only')

Log.stack(['console', 'file']).error('Sent to both channels')
```

The `stack` driver is a static fan-out you configure once. Use `Log.stack([...])` for ad-hoc fan-outs that don't deserve their own config entry.

| Level | Severity |
|---|---|
| `emergency` | 0 |
| `alert` | 1 |
| `critical` | 2 |
| `error` | 3 |
| `warning` | 4 |
| `notice` | 5 |
| `info` | 6 |
| `debug` | 7 |

Each channel has a minimum level — messages below it are silently dropped.

## Drivers

- **`console`** — writes to stdout/stderr with ANSI colors. Errors (severity ≤ `error`) go to stderr.
- **`single`** — appends to one log file. Creates parent directories automatically.
- **`daily`** — daily-rotated files with configurable retention. Old files beyond `days` are cleaned up automatically. Files look like `app-2026-04-06.log`.
- **`stack`** — fan-out to a list of `channels`. Set `ignoreExceptions: true` to swallow errors from sub-channels.
- **`null`** — discard everything. Useful for tests and silenced environments.

Every driver accepts a `formatter` option: `'line'` (default) or `'json'`.

```
[2026-04-06T12:00:00.000Z] console.INFO  User logged in {"userId":42}
```

```json
{"timestamp":"2026-04-06T12:00:00.000Z","channel":"console","level":"info","message":"User logged in","context":{"userId":42}}
```

## Context propagation

Add context to the default channel for the rest of the request:

```ts
Log.withContext({ requestId: 'abc-123' })
Log.info('Processing')                     // context includes requestId
Log.withoutContext(['requestId'])
```

For context that should appear in every log entry across every channel (environment, app version, deploy id), use shared context:

```ts
Log.shareContext({ environment: 'production', deploy: 'v1.4.2' })
Log.flushSharedContext()                   // clear it
```

Context merges in three layers: shared context → per-channel context → per-call context.

## Custom drivers

Register your own driver with `extendLog()`:

```ts
import { extendLog } from '@rudderjs/log'
import type { LogAdapter, LogEntry } from '@rudderjs/log'

class SentryAdapter implements LogAdapter {
  constructor(private readonly dsn: string) {}
  async log(entry: LogEntry): Promise<void> {
    await sendToSentry(this.dsn, entry)
  }
}

extendLog('sentry', (config) => new SentryAdapter(config['dsn'] as string))
```

```ts
channels: {
  sentry: { driver: 'sentry', level: 'error', dsn: Env.get('SENTRY_DSN', '') },
}
```

For exception-only routing to a tracker, prefer `setExceptionReporter()` (see [Error Handling](/guide/error-handling)).

## Listeners

Subscribe to every entry as it's emitted:

```ts
Log.listen((entry) => {
  if (entry.level === 'error') sendToErrorTracker(entry)
})
```

Listeners fire after the channel has handled the entry. Use them for cross-cutting concerns (alerting, derived metrics, audit trails).

## Testing

Swap the default channel with `LogFake` to capture entries:

```ts
import { LogFake, LogRegistry } from '@rudderjs/log'

const fake = new LogFake()
LogRegistry.register('test', fake)
LogRegistry.setDefault('test')

await runCodeThatLogs()

fake.assertLogged('info', 'User logged in')
fake.assertNotLogged('error')
fake.assertLoggedTimes('info', 2)
fake.assertNothingLogged()
fake.clear()
```

## Pitfalls

- **Stack channels referencing missing channels.** Stacks resolve at boot; a bad name throws `Stack references unknown channel "X"`.
- **File-driver async surprises.** `console` writes synchronously; `single` and `daily` are async. If you need a guaranteed flush before exit, await the last call in your shutdown hook.
- **Context across requests.** `Log.withContext(...)` writes to the default channel's mutable context. In a long-running process this leaks across requests — for per-request context, use shared context plus `Log.flushSharedContext()` in a request-finish middleware, or pass context per call.
