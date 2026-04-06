# @rudderjs/mail

Mail facade, Mailable abstraction, and provider factory.

## Installation

```bash
pnpm add @rudderjs/mail
```

## Setup

### 1. Configure mail

```ts
// config/mail.ts
import type { MailConfig } from '@rudderjs/mail'
import { Env } from '@rudderjs/support'

export default {
  default: Env.get('MAIL_MAILER', 'log'),
  from: {
    address: Env.get('MAIL_FROM_ADDRESS', 'hello@example.com'),
    name:    Env.get('MAIL_FROM_NAME', 'RudderJS App'),
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
import { mail } from '@rudderjs/mail'
import configs from '../config/index.js'

export default [
  DatabaseServiceProvider,
  mail(configs.mail),
  AppServiceProvider,
]
```

## Sending Mail

### Creating a Mailable

Extend `Mailable` and implement the `build()` method. Use the protected `subject()`, `html()`, and `text()` helpers inside `build()`.

```ts
import { Mailable } from '@rudderjs/mail'

export class WelcomeEmail extends Mailable {
  constructor(private readonly userName: string) {
    super()
  }

  build() {
    return this
      .subject(`Welcome, ${this.userName}!`)
      .html(`<h1>Hello, ${this.userName}!</h1><p>Thanks for joining us.</p>`)
      .text(`Hello, ${this.userName}! Thanks for joining us.`)
  }
}
```

### Using the Mail Facade

```ts
import { Mail } from '@rudderjs/mail'
import { WelcomeEmail } from '../app/Mail/WelcomeEmail.js'

// Send to a single recipient
await Mail.to('user@example.com').send(new WelcomeEmail('Alice'))

// Send to multiple recipients
await Mail.to('alice@example.com', 'bob@example.com').send(new WelcomeEmail('Team'))
```

### Fluent Recipient Chain

Chain `cc()` and `bcc()` before calling `send()`:

```ts
await Mail
  .to('user@example.com')
  .cc('manager@example.com')
  .bcc('archive@example.com')
  .send(new WelcomeEmail('Alice'))
```

`cc()` and `bcc()` each accept one or more email address strings.

## Configuration

### `MailConfig`

```ts
interface MailConfig {
  default: string
  from: { address: string; name?: string }
  mailers: Record<string, MailConnectionConfig>
}
```

| Field     | Type                                    | Description                                       |
|-----------|-----------------------------------------|---------------------------------------------------|
| `default` | `string`                                | Name of the default mailer to use.                |
| `from`    | `{ address: string; name?: string }`    | Global sender address used for all outgoing mail. |
| `mailers` | `Record<string, MailConnectionConfig>`  | Named mailer configurations.                      |

### `MailConnectionConfig`

Each mailer entry requires a `driver` field plus any driver-specific options.

```ts
// Log driver (built-in)
{ driver: 'log' }

// SMTP (built-in; requires nodemailer: pnpm add nodemailer)
{
  driver:     'smtp',
  host:       'smtp.mailgun.org',
  port:       587,
  username:   'postmaster@mg.example.com',
  password:   'secret',
  encryption: 'tls',
}
```

## `mail(config)`

`mail(config)` returns a RudderJS `ServiceProvider` class that registers the configured mailers and binds the `Mail` facade during `boot()`.

## Built-in Drivers

### `log`

The `log` driver prints all outgoing email to the console. It is the recommended driver for local development — no mail server or credentials needed.

```ts
{ driver: 'log' }
```

Output format:

```
[RudderJS Mail] ──────────────────────────────────────────────────
[RudderJS Mail]  To:      user@example.com
[RudderJS Mail]  From:    RudderJS App <hello@example.com>
[RudderJS Mail]  Subject: Welcome, Alice!
[RudderJS Mail]  Text:    Hello, Alice! Thanks for joining us.
[RudderJS Mail] ──────────────────────────────────────────────────
```

### `smtp`

For production SMTP delivery, install `nodemailer` and configure the `smtp` driver. See the [Nodemailer adapter docs](./nodemailer).

## Queued Mail

Send mail in the background via `@rudderjs/queue`:

```ts
// Queue for immediate background sending
await Mail.to('user@example.com').queue(new WelcomeEmail(user))

// Queue with a delay (milliseconds)
await Mail.to('user@example.com').later(60_000, new WelcomeEmail(user))

// Specify the queue name
await Mail.to('user@example.com').onQueue('mail').queue(new WelcomeEmail(user))
```

Requires `@rudderjs/queue` to be installed and configured.

---

## Markdown Mail

`MarkdownMailable` renders markdown content into responsive HTML email with component support:

```ts
import { MarkdownMailable } from '@rudderjs/mail'

class WelcomeEmail extends MarkdownMailable {
  constructor(private user: { name: string }) { super() }

  build() {
    return this.subject('Welcome!').markdown(`
# Welcome, {{ name }}!

Thanks for signing up.

@component('button', { url: '{{ url }}' })
Get Started
@endcomponent

@component('panel')
If you didn't create this account, no action is needed.
@endcomponent
    `).with({ name: this.user.name, url: 'https://example.com/dashboard' })
  }
}
```

### Built-in Components

| Component | Description |
|---|---|
| `button` | CTA button with `url` and optional `color` attributes |
| `panel` | Info panel with left border accent |
| `table` | Markdown table rendered as HTML email table |
| `header` | Centered header with bottom border |
| `footer` | Centered footer with top border and muted text |

### Template Variables

Use `{{ key }}` syntax. Call `.with({ key: 'value' })` to set variables.

---

## Failover Transport

Try multiple mailers in order — if the first fails, automatically fall back to the next:

```ts
// config/mail.ts
mailers: {
  failover: {
    driver: 'failover',
    mailers: ['smtp', 'backup-smtp', 'log'],
    retryAfter: 60,  // seconds before retrying a failed mailer
  },
  smtp: { driver: 'smtp', host: 'mail.example.com', port: 587 },
  'backup-smtp': { driver: 'smtp', host: 'backup.example.com', port: 587 },
  log: { driver: 'log' },
}
```

---

## Mail Preview

Render a mailable as HTML in the browser for development:

```ts
import { mailPreview } from '@rudderjs/mail'

if (process.env.NODE_ENV !== 'production') {
  router.get('/mail-preview/welcome', mailPreview(() => new WelcomeEmail(sampleUser)))
}
```

Visit `/mail-preview/welcome` in the browser to see the rendered email with a preview bar showing subject and type.

---

## Notes

- `Mailable.build()` **must return `this`** — all builder methods return `this` for chaining.
- `subject()`, `html()`, and `text()` are **protected** — call them only inside `build()`.
- `Mail.to()` accepts one or more plain email address strings.
- The `from` address in config is used as the global sender for all messages.
- `build()` can be `async` — useful for loading data before building the message.
- `MarkdownMailable` auto-generates a plain-text version alongside the HTML.
- The failover adapter tracks failed mailers and skips them within the `retryAfter` window.
- `mailPreview()` should only be registered in development — never expose in production.
