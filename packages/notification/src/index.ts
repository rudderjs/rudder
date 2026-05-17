import { ServiceProvider } from '@rudderjs/core'
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

  /** Build the broadcast representation (required when 'broadcast' channel is used) */
  toBroadcast?(notifiable: Notifiable): Record<string, unknown> | Promise<Record<string, unknown>>

  /**
   * Create an on-demand notifiable routed to the given channel address.
   * Use to send notifications without a stored user.
   *
   * @example
   * await notify(
   *   Notification.route('mail', 'visitor@example.com'),
   *   new OrderConfirmation(order),
   * )
   */
  static route(channel: string, address: string): AnonymousNotifiable {
    return new AnonymousNotifiable().route(channel, address)
  }
}

// ─── ShouldQueue ───────────────────────────────────────────

/**
 * Marker interface for notifications that should be dispatched to the queue
 * instead of being sent immediately.
 *
 * @example
 * class InvoiceNotification extends Notification implements ShouldQueue {
 *   shouldQueue = true as const
 *   queueConnection?: string   // optional: queue connection name
 *   queueName?: string         // optional: queue name
 *   queueDelay?: number        // optional: delay in ms
 *
 *   via() { return ['mail', 'database'] }
 *   toMail() { ... }
 * }
 */
export interface ShouldQueue {
  readonly shouldQueue: true
  queueConnection?: string
  queueName?: string
  queueDelay?: number
}

/** Type guard for queueable notifications. */
export function isQueueable(notification: Notification): notification is Notification & ShouldQueue {
  return 'shouldQueue' in notification
    && (notification as { shouldQueue?: unknown }).shouldQueue === true
}

// ─── AnonymousNotifiable ───────────────────────────────────

/**
 * A notifiable that doesn't require a stored user.
 * Routes are set per-channel.
 *
 * @example
 * const recipient = new AnonymousNotifiable()
 *   .route('mail', 'visitor@example.com')
 *   .route('broadcast', 'channel-123')
 *
 * await notify(recipient, new OrderConfirmation(order))
 */
export class AnonymousNotifiable implements Notifiable {
  readonly id = 'anonymous'
  email?: string
  name?: string
  private readonly _routes = new Map<string, string>()

  /**
   * Register an address for a delivery channel. Returns `this` for chaining.
   *
   * **Side effect.** When `channel === 'mail'`, the address is also written
   * to `this.email` so `MailChannel.send()` (which reads `notifiable.email`,
   * not `routeFor('mail')`) picks it up. This mirrors the Notifiable
   * contract used by ORM-backed users (`User.email`). Other channels store
   * the address only in `_routes` and must be retrieved via `routeFor()`.
   */
  route(channel: string, address: string): this {
    this._routes.set(channel, address)
    if (channel === 'mail') {
      this.email = address
    }
    return this
  }

  /** Get the routing address for a channel. */
  routeFor(channel: string): string | undefined {
    return this._routes.get(channel)
  }
}

// ─── Channel Contract ──────────────────────────────────────

export interface NotificationChannel {
  send(notifiable: Notifiable, notification: Notification): Promise<void>
}

// ─── Channel Registry ──────────────────────────────────────

/**
 * Process-wide registry mapping channel name → handler. Populated by
 * `NotificationProvider.boot()` (built-in channels: mail, database,
 * broadcast). Custom channels register via `ChannelRegistry.register()`
 * from a service provider.
 *
 * **Test isolation.** Static state persists across test invocations within
 * the same process. Tests that mutate channels MUST call `reset()` in
 * `beforeEach()` / `afterEach()` or registrations leak between tests.
 * Production code never calls `reset()`.
 *
 * **Shared store via `globalThis`.** Routes through a global key so the
 * registry survives the case where `@rudderjs/notification` is loaded twice
 * — typical in a Vite-bundled server where the framework bundles the package
 * inline but `NotificationProvider.boot()` runs from a `node_modules` copy
 * resolved via the provider auto-discovery manifest. Without a shared store,
 * channels registered from the externalized copy would never be visible to
 * `Notifier.send()` reading the bundled copy. Defensive migration per the
 * #499 static-state singleton audit. Same pattern as PR #498
 * (`@rudderjs/orm` `ModelRegistry`), #500–#505 (pennant, cache, queue, mail,
 * storage, hash).
 */
interface NotificationChannelsStore {
  channels: Map<string, NotificationChannel>
}

const _g = globalThis as Record<string, unknown>
if (!_g['__rudderjs_notification_channels__']) {
  _g['__rudderjs_notification_channels__'] = {
    channels: new Map<string, NotificationChannel>(),
  } satisfies NotificationChannelsStore
}
const _store = _g['__rudderjs_notification_channels__'] as NotificationChannelsStore

export class ChannelRegistry {
  static register(name: string, channel: NotificationChannel): void {
    _store.channels.set(name, channel)
  }

  static get(name: string): NotificationChannel | undefined {
    return _store.channels.get(name)
  }

  static has(name: string): boolean {
    return _store.channels.has(name)
  }

  /** @internal — clears all registered channels. Test-only; do NOT call from production code. */
  static reset(): void {
    _store.channels.clear()
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
  /**
   * Override to use a different table. For Prisma users this must be the
   * client delegate name (camelCase of the Prisma model), e.g. `notification`,
   * NOT the SQL table name (`notifications`).
   */
  protected table = 'notification'

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

// ─── Broadcast Channel ─────────────────────────────────────

/**
 * Sends notifications via WebSocket broadcasting.
 * Uses `@rudderjs/broadcast` to broadcast the `toBroadcast()` payload.
 */
export class BroadcastChannel implements NotificationChannel {
  async send(notifiable: Notifiable, notification: Notification): Promise<void> {
    if (!notification.toBroadcast) {
      throw new Error(
        `[RudderJS Notification] ${notification.constructor.name} uses 'broadcast' but does not implement toBroadcast().`
      )
    }

    let broadcastFn: (channel: string, event: string, data: unknown) => void
    try {
      // Dynamic import (not `require`) — `@rudderjs/broadcast` is ESM-only;
      // its `exports` lacks a `require` condition, so a synchronous require
      // always throws "No exports main defined" even when installed.
      // Memory: `feedback_esm_only_peer_resolution`.
      const mod = await import(/* @vite-ignore */ '@rudderjs/broadcast') as { broadcast: typeof broadcastFn }
      broadcastFn = mod.broadcast
    } catch {
      throw new Error(
        '[RudderJS Notification] Broadcast channel requires @rudderjs/broadcast. Install it with: pnpm add @rudderjs/broadcast'
      )
    }

    const data = await notification.toBroadcast(notifiable)
    const channelName = (notifiable instanceof AnonymousNotifiable)
      ? notifiable.routeFor('broadcast') ?? `user.${notifiable.id}`
      : `user.${notifiable.id}`

    broadcastFn(channelName, notification.constructor.name, data)
  }
}

// ─── Notifier Facade ───────────────────────────────────────

export class Notifier {
  /**
   * Send a notification to one or more notifiables.
   * If the notification implements `ShouldQueue`, it will be dispatched to the queue.
   *
   * Example:
   *   await Notifier.send(user, new WelcomeNotification())
   *   await Notifier.send([user1, user2], new NewsletterNotification())
   */
  static async send(
    notifiables: Notifiable | Notifiable[],
    notification: Notification,
  ): Promise<void> {
    // Queued notifications
    if (isQueueable(notification)) {
      return Notifier._sendQueued(notifiables, notification)
    }

    return Notifier._sendNow(notifiables, notification)
  }

  private static async _sendNow(
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

  private static async _sendQueued(
    notifiables: Notifiable | Notifiable[],
    notification: Notification & ShouldQueue,
  ): Promise<void> {
    let QueueRegistry: { get(): { dispatch(job: unknown, opts?: unknown): Promise<void> } | null }

    try {
      // Dynamic import (not `require`) — `@rudderjs/queue` is ESM-only and
      // its `exports` field lacks a `require` condition, so a synchronous
      // require always throws "No exports main defined" even when installed.
      // Memory: `feedback_esm_only_peer_resolution`.
      const mod = await import(/* @vite-ignore */ '@rudderjs/queue') as { QueueRegistry: typeof QueueRegistry }
      QueueRegistry = mod.QueueRegistry
    } catch {
      throw new Error(
        '[RudderJS Notification] Queued notifications require @rudderjs/queue. Install it with: pnpm add @rudderjs/queue'
      )
    }

    const adapter = QueueRegistry.get()
    if (!adapter) {
      throw new Error('[RudderJS Notification] No queue adapter registered. Add queue() to providers.')
    }

    const job = {
      handle: async () => {
        await Notifier._sendNow(notifiables, notification)
      },
    }

    const opts: Record<string, unknown> = {}
    if (notification.queueName)  opts['queue'] = notification.queueName
    if (notification.queueDelay) opts['delay'] = notification.queueDelay

    await adapter.dispatch(job, opts)
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

// ─── Service Provider ──────────────────────────────────────

/**
 * Registers built-in channels (mail, database, broadcast) into the
 * ChannelRegistry on boot.
 *
 * Usage in bootstrap/providers.ts:
 *   import { NotificationProvider } from '@rudderjs/notification'
 *   export default [..., NotificationProvider]
 */
export { NotificationFake } from './fake.js'
export type { SentNotification } from './fake.js'

export class NotificationProvider extends ServiceProvider {
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
    ChannelRegistry.register('mail',      new MailChannel())
    ChannelRegistry.register('database',  new DatabaseChannel())
    ChannelRegistry.register('broadcast', new BroadcastChannel())
  }
}
