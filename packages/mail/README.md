# @rudderjs/mail

Mail facade, mailable abstraction, and provider factory with built-in `log` and `smtp` drivers.

## Installation

```bash
pnpm add @rudderjs/mail
```

## Setup

```ts
// config/mail.ts
import type { MailConfig } from '@rudderjs/mail'

export default {
  default: Env.get('MAIL_MAILER', 'log'),
  from: {
    address: Env.get('MAIL_FROM_ADDRESS', 'noreply@example.com'),
    name:    Env.get('MAIL_FROM_NAME', 'My App'),
  },
  mailers: {
    log: { driver: 'log' },
    smtp: {
      driver:     'smtp',
      host:       Env.get('MAIL_HOST', 'smtp.mailtrap.io'),
      port:       Number(Env.get('MAIL_PORT', '587')),
      username:   Env.get('MAIL_USERNAME', ''),
      password:   Env.get('MAIL_PASSWORD', ''),
      encryption: 'tls',
    },
  },
} satisfies MailConfig
```

```ts
// bootstrap/providers.ts
import { mail } from '@rudderjs/mail'
import configs from '../config/index.js'

export default [mail(configs.mail)]
```

## Defining Mailables

Mailables describe an email. Extend `Mailable` and implement `build()` to set the subject, HTML, and plain-text body using the fluent protected methods.

```ts
import { Mailable } from '@rudderjs/mail'

export class WelcomeEmail extends Mailable {
  constructor(private readonly name: string) { super() }

  build() {
    return this
      .subject(`Welcome, ${this.name}!`)
      .html(`<h1>Hi ${this.name}, welcome aboard.</h1>`)
      .text(`Hi ${this.name}, welcome aboard.`)
  }
}
```

## Sending Mail

```ts
import { Mail } from '@rudderjs/mail'
import { WelcomeEmail } from './WelcomeEmail.js'

// Single recipient
await Mail.to('user@example.com').send(new WelcomeEmail('Alice'))

// Multiple recipients with CC and BCC
await Mail.to('a@example.com', 'b@example.com')
  .cc('manager@example.com')
  .bcc('audit@example.com')
  .send(new WelcomeEmail('Alice'))
```

## `Mail` / `MailPendingSend` Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `Mail.to(...addresses)` | `MailPendingSend` | Start a fluent send chain. |
| `.cc(...addresses)` | `this` | Add CC recipients. |
| `.bcc(...addresses)` | `this` | Add BCC recipients. |
| `.send(mailable)` | `Promise<void>` | Compile and send via the registered adapter. |

## `Mailable` Protected Methods

| Method | Description |
|--------|-------------|
| `subject(text)` | Set the email subject. |
| `html(html)` | Set the HTML body. |
| `text(text)` | Set the plain-text body. |

## Configuration

### `MailConfig`

```ts
interface MailConfig {
  default: string
  from: { address: string; name?: string }
  mailers: Record<string, MailConnectionConfig>
}
```

### `NodemailerConfig` (smtp driver)

```ts
{
  driver:      'smtp',
  host:        string,
  port:        number,
  username?:   string,
  password?:   string,
  encryption?: 'tls' | 'ssl' | 'none',
}
```

## Built-in Drivers

### `log`

Prints outgoing emails to the console. No external dependencies. Ideal for local development.

```ts
{ driver: 'log' }
```

### `smtp`

Sends emails via SMTP using Nodemailer. Requires `pnpm add nodemailer`.

```ts
{ driver: 'smtp', host: 'smtp.mailtrap.io', port: 587 }
```

## `LogAdapter`

Exported for standalone use and testing:

```ts
import { LogAdapter } from '@rudderjs/mail'

const adapter = new LogAdapter()
await adapter.send(mailable, { to: ['user@example.com'], from: { address: 'noreply@app.com' } })
```

## Notes

- `build()` can be `async` — useful for loading dynamic content before sending.
- Both `html` and `text` are optional — set at least one for deliverability.
- The global `from` address in config is used for all outgoing mail unless overridden per-mailable.
- `smtp` driver requires `pnpm add nodemailer` — it is an optional dependency.
