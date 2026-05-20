// Doctor checks contributed by @rudderjs/queue-bullmq.

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
    // The actual connect check (PING) moves to --deep mode in Phase 4.
  },
})
