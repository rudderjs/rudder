import assert from 'node:assert/strict'
import { MailRegistry } from './index.js'
import type { MailAdapter, SendOptions } from './index.js'
import type { Mailable } from './mailable.js'

/**
 * Testing fake for @rudderjs/mail.
 *
 * Records all sent and queued mailables instead of delivering them,
 * and provides assertion methods for verifying mail behavior in tests.
 *
 * @example
 * const fake = FakeMailAdapter.fake()
 *
 * await Mail.to('user@example.com').send(new WelcomeMail())
 *
 * fake.assertSent(WelcomeMail)
 * fake.assertSentCount(1)
 * fake.restore()
 */
export class FakeMailAdapter implements MailAdapter {
  private readonly _sent:   Array<{ mailable: Mailable; options: SendOptions }> = []
  private readonly _queued: Array<{ mailable: Mailable; options: SendOptions }> = []

  // ─── MailAdapter interface ───────────────────────────────

  async send(mailable: Mailable, options: SendOptions): Promise<void> {
    this._sent.push({ mailable, options })
  }

  // ─── Queued mail tracking ────────────────────────────────

  /**
   * Record a mailable as queued. **@internal** — invoked by the
   * `dispatchMailJob` queue dispatcher (`packages/mail/src/queued.ts`) when
   * `Mail.to(...).queue(...)` or `.later(...)` is called against an active
   * fake. The dispatcher detects the fake via `MailRegistry.get() instanceof
   * FakeMailAdapter` and calls this method instead of enqueueing a job.
   *
   * Do not call from user code — use `assertQueued()` / `queued()` to
   * inspect what was queued, not this method.
   */
  recordQueued(mailable: Mailable, options: SendOptions): void {
    this._queued.push({ mailable, options })
  }

  // ─── Assertions: sent ────────────────────────────────────

  /** Assert that a mailable of the given class was sent, optionally matching a predicate. */
  assertSent(
    mailableClass: new (...args: unknown[]) => Mailable,
    predicate?: (entry: { mailable: Mailable; options: SendOptions }) => boolean,
  ): void {
    const matching = this._matchingSent(mailableClass, predicate)
    assert.ok(
      matching.length > 0,
      `[RudderJS Mail] Expected "${mailableClass.name}" to be sent, but it was not.`,
    )
  }

  /** Assert that exactly N mailables were sent (across all classes). */
  assertSentCount(count: number): void {
    assert.strictEqual(
      this._sent.length,
      count,
      `[RudderJS Mail] Expected ${count} mail(s) to be sent, but ${this._sent.length} were sent.`,
    )
  }

  /** Assert that a mailable of the given class was NOT sent. */
  assertNotSent(mailableClass: new (...args: unknown[]) => Mailable): void {
    const matching = this._matchingSent(mailableClass)
    assert.strictEqual(
      matching.length,
      0,
      `[RudderJS Mail] Expected "${mailableClass.name}" not to be sent, but it was sent ${matching.length} time(s).`,
    )
  }

  /** Assert that no mailables were sent at all. */
  assertNothingSent(): void {
    assert.strictEqual(
      this._sent.length,
      0,
      `[RudderJS Mail] Expected no mail to be sent, but ${this._sent.length} were sent.`,
    )
  }

  // ─── Assertions: queued ──────────────────────────────────

  /** Assert that a mailable of the given class was queued. */
  assertQueued(
    mailableClass: new (...args: unknown[]) => Mailable,
    predicate?: (entry: { mailable: Mailable; options: SendOptions }) => boolean,
  ): void {
    const matching = this._matchingQueued(mailableClass, predicate)
    assert.ok(
      matching.length > 0,
      `[RudderJS Mail] Expected "${mailableClass.name}" to be queued, but it was not.`,
    )
  }

  /** Assert that a mailable of the given class was NOT queued. */
  assertNotQueued(mailableClass: new (...args: unknown[]) => Mailable): void {
    const matching = this._matchingQueued(mailableClass)
    assert.strictEqual(
      matching.length,
      0,
      `[RudderJS Mail] Expected "${mailableClass.name}" not to be queued, but it was queued ${matching.length} time(s).`,
    )
  }

  /** Assert that no mailables were queued at all. */
  assertNothingQueued(): void {
    assert.strictEqual(
      this._queued.length,
      0,
      `[RudderJS Mail] Expected no mail to be queued, but ${this._queued.length} were queued.`,
    )
  }

  // ─── Assertions: exact-count variants ────────────────────

  /** Assert that a mailable of the given class was sent exactly `count` times. */
  assertSentTimes(
    mailableClass: new (...args: unknown[]) => Mailable,
    count: number,
  ): void {
    const matching = this._matchingSent(mailableClass)
    assert.strictEqual(
      matching.length,
      count,
      `[RudderJS Mail] Expected "${mailableClass.name}" to be sent ${count} time(s), but it was sent ${matching.length} time(s).`,
    )
  }

  /** Assert that a mailable of the given class was queued exactly `count` times. */
  assertQueuedTimes(
    mailableClass: new (...args: unknown[]) => Mailable,
    count: number,
  ): void {
    const matching = this._matchingQueued(mailableClass)
    assert.strictEqual(
      matching.length,
      count,
      `[RudderJS Mail] Expected "${mailableClass.name}" to be queued ${count} time(s), but it was queued ${matching.length} time(s).`,
    )
  }

  // ─── Assertions: combined sent + queued ──────────────────

  /**
   * Assert the total number of outgoing mailables — sent + queued combined,
   * across all classes. Useful when a code path might either dispatch
   * synchronously or via queue and the test just cares that mail goes out.
   */
  assertOutgoingCount(count: number): void {
    const total = this._sent.length + this._queued.length
    assert.strictEqual(
      total,
      count,
      `[RudderJS Mail] Expected ${count} outgoing mail(s) (sent + queued), but ${total} went out (${this._sent.length} sent, ${this._queued.length} queued).`,
    )
  }

  /** Assert no mail went out at all — neither sent nor queued. */
  assertNothingOutgoing(): void {
    const total = this._sent.length + this._queued.length
    assert.strictEqual(
      total,
      0,
      `[RudderJS Mail] Expected no outgoing mail (sent + queued), but ${total} went out (${this._sent.length} sent, ${this._queued.length} queued).`,
    )
  }

  /**
   * Assert that a mailable of the given class went out (sent OR queued) at
   * least once. Useful for tests that don't care whether a job ran synchronously
   * or via the queue.
   */
  assertOutgoing(
    mailableClass: new (...args: unknown[]) => Mailable,
    predicate?: (entry: { mailable: Mailable; options: SendOptions }) => boolean,
  ): void {
    const matching = [
      ...this._matchingSent(mailableClass, predicate),
      ...this._matchingQueued(mailableClass, predicate),
    ]
    assert.ok(
      matching.length > 0,
      `[RudderJS Mail] Expected "${mailableClass.name}" to be sent or queued, but it was neither.`,
    )
  }

  // ─── Access ──────────────────────────────────────────────

  /** Get all sent mailables, optionally filtered by class. */
  sent(
    mailableClass?: new (...args: unknown[]) => Mailable,
  ): Array<{ mailable: Mailable; options: SendOptions }> {
    if (!mailableClass) return [...this._sent]
    return this._matchingSent(mailableClass)
  }

  /** Get all queued mailables, optionally filtered by class. */
  queued(
    mailableClass?: new (...args: unknown[]) => Mailable,
  ): Array<{ mailable: Mailable; options: SendOptions }> {
    if (!mailableClass) return [...this._queued]
    return this._matchingQueued(mailableClass)
  }

  /**
   * Get every outgoing entry — sent + queued combined — optionally filtered
   * by mailable class. Useful when a test doesn't care which channel was used.
   */
  outgoing(
    mailableClass?: new (...args: unknown[]) => Mailable,
  ): Array<{ mailable: Mailable; options: SendOptions }> {
    const all = [...this._sent, ...this._queued]
    if (!mailableClass) return all
    return all.filter((entry) => this._isInstance(entry.mailable, mailableClass))
  }

  // ─── Cleanup ─────────────────────────────────────────────

  /** Restore the mail registry — clears the fake adapter. */
  restore(): void {
    MailRegistry.reset()
  }

  // ─── Install ─────────────────────────────────────────────

  /** Install the fake — replaces the registered mail adapter with this fake. */
  static fake(): FakeMailAdapter {
    const fake = new FakeMailAdapter()
    MailRegistry.set(fake)
    return fake
  }

  // ─── Internal ────────────────────────────────────────────

  private _isInstance(
    mailable: Mailable,
    mailableClass: new (...args: unknown[]) => Mailable,
  ): boolean {
    return (
      mailable instanceof mailableClass ||
      (mailable as object).constructor.name === mailableClass.name
    )
  }

  private _matchingSent(
    mailableClass: new (...args: unknown[]) => Mailable,
    predicate?: (entry: { mailable: Mailable; options: SendOptions }) => boolean,
  ): Array<{ mailable: Mailable; options: SendOptions }> {
    return this._sent.filter((entry) => {
      if (!this._isInstance(entry.mailable, mailableClass)) return false
      if (predicate && !predicate(entry)) return false
      return true
    })
  }

  private _matchingQueued(
    mailableClass: new (...args: unknown[]) => Mailable,
    predicate?: (entry: { mailable: Mailable; options: SendOptions }) => boolean,
  ): Array<{ mailable: Mailable; options: SendOptions }> {
    return this._queued.filter((entry) => {
      if (!this._isInstance(entry.mailable, mailableClass)) return false
      if (predicate && !predicate(entry)) return false
      return true
    })
  }
}
