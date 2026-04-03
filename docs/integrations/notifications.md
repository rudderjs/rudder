# Notifications

This guide walks through setting up multi-channel notifications in a RudderJS application using `@rudderjs/notification`. Notifications can be sent via email, stored in a database, or dispatched through custom channels (SMS, Slack, push notifications, etc.).

## Overview

The notification system consists of:

- **`Notifiable`** interface — any entity that can receive notifications
- **`Notification`** class — defines what channels to use and how to format the message for each
- **`ChannelRegistry`** — registers channel implementations
- **`notify(notifiable, notification)`** — dispatches a notification to all configured channels

## Installation

```bash
pnpm add @rudderjs/notification @rudderjs/mail
```

## 1. Register the Provider

In `bootstrap/providers.ts`, add `notifications()` **after** `mail()`:

```ts
import { mail }          from '@rudderjs/mail'
import { notifications } from '@rudderjs/notification'
import configs           from '../config/index.js'

export default [
  DatabaseServiceProvider,
  mail(configs.mail),     // must come before notifications
  notifications(),        // registers mail + database channels
  AppServiceProvider,
]
```

## 2. Prisma Schema (Database Channel)

Add the `Notification` model to `prisma/schema.prisma` to support the built-in database channel:

```prisma
model Notification {
  id              String  @id @default(cuid())
  notifiable_id   String
  notifiable_type String
  type            String
  data            String  // JSON-encoded payload
  read_at         String?
  created_at      String
  updated_at      String

  @@index([notifiable_type, notifiable_id])
}
```

Apply the changes:

```bash
pnpm exec prisma generate
pnpm exec prisma db push
```

## 3. Create a Notification

Extend `Notification` and implement `via()` plus the appropriate `to*()` methods:

```ts
// app/Notifications/WelcomeNotification.ts
import { Notification, type Notifiable } from '@rudderjs/notification'
import { Mailable } from '@rudderjs/mail'

class WelcomeMail extends Mailable {
  build() {
    return this
      .subject('Welcome to RudderJS!')
      .text('Thanks for joining. We are glad to have you.')
  }
}

export class WelcomeNotification extends Notification {
  constructor(private readonly appName: string) {
    super()
  }

  via(_notifiable: Notifiable): string[] {
    return ['mail', 'database']
  }

  toMail(_notifiable: Notifiable): Mailable {
    return new WelcomeMail()
  }

  toDatabase(_notifiable: Notifiable): Record<string, unknown> {
    return {
      message: `Welcome to ${this.appName}!`,
      timestamp: new Date().toISOString(),
    }
  }
}
```

## 4. Send a Notification

Use the `notify()` helper from anywhere in your application:

```ts
import { notify } from '@rudderjs/notification'
import { WelcomeNotification } from '../app/Notifications/WelcomeNotification.js'

// Single recipient
router.post('/api/users', async (req, res) => {
  const user = await User.create(req.body as any)
  await notify(user, new WelcomeNotification('MyApp'))
  return res.status(201).json({ data: user })
})

// Multiple recipients — all channels fire concurrently
router.post('/api/broadcast', async (_req, res) => {
  const admins = await User.where('role', 'admin').get()
  await notify(admins, new WelcomeNotification('MyApp'))
  return res.json({ sent: admins.length })
})
```

The `notify()` function calls all channels listed in `via()` concurrently for each notifiable.

## 5. Reading Notifications

Query stored notifications from the database:

```ts
router.get('/api/me/notifications', async (req, res) => {
  const userId = (req as any).user.id
  const notifications = await User.getAdapter().query('notification')
    .where('notifiable_id', userId)
    .where('notifiable_type', 'users')
    .orderBy('created_at', 'DESC')
    .get()

  return res.json({ data: notifications })
})

// Mark as read
router.patch('/api/me/notifications/:id', async (req, res) => {
  await User.getAdapter().query('notification').update(req.params.id as string, {
    read_at: new Date().toISOString(),
  })
  return res.json({ success: true })
})
```

## 6. Custom Channels

Register any custom channel with `ChannelRegistry`:

### SMS Channel Example

```ts
// app/Channels/SmsChannel.ts
import {
  ChannelRegistry,
  type NotificationChannel,
  type Notifiable,
  type Notification,
} from '@rudderjs/notification'

interface SmsNotifiable extends Notifiable {
  phone: string
}

interface SmsNotification extends Notification {
  toSms(notifiable: SmsNotifiable): string
}

class SmsChannel implements NotificationChannel {
  async send(notifiable: Notifiable, notification: Notification): Promise<void> {
    const n = notification as SmsNotification
    const u = notifiable as SmsNotifiable

    if (!u.phone || typeof n.toSms !== 'function') return

    const message = n.toSms(u)
    await smsClient.send({ to: u.phone, body: message })
  }
}

ChannelRegistry.register('sms', new SmsChannel())
```

Register in `AppServiceProvider.boot()`:

```ts
import './app/Channels/SmsChannel.js'  // side-effect: registers the channel
```

Use in a notification:

```ts
class OrderShippedNotification extends Notification {
  via() { return ['sms', 'database'] }

  toSms(notifiable: SmsNotifiable): string {
    return `Your order has shipped! Track it at: ${this.trackingUrl}`
  }

  toDatabase() {
    return { event: 'order.shipped', orderId: this.orderId }
  }
}
```

## Channel Overview

| Channel | Package | Description |
|---------|---------|-------------|
| `mail` | `@rudderjs/mail` | Sends email via the configured mail adapter |
| `database` | `@rudderjs/orm` | Stores notification as a JSON row |
| Custom | Your code | Register any channel with `ChannelRegistry` |

## Notes

- `notifications()` must be listed after `mail()` in providers
- All channels for each notifiable fire concurrently via `Promise.all`
- The `DatabaseChannel` writes to the `notification` Prisma accessor — use `@@map` if you need a different table name
- `Notifiable` requires `id`; `email` is only needed for the mail channel
- The `via()` return value determines which channels are invoked — return an empty array to skip all channels
