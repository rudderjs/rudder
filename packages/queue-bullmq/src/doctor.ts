// Doctor checks contributed by @rudderjs/queue-bullmq.

import path from 'node:path'
import { registerDoctorCheck, type DoctorResult } from '@rudderjs/console'

registerDoctorCheck({
  id:       'queue-bullmq:redis-url',
  category: 'queue',
  title:    'REDIS_URL',
  run(): DoctorResult {
    const v = process.env['REDIS_URL'] ?? process.env['QUEUE_REDIS_URL']
    if (!v) {
      return {
        status:  'error',
        message: 'unset — queue worker cannot connect',
        fix:     'Add REDIS_URL to .env (e.g. `redis://localhost:6379`). For dev: `brew install redis && redis-server`',
      }
    }
    if (!/^redis(s)?:\/\//.test(v)) {
      return {
        status:  'warn',
        message: `set but doesn't start with redis:// or rediss:// — current value starts with "${v.slice(0, 20)}…"`,
      }
    }
    return { status: 'ok', message: 'set' }
  },
})

// ─── --deep checks ────────────────────────────────────────
//
// runtime:redis-ping — open a short-lived Redis connection, PING, close.
// `ioredis` is the queue-bullmq peer; resolve from the user's app rather
// than CLI's node_modules.

registerDoctorCheck({
  id:        'queue-bullmq:redis-ping',
  category:  'runtime',
  title:     'Redis connectivity',
  needsBoot: true,
  async run(): Promise<DoctorResult> {
    const url = process.env['REDIS_URL'] ?? process.env['QUEUE_REDIS_URL']
    if (!url) {
      return { status: 'ok', message: 'no REDIS_URL — skip (covered by queue-bullmq:redis-url)' }
    }
    const userRequire = (await import('node:module')).createRequire(path.join(process.cwd(), 'package.json'))
    type RedisCtor = new (url: string, opts?: { lazyConnect?: boolean; connectTimeout?: number; maxRetriesPerRequest?: number | null }) => {
      ping(): Promise<string>
      quit(): Promise<unknown>
      disconnect(): void
    }
    let Redis: RedisCtor
    try {
      const mod = userRequire('ioredis') as { default?: RedisCtor; Redis?: RedisCtor }
      Redis = (mod.default ?? mod.Redis) as RedisCtor
    } catch {
      return { status: 'warn', message: 'ioredis not resolvable — skip', fix: 'pnpm add ioredis' }
    }
    const client = new Redis(url, {
      // Don't auto-retry — fail fast in doctor.
      lazyConnect: true, connectTimeout: 2000, maxRetriesPerRequest: 0,
    })
    const t0 = performance.now()
    try {
      await client.ping()
      const ms = Math.round(performance.now() - t0)
      return { status: 'ok', message: `PONG in ${ms}ms` }
    } catch (e) {
      const msg = (e instanceof Error ? e.message : String(e)).split('\n')[0]!.trim()
      return {
        status:  'error',
        message: msg.slice(0, 200),
        fix:     `Verify Redis is running at ${url}. For local dev: \`brew services start redis\` (macOS) or \`docker run -d -p 6379:6379 redis\`.`,
      }
    } finally {
      try { await client.quit() } catch { client.disconnect() }
    }
  },
})
