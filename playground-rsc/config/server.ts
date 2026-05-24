import { Env } from '@rudderjs/core'

export default {
  port:       Env.getNumber('PORT', 3001),
  trustProxy: Env.getBool('TRUST_PROXY', false),
}
