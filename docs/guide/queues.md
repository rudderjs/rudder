# Queues

`@rudderjs/queue` is the framework's background job system. You define a job as a class with a `handle()` method, dispatch it from a route or service, and a worker process picks it up and runs it. The same job code runs against any adapter — the zero-infra `database` driver backed by the native engine (the default), BullMQ (Redis), Inngest, or the in-process `sync` driver for development.

## Setup

```bash
pnpm add @rudderjs/queue
```

The `database` driver ships in the core `@rudderjs/queue` package — no extra install. For Redis-backed queues:

```bash
pnpm add @rudderjs/queue-bullmq bullmq ioredis
```

For Inngest:

```bash
pnpm add @rudderjs/queue-inngest inngest
```

```ts
// config/queue.ts
import { Env } from '@rudderjs/support'

export default {
  default: Env.get('QUEUE_CONNECTION', 'database'),
  connections: {
    // Zero-infra default: a dedicated native-engine store. `engine` + `url`
    // give the queue its OWN SQLite file (independent of the app's DB); the
    // `jobs` / `failed_jobs` tables are auto-created on first use — no Redis,
    // no migration step.
    database: {
      driver: 'database',
      engine: 'sqlite',
      url:    Env.get('QUEUE_DB_URL', './queue.db'),
    },
    sync:   { driver: 'sync' },
    bullmq: {
      driver: 'bullmq',
      connection: {
        host: Env.get('REDIS_HOST', 'localhost'),
        port: Env.getNumber('REDIS_PORT', 6379),
      },
    },
    inngest: {
      driver:    'inngest',
      eventKey:  Env.get('INNGEST_EVENT_KEY', ''),
      signingKey: Env.get('INNGEST_SIGNING_KEY', ''),
    },
  },
}
```

The provider is auto-discovered. The `database` driver is the zero-infra default — persistent jobs with no Redis. Use `sync` for tests (runs inline, no worker); switch to BullMQ or Inngest for high-throughput or serverless production.

## Defining a job

Extend `Job` and implement `handle()`. Constructor parameters are serialized into the job payload:

```ts
import { Job } from '@rudderjs/queue'

export class SendWelcomeEmail extends Job {
  static queue   = 'default'
  static retries = 3

  constructor(private readonly userId: string) { super() }

  async handle() {
    const user = await User.find(this.userId)
    await Mail.to(user.email).send(new WelcomeEmail(user))
  }
}
```

Generate stubs with `pnpm rudder make:job SendWelcomeEmail`.

## Dispatching

```ts
// Basic dispatch — uses static queue, no delay
await SendWelcomeEmail.dispatch(user.id).send()

// With options
await SendWelcomeEmail.dispatch(user.id)
  .onQueue('notifications')      // route to a specific queue
  .delay(5_000)                   // wait 5 seconds before processing
  .send()
```

| `DispatchBuilder` method | Description |
|---|---|
| `.onQueue(name)` | Route to a named queue (default: `'default'`) |
| `.delay(ms)` | Wait `ms` milliseconds before processing |
| `.send()` | Push to the configured adapter — returns `Promise<void>` |

`Job.dispatch(...)` returns a builder; you must `.send()` for the job to actually queue.

## Running workers

For the `database` and BullMQ drivers, run a separate worker process:

```bash
pnpm rudder queue:work                       # default queue
pnpm rudder queue:work notifications         # specific queue
pnpm rudder queue:work default,notifications # multiple queues (comma-separated)
```

The connection is taken from the `default` field in `config/queue.ts` — switch connections by editing the config, not via a flag.

The worker auto-discovers job classes via the framework's job registry. Stop it with Ctrl+C; in production run it under a process supervisor (systemd, pm2, Docker `restart: always`).

For Inngest, the worker is the Inngest service itself — your app exposes a `/api/inngest` endpoint that Inngest calls back to invoke jobs. No separate worker process.

## Drivers

### Sync

Runs jobs **immediately** in the current process. No Redis, no separate worker. Use it in development and tests.

```ts
{ driver: 'sync' }
```

`Job.dispatch(...).send()` becomes a regular function call. Useful for tests where you want side effects to happen synchronously.

### Database (native)

The zero-infrastructure default — persistent jobs backed by the native SQL engine, modeled on Laravel's `database` driver. Jobs live in a `jobs` table; the worker poll loop reserves them atomically with `FOR UPDATE SKIP LOCKED`, runs them through the shared job pipeline, and moves exhausted jobs to `failed_jobs`. No Redis, no external service.

Two ways to point it at storage:

```ts
// Dedicated store — the queue opens its OWN native engine, independent of the
// app's DB, and auto-creates its tables on first use. No migration step.
// Use this when the app runs on a non-native ORM (Prisma / Drizzle).
{
  driver: 'database',
  engine: 'sqlite',                 // 'sqlite' | 'pg' | 'mysql'
  url:    './queue.db',             // file path or connection string
}

// App ORM — omit `engine`/`url` to run against the app's registered native
// adapter. Create the tables first:
//   pnpm rudder queue:table   # stubs create_jobs_table + create_failed_jobs_table
//   pnpm rudder migrate
{
  driver: 'database',
  table:  'jobs',                   // optional, defaults shown
  // failedTable: 'failed_jobs',
  // retryAfter:  90,               // seconds before a reserved-but-stalled job is retried
}
```

Best for self-hosted apps that want durable background jobs without standing up Redis. Run the worker with `pnpm rudder queue:work` and supervise it like any other long-lived process.

### BullMQ (Redis)

Backed by `bullmq` over Redis. Supports priorities, delayed jobs, retries with exponential backoff, scheduled (repeating) jobs, and a separate worker process.

```ts
{
  driver: 'bullmq',
  connection: { host: '127.0.0.1', port: 6379 },
}
```

Best for self-hosted setups where you already run Redis.

### Inngest

Backed by Inngest's hosted (or self-hosted) service. Inngest manages durability, retries, and scheduling externally — your app exposes an HTTP endpoint that Inngest calls to invoke jobs.

```ts
{
  driver:     'inngest',
  eventKey:   'evt_...',
  signingKey: 'signkey-...',
}
```

Best for serverless deployments (Vercel, Netlify, Cloudflare) where running a long-lived worker process isn't an option.

## Failed jobs

By default, jobs retry `static retries` times with exponential backoff. After the final failure, the job moves to a "failed" set (BullMQ) or is reported as failed (Inngest). Inspect failures with the adapter's tooling:

```bash
# List failed jobs on a queue
pnpm rudder queue:failed default
```

Retry a failed job with `pnpm rudder queue:retry`, or check throughput and depth with `pnpm rudder queue:status`.

For granular retry control, override `static retries` or implement `failed(error)` on the job class:

```ts
export class SendWelcomeEmail extends Job {
  static retries = 5

  async handle()       { /* ... */ }
  async failed(err: Error) {
    Log.error('SendWelcomeEmail failed', { userId: this.userId, error: err.message })
  }
}
```

## Testing

```ts
import { Queue } from '@rudderjs/queue'
import { SendWelcomeEmail } from '../app/Jobs/SendWelcomeEmail.js'

const fake = Queue.fake()
await UserService.signup({ email: 'a@b.com' })

fake.assertPushed(SendWelcomeEmail)
fake.assertPushed(SendWelcomeEmail, (j) => j.userId === '42')
fake.assertNothingPushed()
```

`Queue.fake()` captures dispatched jobs in memory and never invokes the adapter — assertions pass or fail without side effects.

## Job lifecycle events

`@rudderjs/queue/observers` exposes a process-wide event stream of job transitions — used by `@rudderjs/telescope`, `@rudderjs/horizon`, and `@rudderjs/pulse` for telemetry, and available to your app for custom dashboards or audit logs.

```ts
import { queueObservers } from '@rudderjs/queue/observers'

const unsubscribe = queueObservers.subscribe((event) => {
  // event.kind: 'job.dispatched' | 'job.active' | 'job.completed' | 'job.failed'
  log.info({ kind: event.kind, name: event.name, queue: event.queue }, 'queue event')
})
```

The registry is a `globalThis` singleton (mirrors `@rudderjs/mcp/observers`, `@rudderjs/http/observers`, `@rudderjs/ai/observers`). The `sync` adapter emits these natively; the BullMQ adapter emits them from the **worker process**, so cross-process subscribers (Horizon's `RedisStorage`) see every transition without the dispatcher needing to be involved.

## Pitfalls

- **`sync` driver in production.** Jobs run on the request thread, blocking the response. Switch to `database`, BullMQ, or Inngest before deploy.
- **No worker running.** With the `database` or BullMQ drivers, jobs persist but never execute until `pnpm rudder queue:work` is running. Add it to your process supervisor.
- **Constructor side effects.** Serialization happens at dispatch time. Avoid network calls in the constructor — fetch data inside `handle()` instead.
- **Large payloads.** Job arguments serialize to JSON and live in Redis (or Inngest). Pass IDs and re-fetch records inside `handle()` rather than passing entire models.
