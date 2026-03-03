# @forge/notification

Multi-channel notification system — send notifications via mail, database, or custom channels.

## Installation

```bash
pnpm add @forge/notification
```

## Setup

The `notifications()` provider must be registered after the `mail()` provider in `bootstrap/providers.ts`, since the built-in `MailChannel` depends on the mail adapter being available:

```ts
// bootstrap/providers.ts
import { mail } from '@forge/mail'
import { notifications } from '@forge/notification'
import configs from '../config/index.js'

export default [
  DatabaseServiceProvider,
  betterAuth(configs.auth),
  AppServiceProvider,
  mail(configs.mail),
  notifications(),
]
```

## The `Notifiable` Interface

Any object that can receive a notification must satisfy the `Notifiable` interface. Implement it on your user model or any entity:

```ts
interface Notifiable {
  id: string | number
  email?: string
  name?: string
}
```

Your `User` model works out of the box if it has an `id` and `email`:

```ts
// app/Models/User.ts
export class User extends Model implements Notifiable {
  static table = 'user'
  id!: string
  name!: string
  email!: string
}
```

## Defining Notifications

Extend the `Notification` abstract base class and implement `via()`. Optionally add `toMail()` and/or `toDatabase()` for the respective channels:

```ts
// app/Notifications/WelcomeNotification.ts
import { Notification, type MailMessage, type DatabaseMessage } from '@forge/notification'
import type { Notifiable } from '@forge/notification'

export class WelcomeNotification extends Notification {
  constructor(private readonly token: string) {
    super()
  }

  via(notifiable: Notifiable): string[] {
    return ['mail', 'database']
  }

  toMail(notifiable: Notifiable): MailMessage {
    return {
      to:      notifiable.email!,
      subject: 'Welcome to Forge',
      text:    `Hi ${notifiable.name ?? 'there'}, your account is ready. Verify here: /verify?token=${this.token}`,
      html:    `<p>Hi ${notifiable.name ?? 'there'},</p><p>Your account is ready.</p><p><a href="/verify?token=${this.token}">Verify your email</a></p>`,
    }
  }

  toDatabase(notifiable: Notifiable): DatabaseMessage {
    return {
      type: 'welcome',
      data: {
        message: `Welcome, ${notifiable.name ?? 'there'}!`,
        token:   this.token,
      },
    }
  }
}
```

## Sending Notifications

Use the `notify()` helper to send a notification to one or more notifiables:

```ts
// routes/api.ts
import { router } from '@forge/router'
import { notify } from '@forge/notification'
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
| Mail | `'mail'` | `@forge/mail` registered + `notifiable.email` present |
| Database | `'database'` | `@forge/orm` with a `notification` Prisma model |

### Database Channel — Prisma Schema

Add the `Notification` model to your Prisma schema to enable the `'database'` channel:

```prisma
// prisma/schema.prisma

model Notification {
  id          String   @id @default(cuid())
  userId      String
  type        String
  data        String   // JSON blob
  readAt      DateTime?
  createdAt   DateTime @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
}
```

After adding the model, regenerate the Prisma client and push the schema:

```bash
pnpm exec prisma generate
pnpm exec prisma db push
```

## Custom Channels

Implement the `NotificationChannel` interface and register your channel with `ChannelRegistry`:

```ts
// app/Channels/SmsChannel.ts
import type { NotificationChannel, Notifiable, Notification } from '@forge/notification'

export class SmsChannel implements NotificationChannel {
  async send(notifiable: Notifiable, notification: Notification): Promise<void> {
    if (!('toSms' in notification)) return

    const message = (notification as any).toSms(notifiable)

    await smsProvider.send({
      to:   notifiable.phone,
      body: message.text,
    })
  }
}
```

Register the custom channel in a service provider's `boot()` method:

```ts
// app/Providers/AppServiceProvider.ts
import { ServiceProvider } from '@forge/core'
import { ChannelRegistry } from '@forge/notification'
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
| `ChannelRegistry` | Global registry — `register(name, channel)`, `get(name)`, `has(name)` |
| `MailChannel` | Built-in mail channel — delegates to `@forge/mail` adapter |
| `DatabaseChannel` | Built-in database channel — inserts via `@forge/orm` Prisma adapter |
| `Notifier` | Facade — `Notifier.send(notifiables, notification)` — fans out to all channels |
| `notify(notifiables, notification)` | Convenience helper wrapping `Notifier.send()` |
| `notifications()` | Provider factory — registers `MailChannel` and `DatabaseChannel` |

## Notes

- `notifications()` must appear after `mail()` in `bootstrap/providers.ts` — the `MailChannel` resolves the mail adapter during provider registration.
- All channels for a given notification are dispatched concurrently via `Promise.all` — channel order in `via()` does not imply sequential execution.
- `DatabaseChannel` writes to the `'notification'` Prisma accessor (the lowercase model name). Ensure the model is named `Notification` in your Prisma schema.
- If a notifiable does not have an `email` property and `'mail'` is returned from `via()`, the `MailChannel` will skip the send silently.
- Custom channels registered via `ChannelRegistry.register()` are available globally to all notifications — there is no per-notification channel registration.
