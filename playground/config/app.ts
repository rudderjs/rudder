import { Env } from '@forge/support'

export default {
  name:  Env.get('APP_NAME',  'Forge'),
  env:   Env.get('APP_ENV',   'development'),
  debug: Env.getBool('APP_DEBUG', false),
  url:   Env.get('APP_URL',   'http://localhost:3000'),
  port:  Env.getNumber('PORT', 3000),
}
