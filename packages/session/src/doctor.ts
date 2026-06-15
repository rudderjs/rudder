// Doctor checks contributed by @rudderjs/session.

import { registerDoctorCheck, type DoctorResult } from '@rudderjs/console'

// Known public placeholder shipped as the config default. Treated as "no
// secret" by the runtime's resolveSessionSecret() — mirror that here so the
// doctor never green-checks a forgeable signing key.
const SESSION_SECRET_PLACEHOLDER = 'change-me-in-production'

registerDoctorCheck({
  id:       'session:secret',
  category: 'auth',
  title:    'SESSION_SECRET',
  run(): DoctorResult {
    // SESSION_SECRET is optional — when unset (or the public placeholder) the
    // runtime signs sessions with APP_KEY instead. Never report "ok" for a
    // state where the effective signing key is the public placeholder.
    const raw    = (process.env['SESSION_SECRET'] ?? '').trim()
    const appKey = (process.env['APP_KEY'] ?? '').trim()

    // A SET secret equal to the public placeholder is the dangerous case.
    if (raw === SESSION_SECRET_PLACEHOLDER) {
      return appKey
        ? {
            status:  'warn',
            message: `set to the public placeholder "${SESSION_SECRET_PLACEHOLDER}" — sessions sign with APP_KEY instead, but remove the placeholder`,
            fix:     'Delete the SESSION_SECRET line (APP_KEY signs sessions) or set a real random SESSION_SECRET.',
          }
        : {
            status:  'error',
            message: `set to the public placeholder "${SESSION_SECRET_PLACEHOLDER}" and APP_KEY is unset — session cookies are FORGEABLE by anyone`,
            fix:     'Run `rudder key:generate` (sets APP_KEY) or set a real random SESSION_SECRET.',
          }
    }

    if (!raw) {
      // No SESSION_SECRET — the runtime falls back to APP_KEY (now actually
      // wired). Healthy only when APP_KEY exists; otherwise the effective key
      // is the public placeholder.
      if (!appKey) {
        return {
          status:  'error',
          message: 'unset, and APP_KEY is also unset — sessions sign with a PUBLIC placeholder and are forgeable',
          fix:     'Run `rudder key:generate` (sets APP_KEY) or set SESSION_SECRET in .env.',
        }
      }
      return { status: 'ok', message: 'unset — sessions sign with APP_KEY' }
    }

    if (raw.length < 32) {
      return {
        status:  'warn',
        message: `set but only ${raw.length} chars — recommend ≥ 32`,
        fix:     'Regenerate SESSION_SECRET with `node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"`',
      }
    }
    return { status: 'ok', message: `set, ${raw.length} chars` }
  },
})

registerDoctorCheck({
  id:       'session:cookie-secure',
  category: 'auth',
  title:    'SESSION_SECURE',
  run(): DoctorResult {
    // In production a session cookie without `Secure` is transmittable over
    // plaintext HTTP and sidejackable. The flag defaults to false and is not
    // forced, so warn when it's off in a production environment.
    const env    = (process.env['APP_ENV'] ?? process.env['NODE_ENV'] ?? '').toLowerCase()
    const isProd = env === 'production' || env === 'prod'
    const secure = /^(1|true|yes|on)$/i.test((process.env['SESSION_SECURE'] ?? '').trim())
    if (isProd && !secure) {
      return {
        status:  'warn',
        message: 'SESSION_SECURE is not enabled in a production environment — session cookies may be sent over plaintext HTTP',
        fix:     'Set SESSION_SECURE=true in production (the app is served over HTTPS).',
      }
    }
    return { status: 'ok', message: secure ? 'enabled' : 'not required (non-production)' }
  },
})
