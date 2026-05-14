import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  BroadcastObserverRegistry,
  broadcastObservers,
  type BroadcastEvent,
} from './observers.js'

const sampleEvent: BroadcastEvent = {
  kind:         'connection.opened',
  connectionId: 'c1',
  url:          '/',
}

describe('BroadcastObserverRegistry', () => {
  let reg: BroadcastObserverRegistry

  beforeEach(() => { reg = new BroadcastObserverRegistry() })

  describe('subscribe + emit', () => {
    it('invokes every registered observer with the event payload', () => {
      const received: BroadcastEvent[] = []
      reg.subscribe(e => received.push(e))
      reg.subscribe(e => received.push(e))
      reg.emit(sampleEvent)
      assert.equal(received.length, 2)
      assert.deepEqual(received[0], sampleEvent)
    })

    it('returns an unsubscribe function that removes that observer only', () => {
      const received: BroadcastEvent[] = []
      const off1 = reg.subscribe(() => received.push({ ...sampleEvent, connectionId: 'first' }))
      reg.subscribe(() => received.push({ ...sampleEvent, connectionId: 'second' }))
      off1()
      reg.emit(sampleEvent)
      assert.equal(received.length, 1)
      assert.equal((received[0] as { connectionId: string }).connectionId, 'second')
    })

    it('does not invoke the unsubscribed observer even if re-subscribed later', () => {
      const calls: string[] = []
      const obs = (): void => { calls.push('once') }
      const off = reg.subscribe(obs)
      off()
      reg.emit(sampleEvent)
      assert.deepEqual(calls, [])
    })
  })

  describe('emit error swallow', () => {
    it('swallows thrown errors from one observer without skipping the others', () => {
      const received: string[] = []
      reg.subscribe(() => { throw new Error('observer crashed') })
      reg.subscribe(() => received.push('B reached'))
      reg.subscribe(() => received.push('C reached'))

      assert.doesNotThrow(() => reg.emit(sampleEvent))
      assert.deepEqual(received, ['B reached', 'C reached'])
    })
  })

  describe('reset', () => {
    it('drops every registered observer', () => {
      let count = 0
      reg.subscribe(() => { count++ })
      reg.reset()
      reg.emit(sampleEvent)
      assert.equal(count, 0)
    })
  })
})

describe('broadcastObservers singleton', () => {
  it('is exported as a BroadcastObserverRegistry instance', () => {
    assert.ok(broadcastObservers instanceof BroadcastObserverRegistry)
  })

  it('is reachable through globalThis.__rudderjs_broadcast_observers__ (HMR safety)', () => {
    const g = globalThis as Record<string, unknown>
    assert.strictEqual(g['__rudderjs_broadcast_observers__'], broadcastObservers)
  })
})
