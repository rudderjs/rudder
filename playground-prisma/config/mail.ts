import { Env } from '@rudderjs/core'

export default {
  default: Env.get('MAIL_MAILER', 'log'),

  from: {
    address: Env.get('MAIL_FROM_ADDRESS', 'hello@example.com'),
    name:    Env.get('MAIL_FROM_NAME',    'RudderJS'),
  },

  mailers: {
    log: {
      driver: 'log',
    },

    smtp: {
      driver:      'smtp',
      host:        Env.get('MAIL_HOST',     'localhost'),
      port:        Env.getNumber('MAIL_PORT', 587),
      username:    Env.get('MAIL_USERNAME', ''),
      password:    Env.get('MAIL_PASSWORD', ''),
      encryption:  Env.get('MAIL_ENCRYPTION', 'tls'),
    },
  },
}
