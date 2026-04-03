# @rudderjs/notification

Multi-channel notification system — send notifications via mail, database, or custom channels.

## Installation

```bash
pnpm add @rudderjs/notification
```

## Setup

The `notifications()` provider must be registered after the `mail()` provider in `bootstrap/providers.ts`, since the built-in `MailChannel` depends on the mail adapter being available:

```ts
// bootstrap/providers.ts
import { mail } from '@rudderjs/mail'
import { notifications } from '@rudderjs/notification'
import configs from '../config/index.js'

export default [
  // ...other providers
  mail(configs.mail),
  notifications(),           // must come after mail()
  DatabaseServiceProvider,
  AppServiceProvider,
]
```

## The `Notifiable` Interface

Any object that can receive a notification must satisfy the `Notifiable` interface:

```ts
interface Notifiable {
  readonly id:    string | number
  readonly email?: string   // required for the mail channel
  readonly name?:  string
}
```

Your `User` model works out of the box if it has an `id` and `email`:

```ts
// app/Models/User.ts
export class User extends Model {
  static table = 'users'
  id!: string
  name!: string
  email!: string
}
```

## Defining Notifications

Extend the `Notification` abstract base class and implement `via()`. Add `toMail()` and/or `toDatabase()` for the respective channels:

```ts
// app/Notifications/WelcomeNotification.ts
import { Notification } from '@rudderjs/notification'
import { Mailable } from '@rudderjs/mail'
import type { Notifiable } from '@rudderjs/notification'

class WelcomeMail extends Mailable {
  constructor(private readonly name: string, private readonly token: string) {
    super()
  }

  build() {
    return this
      .subject('Welcome to RudderJS')
      .html(`<p>Hi ${this.name},</p><p><a href="/verify?token=${this.token}">Verify your email</a></p>`)
      .text(`Hi ${this.name}, verify here: /verify?token=${this.token}`)
  }
}

export class WelcomeNotification extends Notification {
  constructor(private readonly token: string) {
    super()
  }

  via(_notifiable: Notifiable): string[] {
    return ['mail', 'database']
  }

  toMail(notifiable: Notifiable): Mailable {
    return new WelcomeMail(notifiable.name ?? 'there', this.token)
  }

  toDatabase(_notifiable: Notifiable): Record<string, unknown> {
    return { message: 'Welcome to the app!', token: this.token }
  }
}
```

## Sending Notifications

Use the `notify()` helper to send a notification to one or more notifiables:

```ts
// routes/api.ts
import { router } from '@rudderjs/router'
import { notify } from '@rudderjs/notification'
import { User } from '../app/Models/User.js'
import { WelcomeNotification } from '../app/Notifications/WelcomeNotification.js'

// Send to a single user
router.post('/api/users', async (req, res) => {
  const user = await User.create(req.body)

  await notify(user, new WelcomeNotification(user.verificationToken))

  return res.status(201).json({ data: user })
})

// Send to multiple users
router.post('/api/notify/all', async (req, res) => {
  const users = await User.all()

  await notify(users, new WelcomeNotification('broadcast-token'))

  return res.json({ sent: users.length })
})
```

## Built-in Channels

| Channel | Key | Requires |
|---|---|---|
| Mail | `'mail'` | `@rudderjs/mail` registered + `notifiable.email` present |
| Database | `'database'` | `@rudderjs/orm` adapter + `notifications` table in your schema |

### Database Channel — Prisma Schema

Add the `Notification` model to your Prisma schema to enable the `'database'` channel:

```prisma
// prisma/schema.prisma

model Notification {
  id              String  @id @default(cuid())
  notifiable_id   String
  notifiable_type String
  type            String
  data            String   // JSON blob
  read_at         String?
  created_at      String
  updated_at      String

  @@map("notifications")
  @@index([notifiable_type, notifiable_id])
}
```

After adding the model, regenerate the Prisma client and push the schema:

```bash
pnpm exec prisma generate
pnpm exec prisma db push
```

Row shape written by `DatabaseChannel`:

| Column | Value |
|--------|-------|
| `notifiable_id` | `String(notifiable.id)` |
| `notifiable_type` | `'users'` |
| `type` | Notification class name |
| `data` | `JSON.stringify(toDatabase())` |
| `read_at` | `null` |
| `created_at` / `updated_at` | ISO timestamp |

## Custom Channels

Implement the `NotificationChannel` interface and register your channel with `ChannelRegistry`:

```ts
// app/Channels/SmsChannel.ts
import type { NotificationChannel, Notifiable, Notification } from '@rudderjs/notification'

export class SmsChannel implements NotificationChannel {
  async send(notifiable: Notifiable, notification: Notification): Promise<void> {
    if (!('toSms' in notification)) return

    const message = (notification as any).toSms(notifiable)

    await smsProvider.send({
      to:   (notifiable as any).phone,
      body: message,
    })
  }
}
```

Register the custom channel in a service provider's `boot()` method:

```ts
// app/Providers/AppServiceProvider.ts
import { ServiceProvider } from '@rudderjs/core'
import { ChannelRegistry } from '@rudderjs/notification'
import { SmsChannel } from '../Channels/SmsChannel.js'

export class AppServiceProvider extends ServiceProvider {
  async boot(): Promise<void> {
    ChannelRegistry.register('sms', new SmsChannel())
  }
}
```

Your notifications can then return `'sms'` from `via()`:

```ts
via(notifiable: Notifiable): string[] {
  return ['mail', 'sms']
}
```

## API Reference

| Export | Description |
|---|---|
| `Notifiable` | Interface — `{ id, email?, name? }` — implement on any receivable entity |
| `Notification` | Abstract base class — implement `via()`, optionally `toMail()`, `toDatabase()` |
| `NotificationChannel` | Interface — `send(notifiable, notification): Promise<void>` — implement for custom channels |
| `ChannelRegistry` | Global registry — `register(name, channel)`, `get(name)`, `has(name)`, `reset()` |
| `MailChannel` | Built-in mail channel — delegates to `@rudderjs/mail` adapter |
| `DatabaseChannel` | Built-in database channel — inserts via `@rudderjs/orm` into the `notifications` table |
| `Notifier` | Facade — `Notifier.send(notifiables, notification)` — fans out to all channels |
| `notify(notifiables, notification)` | Convenience helper wrapping `Notifier.send()` |
| `notifications()` | Provider factory — registers `MailChannel` and `DatabaseChannel` |

## Notes

- `notifications()` must appear after `mail()` in `bootstrap/providers.ts` — the `MailChannel` resolves the mail adapter at boot time.
- All channels for a given notification are dispatched concurrently via `Promise.all` — channel order in `via()` does not imply sequential execution.
- `toMail()` returns a `Mailable` instance; `toDatabase()` returns a plain `Record<string, unknown>`. Both can be `async`.
- If a notifiable has no `email` and `'mail'` is in `via()`, `MailChannel` throws — ensure all mail-targeted notifiables have an `email` field.
- Custom channels registered via `ChannelRegistry.register()` are available globally to all notifications.
