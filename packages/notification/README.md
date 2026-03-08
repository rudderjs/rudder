# @boostkit/notification

Multi-channel notification system — send notifications via mail, database, or custom channels using the Notifiable pattern.

## Installation

```bash
pnpm add @boostkit/notification
```

## Setup

```ts
// bootstrap/providers.ts
import { mail } from '@boostkit/mail'
import { notifications } from '@boostkit/notification'
import configs from '../config/index.js'

export default [
  mail(configs.mail),      // required before notifications() when using mail channel
  notifications(),         // registers built-in mail + database channels
]
```

## Defining Notifications

Extend `Notification` and implement `via()` to declare which channels to use, then implement the corresponding `toMail()` / `toDatabase()` methods.

```ts
// app/Notifications/WelcomeNotification.ts
import { Notification, type Notifiable } from '@boostkit/notification'
import { Mailable } from '@boostkit/mail'

class WelcomeMail extends Mailable {
  build() {
    return this.subject('Welcome!').html('<h1>Thanks for signing up.</h1>').text('Thanks for signing up.')
  }
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

## Sending Notifications

Use the `notify()` helper or `Notifier.send()` directly:

```ts
import { notify } from '@boostkit/notification'
import { WelcomeNotification } from '../app/Notifications/WelcomeNotification.js'

const user = { id: '1', email: 'alice@example.com', name: 'Alice' }

// Single notifiable
await notify(user, new WelcomeNotification())

// Multiple notifiables — all channels fire concurrently per notifiable
await notify([user1, user2], new WelcomeNotification())
```

## `Notifiable` Interface

Any object that implements `Notifiable` can receive notifications:

```ts
interface Notifiable {
  readonly id:     string | number
  readonly email?: string   // required for mail channel
  readonly name?:  string
}
```

## `Notification` Abstract Class

| Method / Property | Description |
|-------------------|-------------|
| `via(notifiable)` | **Required.** Return channel names to use (e.g. `['mail', 'database']`). |
| `toMail?(notifiable)` | Required when `'mail'` is in `via()`. Return a `Mailable`. Can be async. |
| `toDatabase?(notifiable)` | Required when `'database'` is in `via()`. Return a plain object. Can be async. |

## Built-in Channels

### `mail`

Delegates to `@boostkit/mail`. Requires:
- `mail()` provider registered before `notifications()`
- Notifiable has an `email` field
- Notification implements `toMail()`

### `database`

Writes a row to the `notifications` table via `@boostkit/orm`. Requires:
- A database provider registered (e.g. `orm-prisma` or `orm-drizzle`)
- Notification implements `toDatabase()`

Row shape:

| Column | Value |
|--------|-------|
| `notifiable_id` | `String(notifiable.id)` |
| `notifiable_type` | `'users'` |
| `type` | Notification class name |
| `data` | `JSON.stringify(toDatabase())` |
| `read_at` | `null` |
| `created_at` | ISO timestamp |
| `updated_at` | ISO timestamp |

## Custom Channels

Register any channel with `ChannelRegistry` — typically in a service provider's `boot()`:

```ts
import {
  ChannelRegistry,
  type NotificationChannel,
  type Notifiable,
  type Notification,
} from '@boostkit/notification'

class SmsChannel implements NotificationChannel {
  async send(notifiable: Notifiable, notification: Notification): Promise<void> {
    const msg = (notification as any).toSms?.(notifiable)
    if (msg) await smsClient.send({ to: (notifiable as any).phone, body: msg })
  }
}

ChannelRegistry.register('sms', new SmsChannel())
```

Then return `'sms'` from `via()` and implement `toSms()` on your notification:

```ts
class AlertNotification extends Notification {
  via(): string[] { return ['sms'] }
  toSms(notifiable: Notifiable): string { return `Hello ${notifiable.name}, you have an alert.` }
}
```

## Prisma Schema

Add this model to support the `database` channel:

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

  @@map("notifications")
  @@index([notifiable_type, notifiable_id])
}
```

## API Reference

| Export | Description |
|--------|-------------|
| `Notifiable` | Interface for entities that receive notifications (`id`, `email?`, `name?`). |
| `Notification` | Abstract base class — implement `via()`, optionally `toMail()`, `toDatabase()`. |
| `NotificationChannel` | Interface for custom channels — implement `send(notifiable, notification)`. |
| `ChannelRegistry` | Static registry — `register(name, channel)`, `get(name)`, `has(name)`, `reset()`. |
| `MailChannel` | Built-in — delegates to `@boostkit/mail` adapter. |
| `DatabaseChannel` | Built-in — writes rows via `@boostkit/orm` to the `notifications` table. |
| `Notifier` | Static facade — `Notifier.send(notifiables, notification)`. |
| `notify(notifiables, notification)` | Shorthand helper — delegates to `Notifier.send()`. |
| `notifications()` | Service provider factory — registers `mail` and `database` channels. |

## Notes

- `notifications()` must be listed **after** `mail()` in providers when using the mail channel.
- All channels for each notifiable are dispatched concurrently via `Promise.all`.
- `toMail()` and `toDatabase()` can be `async` — useful for loading data before sending.
- `DatabaseChannel` writes to the `notifications` table — override `protected table` to change it.
