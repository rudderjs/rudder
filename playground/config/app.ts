import { Env } from '@rudderjs/core'

export default {
  name:     Env.get('APP_NAME',  'RudderJS'),
  env:      Env.get('APP_ENV',   'development'),
  debug:    Env.getBool('APP_DEBUG', false),
  url:      Env.get('APP_URL', 'http://localhost:3000'),
  locale:   Env.get('APP_LOCALE', 'en'),
  fallback: Env.get('APP_FALLBACK_LOCALE', 'en'),
}
