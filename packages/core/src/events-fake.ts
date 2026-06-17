import assert from 'node:assert/strict'
import { dispatcher } from './events.js'
import type { EventDispatcher } from './events.js'

// ─── Types ─────────────────────────────────────────────────

export interface DispatchedEvent {
  event: string
  payload: unknown
}

// ─── Event Fake ────────────────────────────────────────────

/**
 * Testing fake for @rudderjs/core events.
 *
 * Replaces the global EventDispatcher's dispatch method to record events
 * without invoking real listeners.
 *
 * @example
 * const fake = EventFake.fake()
 *
 * await dispatch(new UserRegistered(user))
 *
 * fake.assertDispatched('UserRegistered')
 * fake.assertDispatchedTimes('UserRegistered', 1)
 * fake.restore()
 */
export class EventFake {
  private readonly _dispatched: DispatchedEvent[] = []
  private readonly _originalDispatch: EventDispatcher['dispatch']

  constructor() {
    this._originalDispatch = dispatcher.dispatch.bind(dispatcher)
  }

  // ─── Assertions ──────────────────────────────────────────

  /** Assert that an event was dispatched, optionally matching a predicate on the payload. */
  assertDispatched(
    event: string,
    predicate?: (payload: unknown) => boolean,
  ): void {
    const matching = this._matching(event, predicate)
    assert.ok(
      matching.length > 0,
      `[Rudder Event] Expected event "${event}" to be dispatched, but it was not.`,
    )
  }

  /** Assert that an event was dispatched exactly N times. */
  assertDispatchedTimes(event: string, count: number): void {
    const matching = this._matching(event)
    assert.strictEqual(
      matching.length,
      count,
      `[Rudder Event] Expected event "${event}" to be dispatched ${count} time(s), but it was dispatched ${matching.length} time(s).`,
    )
  }

  /** Assert that an event was NOT dispatched. */
  assertNotDispatched(event: string): void {
    const matching = this._matching(event)
    assert.strictEqual(
      matching.length,
      0,
      `[Rudder Event] Expected event "${event}" not to be dispatched, but it was dispatched ${matching.length} time(s).`,
    )
  }

  /** Assert that nothing was dispatched. */
  assertNothingDispatched(): void {
    assert.strictEqual(
      this._dispatched.length,
      0,
      `[Rudder Event] Expected no events to be dispatched, but ${this._dispatched.length} were dispatched.`,
    )
  }

  // ─── Access ──────────────────────────────────────────────

  /** Get all dispatched events, optionally filtered by event name. */
  dispatched(event?: string): DispatchedEvent[] {
    if (!event) return [...this._dispatched]
    return this._dispatched.filter((entry) => entry.event === event)
  }

  // ─── Cleanup ─────────────────────────────────────────────

  /** Restore the original EventDispatcher.dispatch() method. */
  restore(): void {
    dispatcher.dispatch = this._originalDispatch
  }

  // ─── Install ─────────────────────────────────────────────

  /** Install the fake — replaces dispatcher.dispatch() to record instead of invoking listeners. */
  static fake(): EventFake {
    const fake = new EventFake()

    dispatcher.dispatch = async <T extends object>(event: T): Promise<void> => {
      const name = event.constructor.name
      fake._dispatched.push({ event: name, payload: event })
    }

    return fake
  }

  // ─── Internal ────────────────────────────────────────────

  private _matching(
    event: string,
    predicate?: (payload: unknown) => boolean,
  ): DispatchedEvent[] {
    return this._dispatched.filter((entry) => {
      if (entry.event !== event) return false
      if (predicate && !predicate(entry.payload)) return false
      return true
    })
  }
}
