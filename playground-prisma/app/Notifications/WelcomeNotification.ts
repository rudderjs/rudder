import { Notification, type Notifiable } from '@rudderjs/notification'
import { Mailable } from '@rudderjs/mail'

// ─── Welcome Mailable ──────────────────────────────────────

class WelcomeMail extends Mailable {
  constructor(private readonly notifiable: Notifiable) { super() }

  build(): this {
    return this
      .subject(`Welcome to RudderJS, ${this.notifiable.name ?? 'friend'}!`)
      .text(
        `Hi ${this.notifiable.name ?? 'there'},\n\n` +
        `Your account is ready. Thanks for joining us!\n\n` +
        `— The RudderJS Team`
      )
  }
}

// ─── Welcome Notification ─────────────────────────────────

export class WelcomeNotification extends Notification {
  via(_notifiable: Notifiable): string[] {
    return ['mail', 'database']
  }

  toMail(notifiable: Notifiable): WelcomeMail {
    return new WelcomeMail(notifiable)
  }

  toDatabase(notifiable: Notifiable): Record<string, unknown> {
    return {
      message: `Welcome, ${notifiable.name ?? notifiable.email ?? 'friend'}!`,
      action:  'account_created',
    }
  }
}
