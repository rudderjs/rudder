# Mail

`@rudderjs/mail` is the framework's email layer. You define an email as a `Mailable` class, configure a transport (log for dev, SMTP for production), and send with `Mail.to(address).send(...)`. Switching transports is a config change.

## Setup

```bash
pnpm add @rudderjs/mail
```

For SMTP add the Nodemailer driver:

```bash
pnpm add nodemailer
pnpm add -D @types/nodemailer
```

```ts
// config/mail.ts
import { Env } from '@rudderjs/support'
import type { MailConfig } from '@rudderjs/mail'

export default {
  default: Env.get('MAIL_MAILER', 'log'),
  from: {
    address: Env.get('MAIL_FROM_ADDRESS', 'hello@example.com'),
    name:    Env.get('MAIL_FROM_NAME', 'Rudder App'),
  },
  mailers: {
    log: { driver: 'log' },
    smtp: {
      driver:     'smtp',
      host:       Env.get('MAIL_HOST', 'smtp.example.com'),
      port:       Env.getNumber('MAIL_PORT', 587),
      username:   Env.get('MAIL_USERNAME', ''),
      password:   Env.get('MAIL_PASSWORD', ''),
      encryption: Env.get('MAIL_ENCRYPTION', 'tls'),  // 'tls' | 'ssl' | 'none'
    },
  },
} satisfies MailConfig
```

The provider is auto-discovered. The `log` driver writes mail to the console — use it in development to see what gets sent without delivering anything.

## Mailable classes

Define each email as a class extending `Mailable`. Use the protected `subject()`, `html()`, and `text()` helpers inside `build()`:

```ts
import { Mailable } from '@rudderjs/mail'

export class WelcomeEmail extends Mailable {
  constructor(private readonly user: User) { super() }

  build() {
    return this
      .subject(`Welcome, ${this.user.name}!`)
      .html(`<h1>Hello, ${this.user.name}!</h1><p>Thanks for joining.</p>`)
      .text(`Hello, ${this.user.name}! Thanks for joining.`)
  }
}
```

Generate stubs with `pnpm rudder make:mail Welcome`.

For richer templates, render the body with `@rudderjs/view` (vanilla mode):

```ts
import { html } from '@rudderjs/view'
import { Mailable } from '@rudderjs/mail'

export class WelcomeEmail extends Mailable {
  build() {
    const body = html`
      <h1>Welcome, ${this.user.name}!</h1>
      <p>Confirm your email by clicking <a href="${this.url}">here</a>.</p>
    `
    return this
      .subject('Welcome')
      .html(body.toString())
      .text(`Welcome, ${this.user.name}!`)
  }
}
```

## Sending mail

```ts
import { Mail } from '@rudderjs/mail'

await Mail.to('user@example.com').send(new WelcomeEmail(user))

await Mail
  .to('alice@example.com', 'bob@example.com')
  .cc('manager@example.com')
  .bcc('archive@example.com')
  .send(new WelcomeEmail(user))
```

`Mail.to(...)`, `cc(...)`, and `bcc(...)` each accept one or more addresses.

## Sending mail in the background

Mailables work as queue jobs out of the box — wrap the send in a job and queue it:

```ts
import { Job } from '@rudderjs/queue'
import { Mail } from '@rudderjs/mail'
import { WelcomeEmail } from '../Mail/WelcomeEmail.js'
import { User } from '../Models/User.js'

export class SendWelcomeEmail extends Job {
  constructor(private readonly userId: string) { super() }

  async handle() {
    const user = await User.find(this.userId)
    await Mail.to(user.email).send(new WelcomeEmail(user))
  }
}

await SendWelcomeEmail.dispatch(user.id)
```

See [Queues](/guide/queues) for the broader job model.

## Drivers

### Log

Writes the rendered email (subject, recipients, HTML, text) to the console. Default for development. No external dependencies.

```ts
{ driver: 'log' }
```

### SMTP

Sends mail via Nodemailer. Works with any SMTP server — Postmark, SendGrid, AWS SES, your own MTA.

```ts
{
  driver:     'smtp',
  host:       'smtp.example.com',
  port:       587,
  username:   '...',
  password:   '...',
  encryption: 'tls',   // 'tls' | 'ssl' | 'none'
}
```

For services with their own Nodemailer transport (Postmark, SendGrid, Mailgun), implement a custom adapter — see the next section.

## Custom drivers

Implement `MailAdapter` for proprietary providers (Resend, Loops, in-house) and register the adapter through the registry. `MailRegistry.set(adapter)` takes a single adapter — there is no name argument; the registry holds one active adapter at a time.

```ts
import { MailRegistry, type MailAdapter } from '@rudderjs/mail'

class ResendAdapter implements MailAdapter { /* ... */ }

MailRegistry.set(new ResendAdapter())
```

For multi-mailer apps, route at the call site (branching on env / feature flag) rather than expecting the registry to multiplex.

## Testing

`Mail.fake()` returns a `FakeMailAdapter` instance — assertions live on the returned fake, not on `Mail`:

```ts
import { Mail } from '@rudderjs/mail'
import { WelcomeEmail } from '../app/Mail/WelcomeEmail.js'

const fake = Mail.fake()
await UserService.signup({ email: 'a@b.com' })

fake.assertSent(WelcomeEmail)
// Predicate receives { mailable, options } — recipient lives on options.to
fake.assertSent(WelcomeEmail, (entry) => entry.options.to.includes('a@b.com'))
fake.assertSentCount(1)
fake.assertSentTimes(WelcomeEmail, 1)
fake.assertNotSent(PasswordResetEmail)
fake.assertNothingSent()
fake.restore()   // clear the fake adapter and reset the registry
```

### Combined sent + queued assertions

When the code under test might either dispatch synchronously OR via the queue (a feature-flagged path, a retry policy, etc.) the combined helpers assert against both channels together so the test doesn't have to know which one ran:

```ts
fake.assertOutgoing(WelcomeEmail)                // sent OR queued
fake.assertOutgoing(WelcomeEmail, ({ mailable, options }) => options.to.includes('a@b.com'))
fake.assertOutgoingCount(2)                      // sent + queued combined
fake.assertNothingOutgoing()                     // neither sent nor queued

fake.outgoing()                // all entries across both channels
fake.outgoing(WelcomeEmail)    // filtered by class
```

Exact-count variants are also available per-channel:

```ts
fake.assertSentTimes(WelcomeEmail, 2)
fake.assertQueuedTimes(WelcomeEmail, 1)
```

The fake captures every send into memory — no real delivery, no queue side effects. Call `fake.restore()` in `afterEach` so subsequent tests start with a fresh registry.

## Pitfalls

- **Forgetting `from`.** The provider throws at boot if `from.address` is empty. Set `MAIL_FROM_ADDRESS` in `.env`.
- **`log` driver in production.** Mail goes to your stdout, not the recipient's inbox. Switch to `smtp` (or a custom driver) before deploying.
- **SPF / DKIM not set up.** Even with valid SMTP, mail without proper DNS lands in spam. Configure SPF, DKIM, and DMARC for your sending domain.
- **Sending from a request handler with a slow SMTP server.** Wrap in a queue job — synchronous SMTP can take seconds and tie up your handler. See the queue example above.
