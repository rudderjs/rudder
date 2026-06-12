# Notifications

`@rudderjs/notification` is a multi-channel notification layer. You define a notification once and the framework dispatches it through any combination of channels — mail, database, broadcast, and your own custom channels — without your code knowing the difference.

## Setup

```bash
pnpm add @rudderjs/notification
```

The notification provider depends on `@rudderjs/mail` (for the mail channel) and `@rudderjs/orm` with a database provider (for the database channel). Auto-discovery boots them in the right order. For manual ordering, list `MailProvider` before `NotificationProvider`:

```ts
// bootstrap/providers.ts
import { DatabaseProvider } from '@rudderjs/orm-prisma'
import { MailProvider } from '@rudderjs/mail'
import { NotificationProvider } from '@rudderjs/notification'

export default [
  DatabaseProvider,
  MailProvider,
  NotificationProvider,
]
```

## The Notifiable interface

Anything that can receive a notification implements `Notifiable`:

```ts
interface Notifiable {
  readonly id:     string | number
  readonly email?: string    // required for the mail channel
  readonly name?:  string
}
```

A standard `User` model with `id` and `email` already satisfies it.

## Defining a notification

Extend `Notification`, return the channels in `via()`, and provide one method per channel:

```ts
import { Notification } from '@rudderjs/notification'
import { Mailable } from '@rudderjs/mail'
import type { Notifiable } from '@rudderjs/notification'

class WelcomeMail extends Mailable {
  constructor(private readonly name: string, private readonly token: string) { super() }
  build() {
    return this
      .subject('Welcome')
      .html(`<p>Hi ${this.name}, <a href="/verify?token=${this.token}">verify here</a>.</p>`)
      .text(`Hi ${this.name}, verify here: /verify?token=${this.token}`)
  }
}

export class WelcomeNotification extends Notification {
  constructor(private readonly token: string) { super() }

  via(_user: Notifiable): string[] { return ['mail', 'database'] }

  toMail(user: Notifiable) {
    return new WelcomeMail(user.name ?? 'there', this.token)
  }

  toDatabase(_user: Notifiable) {
    return { message: 'Welcome!', token: this.token }
  }
}
```

## Sending

```ts
import { notify } from '@rudderjs/notification'

await notify(user, new WelcomeNotification(token))

// To many recipients at once
await notify([alice, bob, carol], new WelcomeNotification(token))
```

`notify()` resolves the channels for each recipient and dispatches concurrently (a `Promise.all` over every recipient × channel pair). A single rejection rejects the whole `notify()` call — wrap individual sends if you need per-recipient isolation.

## Channels

### Mail

Routes through `@rudderjs/mail`. The `toMail()` method returns a `Mailable` and the channel handles the rest. Honors the recipient's `email` field; throws if missing when `'mail'` is in `via()`.

### Database

Persists notifications to a `notifications` table for in-app feeds. Run the migration once:

```bash
pnpm rudder vendor:publish --tag=notification-schema
pnpm rudder migrate
```

`toDatabase()` returns a JSON-serializable payload. The framework writes a row with the recipient, type, and payload. Read them back by querying your own model on the `notifications` table, filtering on the `notifiable_id` column.

### Broadcast

Pushes the notification over WebSockets via `@rudderjs/broadcast` (install it to enable the channel). Implement `toBroadcast()` to return the payload; the channel emits it as an event named after the notification class. The target channel is the notifiable's `broadcast` route when set (anonymous notifiables via `.route('broadcast', ...)`), otherwise `user.{id}`.

```ts
toBroadcast(user: Notifiable) {
  return { message: 'Your report is ready', url: '/reports/latest' }
}
```

### Custom

Implement `NotificationChannel` and register it via `ChannelRegistry.register(name, channel)`:

```ts
import type { NotificationChannel, Notifiable, Notification } from '@rudderjs/notification'
import { ChannelRegistry } from '@rudderjs/notification'

class SlackChannel implements NotificationChannel {
  async send(notifiable: Notifiable, notification: Notification): Promise<void> {
    const payload = (notification as { toSlack(n: Notifiable): { webhook: string } }).toSlack(notifiable)
    await fetch(payload.webhook, { method: 'POST', body: JSON.stringify(payload) })
  }
}

ChannelRegistry.register('slack', new SlackChannel())
```

Then add `'slack'` to `via()` on any notification with a `toSlack()` method.

## Background dispatch

For high-volume sends, queue the notification rather than sending inline:

```ts
import { Job } from '@rudderjs/queue'

class SendNotificationJob extends Job {
  constructor(private readonly userId: string, private readonly type: string) { super() }
  async handle() {
    const user = await User.find(this.userId)
    await notify(user, buildNotification(this.type))
  }
}

await SendNotificationJob.dispatch(user.id, 'welcome').send()
```

For an automatic queue route, make the notification queueable by implementing the `ShouldQueue` interface — the notifier then routes the dispatch to the queue for you, no wrapping job required.

## Testing

`NotificationFake.fake()` returns a fake instance — assertions live on the fake, not on `Notification`:

```ts
import { NotificationFake } from '@rudderjs/notification'

const fake = NotificationFake.fake()
await UserService.signup({ email: 'a@b.com' })

fake.assertSentTo(user, WelcomeNotification)
fake.assertSentToTimes(user, WelcomeNotification, 1)
fake.assertNotSentTo(user, PasswordResetNotification)
fake.assertCount(1)
fake.assertNothingSent()
fake.restore()
```

The fake intercepts `Notifier.send` and records dispatches in memory — the mail and database channels never fire. Call `fake.restore()` in `afterEach` so the original dispatcher is reinstated.

## Pitfalls

- **Provider order.** Auto-discovery handles this; manual orderings need `MailProvider` before `NotificationProvider`. The mail channel resolves `Mail` from DI at dispatch time and fails if no mailer exists.
- **`email` missing.** `toMail()` requires the notifiable's `email` field. The channel throws if `'mail'` is in `via()` but `notifiable.email` is undefined — handle the missing case in `via()` by branching on the recipient.
- **Database channel without the migration.** Publish the schema (`pnpm rudder vendor:publish --tag=notification-schema`) and run `pnpm rudder migrate` before sending the first database notification.
