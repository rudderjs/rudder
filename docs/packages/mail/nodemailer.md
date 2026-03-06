# SMTP (Nodemailer)

Nodemailer SMTP support built into `@boostkit/mail`.

## Installation

```bash
pnpm add @boostkit/mail nodemailer
```

## Setup

Add an SMTP mailer to your mail configuration:

```ts
// config/mail.ts
import type { MailConfig } from '@boostkit/mail'

export default {
  default: Env.get('MAIL_MAILER', 'smtp'),
  from: {
    address: Env.get('MAIL_FROM_ADDRESS', 'hello@example.com'),
    name: Env.get('MAIL_FROM_NAME', 'BoostKit App'),
  },
  mailers: {
    log: {
      driver: 'log',
    },
    smtp: {
      driver: 'smtp',
      host: Env.get('MAIL_HOST', 'smtp.mailgun.org'),
      port: Env.getNumber('MAIL_PORT', 587),
      username: Env.get('MAIL_USERNAME'),
      password: Env.get('MAIL_PASSWORD'),
      encryption: Env.get('MAIL_ENCRYPTION', 'tls') as 'tls' | 'ssl' | 'none',
    },
  },
} satisfies MailConfig
```

No changes are needed in `bootstrap/providers.ts` — `@boostkit/mail` loads the `nodemailer` driver when it sees `driver: 'smtp'` in a mailer config.

## Configuration

### `NodemailerConfig`

| Option       | Type                      | Description                                                                 |
|--------------|---------------------------|-----------------------------------------------------------------------------|
| `driver`     | `'smtp'`                  | Must be `'smtp'` to select this adapter.                                    |
| `host`       | `string`                  | SMTP server hostname.                                                       |
| `port`       | `number`                  | SMTP server port.                                                           |
| `username`   | `string?`                 | SMTP authentication username. Omit for unauthenticated relays.              |
| `password`   | `string?`                 | SMTP authentication password. Omit for unauthenticated relays.              |
| `encryption` | `'tls' \| 'ssl' \| 'none'` | Transport security. `'tls'` uses STARTTLS (port 587); `'ssl'` uses direct TLS (port 465); `'none'` sends in plaintext. |

## `nodemailer(config, from)`

`nodemailer(config, from)` is exported from `@boostkit/mail` and returns a `MailAdapterProvider` for the `'smtp'` driver.

```ts
import { nodemailer } from '@boostkit/mail'

// Used internally by the mail() provider when driver='smtp'.
const provider = nodemailer(smtpConfig, { address: 'hello@example.com', name: 'BoostKit App' })
```

The `from` parameter sets the default sender envelope for all messages delivered through this adapter.

## Common SMTP Providers

| Provider    | Host                        | Port  | Encryption |
|-------------|-----------------------------|-------|------------|
| Gmail       | `smtp.gmail.com`            | `587` | `tls`      |
| SendGrid    | `smtp.sendgrid.net`         | `587` | `tls`      |
| Mailgun     | `smtp.mailgun.org`          | `587` | `tls`      |
| Postmark    | `smtp.postmarkapp.com`      | `587` | `tls`      |
| Amazon SES  | `email-smtp.<region>.amazonaws.com` | `587` | `tls` |
| Mailtrap    | `live.smtp.mailtrap.io`     | `587` | `tls`      |

## Notes

- The adapter is exported as `'nodemailer'` and also matched by `@boostkit/mail` when `driver: 'smtp'` is set — no manual provider registration is required.
- `encryption: 'tls'` enables STARTTLS and is the recommended setting for port `587`.
- `encryption: 'ssl'` wraps the entire connection in TLS and is used with port `465`.
- `encryption: 'none'` sends mail without transport encryption — only use this on trusted internal networks or for local development relays.
- `nodemailer` is an optional dependency for SMTP — install it explicitly in app projects that use `driver: 'smtp'`.
