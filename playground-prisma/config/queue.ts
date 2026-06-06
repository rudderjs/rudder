import { Env } from '@rudderjs/core'
import type { QueueConfig } from '@rudderjs/queue'
import { WelcomeUserJob } from 'App/Jobs/WelcomeUserJob.js'
import { FailingJob } from 'App/Jobs/FailingJob.js'

export default {
  default: Env.get('QUEUE_CONNECTION', 'bullmq'),

  connections: {
    sync: {
      driver: 'sync',
    },

    // Persistent, zero-infrastructure driver backed by the native ORM engine.
    // `engine`/`url` give the queue its OWN dedicated SQLite store (independent
    // of the app's Prisma DB) — the `jobs` / `failed_jobs` tables are created
    // automatically on first use. No Redis, no migration step.
    //
    //   QUEUE_CONNECTION=database pnpm rudder queue:demo        # dispatch a few jobs
    //   QUEUE_CONNECTION=database pnpm rudder queue:work --stop-when-empty
    database: {
      driver:     'database',
      engine:     'sqlite',
      url:        Env.get('QUEUE_DB_URL', './queue.db'),
      table:      'jobs',
      queue:      'default',
      retryAfter: 90,
      // Job classes the worker can reconstruct + run.
      jobs: [WelcomeUserJob, FailingJob],
    },

    inngest: {
      driver:     'inngest',
      appId:      Env.get('INNGEST_APP_ID',      'rudderjs-app'),
      eventKey:   Env.get('INNGEST_EVENT_KEY',   ''),
      signingKey: Env.get('INNGEST_SIGNING_KEY',  ''),
      // Job classes registered as Inngest functions.
      // Inngest calls back via POST /api/inngest to execute them.
      jobs: [WelcomeUserJob, FailingJob],
    },

    bullmq: {
      driver:   'bullmq',
      url:      Env.get('REDIS_URL', ''),
      host:     Env.get('REDIS_HOST',     '127.0.0.1'),
      port:     Env.getNumber('REDIS_PORT', 6379),
      password: Env.get('REDIS_PASSWORD', ''),
      prefix:   'rudderjs',
      // Job classes the worker can execute — add yours here.
      // Run the worker: pnpm rudder queue:work
      jobs: [WelcomeUserJob, FailingJob],
    },
  },
} satisfies QueueConfig
