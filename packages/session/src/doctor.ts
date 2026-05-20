// Doctor checks contributed by @rudderjs/session.

import { registerDoctorCheck, type DoctorResult } from '@rudderjs/console'

registerDoctorCheck({
  id:       'session:secret',
  category: 'auth',
  title:    'SESSION_SECRET',
  run(): DoctorResult {
    // SESSION_SECRET is optional — sessions fall back to APP_KEY for signing
    // when unset. We only warn if it IS set but suspiciously short.
    const v = process.env['SESSION_SECRET']
    if (!v) {
      return { status: 'ok', message: 'unset (sessions will sign with APP_KEY)' }
    }
    if (v.length < 32) {
      return {
        status:  'warn',
        message: `set but only ${v.length} chars — recommend ≥ 32`,
        fix:     'Regenerate SESSION_SECRET with `node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"`',
      }
    }
    return { status: 'ok', message: `set, ${v.length} chars` }
  },
})
