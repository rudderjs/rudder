import assert from 'node:assert/strict'
import { Notification, Notifier } from './index.js'
import type { Notifiable } from './index.js'

/** Constructor type that matches both abstract and concrete Notification subclasses. */
type NotificationClass = abstract new (...args: never[]) => Notification

// ─── Types ─────────────────────────────────────────────────

export interface SentNotification {
  notifiable: Notifiable
  notification: Notification
  channels: string[]
}

// ─── Notification Fake ─────────────────────────────────────

/**
 * Testing fake for @rudderjs/notification.
 *
 * Intercepts the Notifier.send() dispatch mechanism and records all
 * notifications without actually sending them through channels.
 *
 * @example
 * const fake = NotificationFake.fake()
 *
 * await notify(user, new WelcomeNotification())
 *
 * fake.assertSentTo(user, WelcomeNotification)
 * fake.assertCount(1)
 * fake.restore()
 */
export class NotificationFake {
  private readonly _sent: SentNotification[] = []
  private readonly _originalSend: typeof Notifier.send

  constructor() {
    this._originalSend = Notifier.send.bind(Notifier)
  }

  // ─── Assertions ──────────────────────────────────────────

  /** Assert that a notification was sent to the given notifiable, optionally matching a predicate. */
  assertSentTo(
    notifiable: { id: string | number },
    notificationClass: NotificationClass,
    predicate?: (notification: Notification) => boolean,
  ): void {
    const matching = this._matchingFor(notifiable, notificationClass, predicate)
    assert.ok(
      matching.length > 0,
      `[RudderJS Notification] Expected notification "${notificationClass.name}" to be sent to notifiable "${notifiable.id}", but it was not.`,
    )
  }

  /** Assert that a notification was NOT sent to the given notifiable. */
  assertNotSentTo(
    notifiable: { id: string | number },
    notificationClass: NotificationClass,
  ): void {
    const matching = this._matchingFor(notifiable, notificationClass)
    assert.strictEqual(
      matching.length,
      0,
      `[RudderJS Notification] Expected notification "${notificationClass.name}" not to be sent to notifiable "${notifiable.id}", but it was sent ${matching.length} time(s).`,
    )
  }

  /** Assert that a notification was sent to the given notifiable exactly N times. */
  assertSentToTimes(
    notifiable: { id: string | number },
    notificationClass: NotificationClass,
    count: number,
  ): void {
    const matching = this._matchingFor(notifiable, notificationClass)
    assert.strictEqual(
      matching.length,
      count,
      `[RudderJS Notification] Expected notification "${notificationClass.name}" to be sent to notifiable "${notifiable.id}" ${count} time(s), but it was sent ${matching.length} time(s).`,
    )
  }

  /** Assert that no notifications were sent. */
  assertNothingSent(): void {
    assert.strictEqual(
      this._sent.length,
      0,
      `[RudderJS Notification] Expected no notifications to be sent, but ${this._sent.length} were sent.`,
    )
  }

  /** Assert total notification count. */
  assertCount(count: number): void {
    assert.strictEqual(
      this._sent.length,
      count,
      `[RudderJS Notification] Expected ${count} notification(s) to be sent, but ${this._sent.length} were sent.`,
    )
  }

  // ─── Access ──────────────────────────────────────────────

  /** Get all sent notifications, optionally filtered by notifiable. */
  sent(notifiable?: { id: string | number }): SentNotification[] {
    if (!notifiable) return [...this._sent]
    return this._sent.filter((entry) => String(entry.notifiable.id) === String(notifiable.id))
  }

  // ─── Cleanup ─────────────────────────────────────────────

  /**
   * Restore the original `Notifier.send()` dispatch.
   *
   * **Asymmetry.** Resets the dispatch hook but does NOT clear the
   * `_sent` array. If a test mutates the same fake across phases, prior
   * recordings remain visible. Either construct a fresh fake per test
   * (preferred) or call `restore()` then `Notifier.fake()` again to start
   * clean. We don't auto-clear because tests sometimes inspect `sent()`
   * after `restore()` to assert no notifications fired during cleanup.
   */
  restore(): void {
    Notifier.send = this._originalSend
  }

  // ─── Install ─────────────────────────────────────────────

  /** Install the fake — replaces Notifier.send() to record instead of dispatch. */
  static fake(): NotificationFake {
    const fake = new NotificationFake()

    Notifier.send = async (
      notifiables: Notifiable | Notifiable[],
      notification: Notification,
    ): Promise<void> => {
      const targets = Array.isArray(notifiables) ? notifiables : [notifiables]
      for (const notifiable of targets) {
        const channels = notification.via(notifiable)
        fake._sent.push({ notifiable, notification, channels })
      }
    }

    return fake
  }

  // ─── Internal ────────────────────────────────────────────

  private _matchingFor(
    notifiable: { id: string | number },
    notificationClass: NotificationClass,
    predicate?: (notification: Notification) => boolean,
  ): SentNotification[] {
    return this._sent.filter((entry) => {
      if (String(entry.notifiable.id) !== String(notifiable.id)) return false
      if (entry.notification.constructor.name !== notificationClass.name) return false
      if (predicate && !predicate(entry.notification)) return false
      return true
    })
  }
}
