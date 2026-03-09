import { Env } from '@boostkit/support'

export default {
  name:  Env.get('APP_NAME',  'BoostKit'),
  env:   Env.get('APP_ENV',   'development'),
  debug: Env.getBool('APP_DEBUG', false),
  url:   Env.get('APP_URL', 'http://localhost:3000'),
}
