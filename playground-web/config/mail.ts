import { Env } from '@rudderjs/core'
import { isWebContainer } from '@rudderjs/support'

// In WebContainer, raw SMTP (TCP) doesn't work — fall back to the log driver
// (writes the rendered email to stdout instead of sending).
const defaultMailer = isWebContainer() ? 'log' : Env.get('MAIL_MAILER', 'log')

export default {
  default: defaultMailer,

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
