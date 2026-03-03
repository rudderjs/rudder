# @forge/mail

Mail facade, Mailable abstraction, and provider factory.

## Installation

```bash
pnpm add @forge/mail
```

## Setup

### 1. Configure mail

```ts
// config/mail.ts
import type { MailConfig } from '@forge/mail'

export default {
  default: Env.get('MAIL_MAILER', 'log'),
  from: {
    address: Env.get('MAIL_FROM_ADDRESS', 'hello@example.com'),
    name: Env.get('MAIL_FROM_NAME', 'Forge App'),
  },
  mailers: {
    log: {
      driver: 'log',
    },
  },
} satisfies MailConfig
```

### 2. Register the provider

```ts
// bootstrap/providers.ts
import { mail } from '@forge/mail'
import configs from '../config/index.js'

export default [
  DatabaseServiceProvider,
  mail(configs.mail),
  AppServiceProvider,
]
```

## Sending Mail

### Creating a Mailable

Extend `Mailable` and implement the `build()` method. `build()` must return `this`.

```ts
import { Mailable } from '@forge/mail'

export class WelcomeEmail extends Mailable {
  constructor(private readonly userName: string) {
    super()
  }

  build() {
    return this
      .subject(`Welcome, ${this.userName}!`)
      .html(`<h1>Hello, ${this.userName}!</h1><p>Thanks for joining us.</p>`)
  }
}
```

For plain-text emails, use `.text()` instead of (or alongside) `.html()`:

```ts
build() {
  return this
    .subject('Welcome!')
    .text('Thanks for joining us.')
}
```

### Using the Mail Facade

```ts
import { Mail } from '@forge/mail'
import { WelcomeEmail } from '../app/Mail/WelcomeEmail.js'

// Send to a single recipient
await Mail.to('user@example.com').send(new WelcomeEmail('Alice'))

// Send to a recipient with a display name
await Mail.to({ address: 'user@example.com', name: 'Alice' }).send(new WelcomeEmail('Alice'))
```

### Fluent Recipient Chain

You can chain `cc()`, `bcc()`, and `replyTo()` before calling `send()`:

```ts
await Mail
  .to('user@example.com')
  .cc('manager@example.com')
  .bcc('archive@example.com')
  .replyTo('support@example.com')
  .send(new WelcomeEmail('Alice'))
```

Each method accepts either a `string` (email address) or `{ address: string, name: string }`.

## Configuration

### `MailConfig`

```ts
interface MailConfig {
  default: string
  from: { address: string; name: string }
  mailers: Record<string, MailConnectionConfig>
}
```

| Field     | Type                                   | Description                                     |
|-----------|----------------------------------------|-------------------------------------------------|
| `default` | `string`                               | Name of the default mailer to use.              |
| `from`    | `{ address: string; name: string }`    | Global sender address used for all outgoing mail. |
| `mailers` | `Record<string, MailConnectionConfig>` | Named mailer configurations.                    |

### `MailConnectionConfig`

Each mailer entry requires a `driver` field plus any driver-specific options.

```ts
// Log driver (built-in)
{ driver: 'log' }

// SMTP via @forge/mail-nodemailer
{
  driver: 'smtp',
  host: 'smtp.mailgun.org',
  port: 587,
  username: 'postmaster@mg.example.com',
  password: 'secret',
  encryption: 'tls',
}
```

## `mail(config)`

`mail(config)` returns a Forge `ServiceProvider` class that registers the configured mailers and binds the `Mail` facade during `boot()`.

## Built-in Drivers

### `log`

The `log` driver prints all outgoing email to the console. It is the recommended driver for local development — no mail server or credentials needed.

```ts
{
  driver: 'log'
}
```

## SMTP Driver

For production SMTP delivery, install `@forge/mail-nodemailer`. See the [Nodemailer adapter docs](./nodemailer).

## Notes

- `Mailable.build()` **must return `this`** — all builder methods return `this` for chaining.
- `Mail.to()` accepts a plain `string` (email address) or an object with `address` and `name` fields.
- The `log` driver is the built-in development mailer — it outputs formatted email details to `stdout` and never actually sends mail.
- The `from` address in config is used as the default sender for all messages. Individual Mailables can override it by calling `.from()` inside `build()`.
