/**
 * Events integration tests
 *
 * Tests the full event lifecycle: EventDispatcher, global dispatcher singleton,
 * dispatch() helper, wildcard listeners, and the events() provider factory.
 */
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { EventDispatcher, dispatcher, dispatch, eventsProvider as events } from '@rudderjs/core'
import type { Listener } from '@rudderjs/core'

// ─── Test events ───────────────────────────────────────────

class UserRegistered {
  constructor(public readonly userId: string) {}
}

class OrderPlaced {
  constructor(public readonly orderId: number) {}
}

// ─── Tests ─────────────────────────────────────────────────

describe('events — EventDispatcher integration', () => {
  let d: EventDispatcher

  beforeEach(() => {
    d = new EventDispatcher()
  })

  describe('register() + dispatch()', () => {
    it('invokes a registered listener', async () => {
      const received: string[] = []

      d.register('UserRegistered', {
        async handle(event: UserRegistered) {
          received.push(event.userId)
        },
      } as Listener<UserRegistered>)

      await d.dispatch(new UserRegistered('user-1'))
      assert.deepEqual(received, ['user-1'])
    })

    it('invokes multiple listeners in registration order', async () => {
      const order: number[] = []

      d.register('UserRegistered',
        { async handle() { order.push(1) } } as Listener<UserRegistered>,
        { async handle() { order.push(2) } } as Listener<UserRegistered>,
      )
      d.register('UserRegistered',
        { async handle() { order.push(3) } } as Listener<UserRegistered>,
      )

      await d.dispatch(new UserRegistered('u'))
      assert.deepEqual(order, [1, 2, 3])
    })

    it('does not invoke listeners for a different event', async () => {
      let called = false
      d.register('OrderPlaced', { async handle() { called = true } } as Listener<OrderPlaced>)
      await d.dispatch(new UserRegistered('u'))
      assert.equal(called, false)
    })

    it('awaits async listeners before continuing', async () => {
      const log: string[] = []

      d.register('UserRegistered', {
        async handle() {
          await new Promise(r => setTimeout(r, 5))
          log.push('done')
        },
      } as Listener<UserRegistered>)

      await d.dispatch(new UserRegistered('u'))
      assert.deepEqual(log, ['done'])
    })
  })

  describe('wildcard listener (*)', () => {
    it('receives every dispatched event', async () => {
      const names: string[] = []

      d.register('*', {
        async handle(event: object) {
          names.push(event.constructor.name)
        },
      } as Listener<object>)

      await d.dispatch(new UserRegistered('u'))
      await d.dispatch(new OrderPlaced(1))

      assert.deepEqual(names, ['UserRegistered', 'OrderPlaced'])
    })

    it('runs after specific listeners', async () => {
      const order: string[] = []

      d.register('UserRegistered', {
        async handle() { order.push('specific') },
      } as Listener<UserRegistered>)

      d.register('*', {
        async handle() { order.push('wildcard') },
      } as Listener<object>)

      await d.dispatch(new UserRegistered('u'))
      assert.deepEqual(order, ['specific', 'wildcard'])
    })
  })

  describe('count() + hasListeners()', () => {
    it('count() returns number of registered listeners', () => {
      d.register('UserRegistered',
        { handle: async () => {} } as Listener<UserRegistered>,
        { handle: async () => {} } as Listener<UserRegistered>,
      )
      assert.equal(d.count('UserRegistered'), 2)
    })

    it('hasListeners() returns true when registered', () => {
      d.register('UserRegistered', { handle: async () => {} } as Listener<UserRegistered>)
      assert.equal(d.hasListeners('UserRegistered'), true)
    })

    it('hasListeners() returns false for unregistered event', () => {
      assert.equal(d.hasListeners('NoSuchEvent'), false)
    })
  })

  describe('list()', () => {
    it('returns a snapshot of event names and listener counts', () => {
      d.register('UserRegistered',
        { handle: async () => {} } as Listener<UserRegistered>,
        { handle: async () => {} } as Listener<UserRegistered>,
      )
      d.register('OrderPlaced', { handle: async () => {} } as Listener<OrderPlaced>)

      const snapshot = d.list()
      assert.equal(snapshot['UserRegistered'], 2)
      assert.equal(snapshot['OrderPlaced'], 1)
    })
  })

  describe('reset()', () => {
    it('clears all listeners', async () => {
      let called = false
      d.register('UserRegistered', {
        async handle() { called = true },
      } as Listener<UserRegistered>)

      d.reset()
      await d.dispatch(new UserRegistered('u'))
      assert.equal(called, false)
      assert.equal(d.count('UserRegistered'), 0)
    })
  })
})

describe('events — global dispatcher + dispatch() helper', () => {
  beforeEach(() => {
    dispatcher.reset()
  })

  it('dispatch() sends to the global dispatcher', async () => {
    const received: string[] = []

    dispatcher.register('UserRegistered', {
      async handle(event: UserRegistered) { received.push(event.userId) },
    } as Listener<UserRegistered>)

    await dispatch(new UserRegistered('global-user'))
    assert.deepEqual(received, ['global-user'])
  })
})

describe('events() provider factory', () => {
  beforeEach(() => {
    dispatcher.reset()
  })

  it('registers all listeners in the listen map on boot()', async () => {
    const received: string[] = []

    class WelcomeListener implements Listener<UserRegistered> {
      async handle(event: UserRegistered) {
        received.push(`welcome:${event.userId}`)
      }
    }

    class AuditListener implements Listener<UserRegistered> {
      async handle(event: UserRegistered) {
        received.push(`audit:${event.userId}`)
      }
    }

    const Provider = events({ UserRegistered: [WelcomeListener, AuditListener] })
    // Simulate boot() without a real Application
    const instance = new Provider(null as any)
    ;(instance as { boot(): void }).boot()

    await dispatch(new UserRegistered('u-42'))
    assert.deepEqual(received, ['welcome:u-42', 'audit:u-42'])
  })

  it('handles multiple event types', async () => {
    const log: string[] = []

    class OnUser implements Listener<UserRegistered> {
      async handle() { log.push('user') }
    }
    class OnOrder implements Listener<OrderPlaced> {
      async handle() { log.push('order') }
    }

    const Provider = events({ UserRegistered: [OnUser], OrderPlaced: [OnOrder] })
    ;(new Provider(null as any) as { boot(): void }).boot()

    await dispatch(new UserRegistered('u'))
    await dispatch(new OrderPlaced(1))
    assert.deepEqual(log, ['user', 'order'])
  })
})
