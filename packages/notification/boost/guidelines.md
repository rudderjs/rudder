# @rudderjs/notification

## Overview

Multi-channel notification system — send the same notification via `mail`, `database`, and custom channels using the `Notifiable` pattern. Laravel's notification pattern for Node. Notifications are classes with a `via()` method (which channels to use) and per-channel `toMail()`, `toDatabase()`, etc. methods.

## Key Patterns

### Setup

```ts
// bootstrap/providers.ts
import { mail } from '@rudderjs/mail'
import { notifications } from '@rudderjs/notification'

export default [
  mail(configs.mail),     // required BEFORE notifications() when using the mail channel
  notifications(),         // registers built-in mail + database channels
]
```

### Defining a notification

```ts
import { Notification, type Notifiable } from '@rudderjs/notification'
import { Mailable } from '@rudderjs/mail'

class WelcomeMail extends Mailable {
  constructor(private user: Notifiable) { super() }
  build() {
    return this
      .subject('Welcome!')
      .html(`<h1>Hi ${this.user.name}</h1>`)
      .text(`Hi ${this.user.name}`)
  }
}

export class WelcomeNotification extends Notification {
  via(notifiable: Notifiable) {
    return ['mail', 'database']
  }

  toMail(notifiable: Notifiable) {
    return new WelcomeMail(notifiable)
  }

  toDatabase(notifiable: Notifiable) {
    return {
      type: 'welcome',
      title: 'Welcome aboard',
      body:  `Hi ${notifiable.name}, thanks for signing up.`,
    }
  }
}
```

### Sending

```ts
import { notify } from '@rudderjs/notification'

await notify(user, new WelcomeNotification())           // single recipient
await notify([user1, user2], new WelcomeNotification()) // multiple
```

Each channel in `via()` fires independently. Failures in one channel don't block others — they're reported via `@rudderjs/log` and swallowed.

### The `Notifiable` interface

Any object with `{ id, name, email }` plus a notification-channel route (e.g. `email` for the mail channel) works. For DB notifications, the `Notifiable` needs an `id` that maps to the `Notification` Prisma model's `notifiableId`.

Your User model usually is Notifiable out of the box.

### Database channel — schema

```prisma
model DatabaseNotification {
  id             String   @id @default(cuid())
  type           String
  notifiableType String
  notifiableId   String
  data           String   // JSON
  readAt         DateTime?
  createdAt      DateTime @default(now())

  @@index([notifiableType, notifiableId])
}
```

Publish the schema: `pnpm rudder vendor:publish --tag=notification-schema`.

### Custom channels

```ts
import { NotificationChannel, registerChannel } from '@rudderjs/notification'

class SlackChannel implements NotificationChannel {
  async send(notifiable: Notifiable, notification: Notification): Promise<void> {
    const payload = (notification as any).toSlack(notifiable)
    await slack.chat.postMessage(payload)
  }
}

registerChannel('slack', new SlackChannel())

// Then in notifications:
class OrderShipped extends Notification {
  via() { return ['mail', 'slack'] }
  toSlack(n: Notifiable) { return { channel: '#orders', text: '...' } }
}
```

## Common Pitfalls

- **`notifications()` before `mail()`.** Notifications with mail channel throw at send-time. Order: `mail()` → `notifications()` in providers array.
- **`via()` returning channels without matching `toChannel()` method.** Silent — the channel registry throws "no handler for channel X". Every channel name in `via()` must have a matching method or be a registered custom channel.
- **`toMail()` returning a plain object.** Must return a `Mailable` instance. Return `new WelcomeMail(notifiable)`, not `{ subject: ..., body: ... }`.
- **Database channel without the Prisma model.** The `database` channel writes to `DatabaseNotification`. Publish the schema (`vendor:publish --tag=notification-schema`) and `prisma db push` before sending.
- **`notify()` outside app context.** `notify()` needs DI to look up channels. Works inside routes, jobs, event listeners, scheduled tasks — anywhere the app has booted.
- **Telescope records notifications.** Telescope's `notification` collector records every dispatch — notifiable id, channels, duration. No manual wiring.

## Key Imports

```ts
import { notifications, notify, Notification, registerChannel } from '@rudderjs/notification'

import type { Notifiable, NotificationChannel } from '@rudderjs/notification'
```
