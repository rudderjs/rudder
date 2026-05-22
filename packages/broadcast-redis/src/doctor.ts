// Doctor checks contributed by @rudderjs/broadcast-redis.

import { registerDoctorCheck, type DoctorResult } from '@rudderjs/console'

registerDoctorCheck({
  id:       'broadcast-redis:url',
  category: 'broadcast',
  title:    'REDIS_URL (broadcast fan-out)',
  run(): DoctorResult {
    const v = process.env['REDIS_URL'] ?? process.env['BROADCAST_REDIS_URL']
    if (!v) {
      return {
        status:  'warn',
        message: 'unset — broadcast-redis cannot connect; install the package OR set REDIS_URL if you need multi-instance fan-out',
        fix:     'Set REDIS_URL=redis://localhost:6379 in .env',
      }
    }
    return { status: 'ok', message: 'set' }
  },
})

registerDoctorCheck({
  id:        'broadcast-redis:connectivity',
  category:  'broadcast',
  title:     'broadcast-redis: redis reachable',
  needsBoot: true,
  async run(): Promise<DoctorResult> {
    const url = process.env['REDIS_URL'] ?? process.env['BROADCAST_REDIS_URL']
    if (!url) {
      return { status: 'warn', message: 'REDIS_URL unset — skipping connectivity probe' }
    }
    let Redis: typeof import('ioredis').Redis
    try {
      const mod = await import('ioredis')
      Redis = mod.Redis
    } catch {
      return {
        status:  'error',
        message: 'ioredis is not installed',
        fix:     'pnpm add ioredis',
      }
    }
    const client = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 0 })
    try {
      await client.connect()
      const pong = await client.ping()
      if (pong !== 'PONG') {
        return { status: 'error', message: `unexpected PING reply: ${pong}` }
      }
      return { status: 'ok', message: 'PING → PONG' }
    } catch (err) {
      return {
        status:  'error',
        message: `connect failed: ${(err as Error).message}`,
        fix:     'Verify REDIS_URL host/port + credentials; ensure redis-server is reachable',
      }
    } finally {
      try { client.disconnect() } catch { /* ignore */ }
    }
  },
})
