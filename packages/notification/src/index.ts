import { ServiceProvider, type Application } from '@rudderjs/core'
import { MailRegistry, type Mailable } from '@rudderjs/mail'
import { ModelRegistry } from '@rudderjs/orm'

// ─── Notifiable ────────────────────────────────────────────

/**
 * Implement this interface on any entity that can receive notifications
 * (users, teams, subscribers, etc.)
 */
export interface Notifiable {
  readonly id:     string | number
  readonly email?: string
  readonly name?:  string
}

// ─── Notification ──────────────────────────────────────────

/**
 * Base class for all notifications. Extend this and implement:
 *  - `via(notifiable)` — return channel names: 'mail', 'database', etc.
 *  - `toMail(notifiable)` — required when 'mail' is in via()
 *  - `toDatabase(notifiable)` — required when 'database' is in via()
 */
export abstract class Notification {
  /** Return the channel names this notification uses for the given notifiable */
  abstract via(notifiable: Notifiable): string[]

  /** Build the mail representation (required when 'mail' channel is used) */
  toMail?(notifiable: Notifiable): Mailable | Promise<Mailable>

  /** Build the database representation (required when 'database' channel is used) */
  toDatabase?(notifiable: Notifiable): Record<string, unknown> | Promise<Record<string, unknown>>
}

// ─── Channel Contract ──────────────────────────────────────

export interface NotificationChannel {
  send(notifiable: Notifiable, notification: Notification): Promise<void>
}

// ─── Channel Registry ──────────────────────────────────────

export class ChannelRegistry {
  private static channels: Map<string, NotificationChannel> = new Map()

  static register(name: string, channel: NotificationChannel): void {
    this.channels.set(name, channel)
  }

  static get(name: string): NotificationChannel | undefined {
    return this.channels.get(name)
  }

  static has(name: string): boolean {
    return this.channels.has(name)
  }

  /** @internal — clears all registered channels. Used for testing. */
  static reset(): void {
    this.channels.clear()
  }
}

// ─── Mail Channel ──────────────────────────────────────────

export class MailChannel implements NotificationChannel {
  async send(notifiable: Notifiable, notification: Notification): Promise<void> {
    if (!notification.toMail) {
      throw new Error(
        `[RudderJS Notification] ${notification.constructor.name} uses the 'mail' channel but does not implement toMail().`
      )
    }

    const adapter = MailRegistry.get()
    if (!adapter) {
      throw new Error('[RudderJS Notification] No mail adapter registered. Add mail() to providers.')
    }

    if (!notifiable.email) {
      throw new Error(
        `[RudderJS Notification] Notifiable (id=${notifiable.id}) has no email address for mail channel.`
      )
    }

    const mailable = await notification.toMail(notifiable)
    const from     = MailRegistry.getFrom()
    await adapter.send(mailable, { to: [notifiable.email], from })
  }
}

// ─── Database Channel ──────────────────────────────────────

export class DatabaseChannel implements NotificationChannel {
  /** Override to use a different table name */
  protected table = 'notifications'

  async send(notifiable: Notifiable, notification: Notification): Promise<void> {
    if (!notification.toDatabase) {
      throw new Error(
        `[RudderJS Notification] ${notification.constructor.name} uses the 'database' channel but does not implement toDatabase().`
      )
    }

    const data    = await notification.toDatabase(notifiable)
    const adapter = ModelRegistry.getAdapter()

    await adapter.query(this.table).create({
      notifiable_id:   String(notifiable.id),
      notifiable_type: 'users',
      type:            notification.constructor.name,
      data:            JSON.stringify(data),
      read_at:         null,
      created_at:      new Date().toISOString(),
      updated_at:      new Date().toISOString(),
    })
  }
}

// ─── Notifier Facade ───────────────────────────────────────

export class Notifier {
  /**
   * Send a notification to one or more notifiables.
   *
   * Example:
   *   await Notifier.send(user, new WelcomeNotification())
   *   await Notifier.send([user1, user2], new NewsletterNotification())
   */
  static async send(
    notifiables: Notifiable | Notifiable[],
    notification: Notification,
  ): Promise<void> {
    const targets = Array.isArray(notifiables) ? notifiables : [notifiables]

    await Promise.all(
      targets.flatMap(notifiable =>
        notification.via(notifiable).map(async channelName => {
          const channel = ChannelRegistry.get(channelName)
          if (!channel) {
            throw new Error(
              `[RudderJS Notification] Unknown channel "${channelName}". Register it with ChannelRegistry.register().`
            )
          }
          await channel.send(notifiable, notification)
        })
      )
    )
  }
}

// ─── notify() helper ───────────────────────────────────────

/**
 * Convenience helper for sending notifications.
 *
 * Example:
 *   await notify(user, new WelcomeNotification())
 */
export const notify = (
  notifiables: Notifiable | Notifiable[],
  notification: Notification,
): Promise<void> => Notifier.send(notifiables, notification)

// ─── Service Provider Factory ──────────────────────────────

/**
 * Returns a NotificationServiceProvider that registers built-in channels
 * (mail, database) into the ChannelRegistry.
 *
 * Usage in bootstrap/providers.ts:
 *   import { notifications } from '@rudderjs/notification'
 *   export default [..., notifications(), ...]
 */
export function notifications(): new (app: Application) => ServiceProvider {
  class NotificationServiceProvider extends ServiceProvider {
    register(): void {
      const schemaDir = new URL(/* @vite-ignore */ '../schema', import.meta.url).pathname
      this.publishes([
        { from: `${schemaDir}/notification.prisma`,            to: 'prisma/schema',   tag: 'notification-schema', orm: 'prisma' as const },
        { from: `${schemaDir}/notification.drizzle.sqlite.ts`, to: 'database/schema', tag: 'notification-schema', orm: 'drizzle' as const, driver: 'sqlite' as const },
        { from: `${schemaDir}/notification.drizzle.pg.ts`,     to: 'database/schema', tag: 'notification-schema', orm: 'drizzle' as const, driver: 'postgresql' as const },
        { from: `${schemaDir}/notification.drizzle.mysql.ts`,  to: 'database/schema', tag: 'notification-schema', orm: 'drizzle' as const, driver: 'mysql' as const },
      ])
    }

    boot(): void {
      ChannelRegistry.register('mail',     new MailChannel())
      ChannelRegistry.register('database', new DatabaseChannel())
    }
  }

  return NotificationServiceProvider
}
