# Notifications

`@rudderjs/notification` is a multi-channel notification layer. You define a notification once and the framework dispatches it through any combination of channels — email, database, in-app feed, push — without your code knowing the difference.

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

Generate stubs with `pnpm rudder make:notification Welcome`.

## Sending

```ts
import { notify } from '@rudderjs/notification'

await notify(user, new WelcomeNotification(token))

// To many recipients at once
await notify([alice, bob, carol], new WelcomeNotification(token))
```

`notify()` resolves the channels for each recipient and dispatches sequentially. Errors from one recipient or channel are isolated — others still fire.

## Channels

### Mail

Routes through `@rudderjs/mail`. The `toMail()` method returns a `Mailable` and the channel handles the rest. Honors the recipient's `email` field; throws if missing when `'mail'` is in `via()`.

### Database

Persists notifications to a `notifications` table for in-app feeds. Run the migration once:

```bash
pnpm rudder vendor:publish --tag=notification-schema
pnpm rudder migrate
```

`toDatabase()` returns a JSON-serializable payload. The framework writes a row with the recipient, type, and payload. Read them back with `Notification.where('notifiableId', user.id).get()` (or your own model on the `notifications` table).

### Custom

Implement `Channel` and register it:

```ts
import type { Channel, Notifiable, Notification } from '@rudderjs/notification'
import { ChannelRegistry } from '@rudderjs/notification'

class SlackChannel implements Channel {
  async send(notifiable: Notifiable, notification: Notification): Promise<void> {
    const payload = (notification as any).toSlack(notifiable)
    await fetch(payload.webhook, { method: 'POST', body: JSON.stringify(payload) })
  }
}

ChannelRegistry.set('slack', new SlackChannel())
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

For an automatic queue route, mark the notification as queueable in a future release; for now, wrap the dispatch in a job.

## Testing

```ts
import { Notification, notify } from '@rudderjs/notification'

Notification.fake()
await UserService.signup({ email: 'a@b.com' })

Notification.assertSent(user, WelcomeNotification)
Notification.assertSentTimes(WelcomeNotification, 1)
Notification.assertNothingSent()
```

`Notification.fake()` records dispatches in memory. The mail and database channels never fire — useful when you want to assert "this notification was triggered" without verifying SMTP delivery.

## Pitfalls

- **Provider order.** Auto-discovery handles this; manual orderings need `MailProvider` before `NotificationProvider`. The mail channel resolves `Mail` from DI at dispatch time and fails if no mailer exists.
- **`email` missing.** `toMail()` requires the notifiable's `email` field. The channel throws if `'mail'` is in `via()` but `notifiable.email` is undefined — handle the missing case in `via()` by branching on the recipient.
- **Database channel without the migration.** Publish the schema (`pnpm rudder vendor:publish --tag=notification-schema`) and run `pnpm rudder migrate` before sending the first database notification.
