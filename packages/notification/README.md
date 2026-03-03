# @forge/notification

Multi-channel notification system — send notifications via mail, database, or custom channels using the Notifiable pattern.

## Installation

```bash
pnpm add @forge/notification
```

## Usage

```ts
// bootstrap/providers.ts
import { notifications } from '@forge/notification'

export default [
  mail(configs.mail),  // required if using the mail channel
  notifications(),     // registers built-in mail + database channels
]
```

```ts
// app/Notifications/WelcomeNotification.ts
import { Notification, type Notifiable } from '@forge/notification'
import { Mailable } from '@forge/mail'

class WelcomeMail extends Mailable {
  build() { return this.subject('Welcome!').text('Thanks for signing up.') }
}

export class WelcomeNotification extends Notification {
  via(_notifiable: Notifiable): string[] {
    return ['mail', 'database']
  }

  toMail(_notifiable: Notifiable): Mailable {
    return new WelcomeMail()
  }

  toDatabase(_notifiable: Notifiable): Record<string, unknown> {
    return { message: 'Welcome to the app!' }
  }
}
```

```ts
// routes/api.ts
import { notify } from '@forge/notification'
import { WelcomeNotification } from '../app/Notifications/WelcomeNotification.js'

const user = { id: '1', email: 'alice@example.com', name: 'Alice' }

// Single notifiable
await notify(user, new WelcomeNotification())

// Multiple notifiables — all channels fire concurrently
await notify([user1, user2], new WelcomeNotification())
```

## Custom Channels

Register any channel with `ChannelRegistry` — typically in a service provider:

```ts
import {
  ChannelRegistry,
  type NotificationChannel,
  type Notifiable,
  type Notification,
} from '@forge/notification'

class SmsChannel implements NotificationChannel {
  async send(notifiable: Notifiable, notification: Notification): Promise<void> {
    const payload = (notification as { toSms?(n: Notifiable): string }).toSms?.(notifiable)
    if (payload) await smsClient.send({ to: (notifiable as { phone: string }).phone, body: payload })
  }
}

ChannelRegistry.register('sms', new SmsChannel())
```

Then add `'sms'` to the `via()` return value and implement `toSms()` on your notification class.

## Prisma Schema

Add this model to support the built-in `database` channel:

```prisma
model Notification {
  id              String  @id @default(cuid())
  notifiable_id   String
  notifiable_type String
  type            String
  data            String
  read_at         String?
  created_at      String
  updated_at      String

  @@index([notifiable_type, notifiable_id])
}
```

## API Reference

- `Notifiable` — interface for entities that receive notifications (`id`, `email?`, `name?`)
- `Notification` — abstract base class; implement `via()`, optionally `toMail()`, `toDatabase()`
- `NotificationChannel` — interface for custom channels (`send(notifiable, notification)`)
- `ChannelRegistry` — static registry; `register(name, channel)`, `get(name)`, `has(name)`
- `MailChannel` — built-in; delegates to `@forge/mail` adapter
- `DatabaseChannel` — built-in; writes rows via `@forge/orm` adapter to the `notification` table
- `Notifier` — static facade; `Notifier.send(notifiables, notification)`
- `notify(notifiables, notification)` — shorthand helper wrapping `Notifier.send()`
- `notifications()` — service provider factory; registers `mail` and `database` channels

## Configuration

This package has no runtime config object.

## Notes

- `notifications()` must be listed after `mail()` in providers when using the mail channel.
- All channels for each notifiable are dispatched concurrently via `Promise.all`.
- `DatabaseChannel` writes to the `notification` Prisma accessor — map this to your table with `@@map` if needed.
