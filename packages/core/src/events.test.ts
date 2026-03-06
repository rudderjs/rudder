import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { EventDispatcher, dispatch, dispatcher, type Listener } from './events.js'

describe('Events contract baseline', () => {
  beforeEach(() => {
    ;(dispatcher as unknown as { map: Map<string, Listener<unknown>[]> }).map.clear()
  })

  it('EventDispatcher.dispatch() calls registered listeners in order', async () => {
    class UserRegistered { constructor(readonly id: string) {} }
    const calls: string[] = []

    const d = new EventDispatcher()
    d.register(
      UserRegistered.name,
      { handle: async (e) => { calls.push(`a:${(e as UserRegistered).id}`) } },
      { handle: async (e) => { calls.push(`b:${(e as UserRegistered).id}`) } },
    )

    await d.dispatch(new UserRegistered('42'))

    assert.deepStrictEqual(calls, ['a:42', 'b:42'])
  })

  it('dispatch() helper dispatches via global dispatcher', async () => {
    class OrderPlaced { constructor(readonly number: string) {} }
    const seen: string[] = []

    dispatcher.register(OrderPlaced.name, {
      handle: async (event) => {
        seen.push((event as OrderPlaced).number)
      },
    })

    await dispatch(new OrderPlaced('ORD-1'))

    assert.deepStrictEqual(seen, ['ORD-1'])
  })
})
