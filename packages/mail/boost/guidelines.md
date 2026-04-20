# @rudderjs/mail

## Overview

Mail facade + mailable abstraction with built-in `log` (for dev) and `smtp` drivers. Laravel's `Mail` facade for Node. Mailables are classes with a `build()` method that configures subject/to/cc/bcc/html/text/attachments fluently. Integrates with `@rudderjs/notification` — the `mail` channel accepts `Mailable` instances.

## Key Patterns

### Setup

```ts
// config/mail.ts
export default {
  default: 'smtp',
  from: { address: 'noreply@example.com', name: 'My App' },
  mailers: {
    log:  { driver: 'log' },                                  // logs to console, no send
    smtp: { driver: 'smtp', host: '...', port: 587, username: '...', password: '...', encryption: 'tls' },
  },
} satisfies MailConfig

// bootstrap/providers.ts
import { mail } from '@rudderjs/mail'
export default [mail(configs.mail), ...]
```

Use `log` driver in dev and tests — no external SMTP required, all mail prints to the console.

### Defining Mailables

```ts
import { Mailable } from '@rudderjs/mail'

export class WelcomeMail extends Mailable {
  constructor(private user: { email: string; name: string }) { super() }

  build() {
    return this
      .to(this.user.email, this.user.name)
      .subject(`Welcome, ${this.user.name}!`)
      .html(`<h1>Hi ${this.user.name}</h1><p>Thanks for signing up.</p>`)
      .text(`Hi ${this.user.name}\n\nThanks for signing up.`)
  }
}
```

### Sending

```ts
import { Mail } from '@rudderjs/mail'

// Fluent
await Mail.to('user@example.com').send(new WelcomeMail(user))
await Mail.to(user.email, user.name).cc('team@example.com').bcc('log@example.com').send(new WelcomeMail(user))

// Send to multiple recipients
await Mail.to(['a@example.com', 'b@example.com']).send(new Announcement())

// Target a specific mailer
await Mail.mailer('log').to(user.email).send(new WelcomeMail(user))
```

### Attachments

```ts
build() {
  return this
    .subject('Invoice')
    .html('<p>See attached.</p>')
    .attach('storage/invoices/123.pdf')                              // from disk
    .attachData(pdfBuffer, 'invoice.pdf', { contentType: 'application/pdf' })  // from buffer
}
```

### Testing

```ts
import { MailFake } from '@rudderjs/mail'

const fake = MailFake.fake()
await Mail.to('user@example.com').send(new WelcomeMail(user))

fake.assertSent(WelcomeMail)
fake.assertSent(WelcomeMail, m => m.to[0] === 'user@example.com')
fake.assertSentCount(1)
fake.assertNotSent(PasswordResetMail)
fake.restore()
```

## Common Pitfalls

- **`smtp` driver with bad credentials.** The driver lazy-loads `nodemailer` and sends on first call. Failures surface at send-time, not at boot. Use `log` driver in dev to avoid hitting SMTP at all.
- **Missing `from` address.** Required in config — throws at send-time if unset. The `from: { address, name }` block is not optional.
- **Mailable without `build()`.** Silent — send goes through with empty headers. Always implement `build()` and return `this` from the chain so the configuration actually applies.
- **HTML without text fallback.** Best practice: always set both `.html()` and `.text()`. Some clients (plain-text subscribers, accessibility tools) don't render HTML.
- **Forgetting `MailFake.restore()` in tests.** Fake state persists — subsequent tests assert against stale sends. Always restore in `afterEach`.
- **Telescope records mail.** `@rudderjs/telescope`'s `mail` collector records every send with subject, recipients, html, attachments. Redact sensitive fields via config if needed.
- **Method-as-property bug.** `mailable['subject']` returns the fluent setter function, not the value. Use `mailable.getSubject()` or read the private `_subject` field. This has bitten several collectors — don't assume bracket-access returns values for fluent builder classes.

## Key Imports

```ts
import { mail, Mail, Mailable, MailFake } from '@rudderjs/mail'

import type { MailConfig, MailDriver, MailableContract } from '@rudderjs/mail'
```
