import { Env } from '@rudderjs/core'

export default {
  name:  Env.get('APP_NAME',  'RudderJS'),
  env:   Env.get('APP_ENV',   'development'),
  debug: Env.getBool('APP_DEBUG', false),
  url:   Env.get('APP_URL', 'http://localhost:3000'),
}
