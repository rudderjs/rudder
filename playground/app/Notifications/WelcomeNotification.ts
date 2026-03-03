import { Notification, type Notifiable } from '@boostkit/notification'
import { Mailable } from '@boostkit/mail'

// ─── Welcome Mailable ──────────────────────────────────────

class WelcomeMail extends Mailable {
  constructor(private readonly notifiable: Notifiable) { super() }

  build(): this {
    return this
      .subject(`Welcome to Forge, ${this.notifiable.name ?? 'friend'}!`)
      .text(
        `Hi ${this.notifiable.name ?? 'there'},\n\n` +
        `Your account is ready. Thanks for joining us!\n\n` +
        `— The Forge Team`
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
