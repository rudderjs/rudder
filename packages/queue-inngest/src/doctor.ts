// Doctor checks contributed by @rudderjs/queue-inngest.

import { registerDoctorCheck, type DoctorResult } from '@rudderjs/console'

registerDoctorCheck({
  id:       'queue-inngest:event-key',
  category: 'queue',
  title:    'INNGEST_EVENT_KEY',
  run(): DoctorResult {
    const v = process.env['INNGEST_EVENT_KEY']
    if (!v) {
      return {
        status:  'error',
        message: 'unset — inngest cannot dispatch events',
        fix:     'Add INNGEST_EVENT_KEY to .env (Inngest Dashboard → Manage → Event Keys)',
      }
    }
    if (v.length < 16) {
      return { status: 'warn', message: `set but suspiciously short (${v.length} chars)` }
    }
    return { status: 'ok', message: 'set' }
  },
})

registerDoctorCheck({
  id:       'queue-inngest:signing-key',
  category: 'queue',
  title:    'INNGEST_SIGNING_KEY',
  run(): DoctorResult {
    const v = process.env['INNGEST_SIGNING_KEY']
    if (!v) {
      return {
        status:  'warn',
        message: 'unset — webhook signature verification will be skipped (dev OK, prod risky)',
        fix:     'Add INNGEST_SIGNING_KEY to .env for production (Inngest Dashboard → Manage → Signing Keys)',
      }
    }
    return { status: 'ok', message: 'set' }
  },
})
