import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { AsyncLocalStorage } from 'node:async_hooks'

import { REQUEST_CONTEXT, type MiddlewareHandler } from '@rudderjs/contracts'
import { createWsContextRunner, type MinimalIncomingMessage } from './ws-context-runner.js'

/** Tag a middleware as request-context, the way session/auth do. */
function tag(fn: MiddlewareHandler): MiddlewareHandler {
  ;(fn as unknown as Record<symbol, unknown>)[REQUEST_CONTEXT] = true
  return fn
}

function upgradeReq(over: Partial<MinimalIncomingMessage> = {}): MinimalIncomingMessage {
  return {
    headers: { cookie: 'rudder_session=abc', host: 'example.test' },
    url: '/sync/room-42?x=1',
    socket: { remoteAddress: '203.0.113.7' },
    ...over,
  }
}

describe('createWsContextRunner', () => {
  it('runs only REQUEST_CONTEXT-tagged middleware, in order, with fn as the terminal', async () => {
    const order: string[] = []
    const tagged1 = tag(async (_req, _res, next) => { order.push('a:before'); await next(); order.push('a:after') })
    const untagged = async (_req: never, _res: never, next: () => Promise<void>) => { order.push('skip'); await next() }
    const tagged2 = tag(async (_req, _res, next) => { order.push('b:before'); await next(); order.push('b:after') })

    const runner = createWsContextRunner([tagged1, untagged as MiddlewareHandler, tagged2])
    const result = await runner(upgradeReq(), () => { order.push('fn'); return 'decision' })

    assert.equal(result, 'decision')
    // untagged middleware never ran; tagged ran in order, onion-nested around fn.
    assert.deepEqual(order, ['a:before', 'b:before', 'fn', 'b:after', 'a:after'])
  })

  it('synthesizes an AppRequest carrying headers, url, ip, and a shared mutable raw bag', async () => {
    let seenReq: { headers: Record<string, string>; url: string; ip?: string; raw: Record<string, unknown> } | undefined
    const mw = tag(async (req, _res, next) => {
      seenReq = req as unknown as typeof seenReq
      ;(req.raw as Record<string, unknown>)['__rjs_session'] = { id: 's1' }
      await next()
    })
    let rawInFn: Record<string, unknown> | undefined
    const runner = createWsContextRunner([mw])
    await runner(upgradeReq(), () => { rawInFn = (seenReq as { raw: Record<string, unknown> }).raw })

    assert.ok(seenReq)
    assert.equal(seenReq!.headers['cookie'], 'rudder_session=abc')
    assert.equal(seenReq!.url, '/sync/room-42?x=1')
    assert.equal(seenReq!.ip, '203.0.113.7')
    // the raw bag a context middleware wrote into is the same object fn observes.
    assert.deepEqual(rawInFn!['__rjs_session'], { id: 's1' })
  })

  it('places fn inside an ALS scope a context middleware establishes (Auth.user()/Session.* parity)', async () => {
    const als = new AsyncLocalStorage<string>()
    const mw = tag(async (_req, _res, next) => als.run('user-9', () => next()))

    const runner = createWsContextRunner([mw])
    const seen = await runner(upgradeReq(), () => als.getStore())

    assert.equal(seen, 'user-9')
  })

  it('propagates a throwing middleware (caller fails closed)', async () => {
    const boom = tag(async () => { throw new Error('mw exploded') })
    const runner = createWsContextRunner([boom])
    await assert.rejects(() => runner(upgradeReq(), () => true), /mw exploded/)
  })

  it('runs fn directly when no context middleware is present', async () => {
    const runner = createWsContextRunner([])
    const result = await runner(upgradeReq(), () => 42)
    assert.equal(result, 42)
  })

  it('normalizes array-valued and missing headers without crashing', async () => {
    let headers: Record<string, string> | undefined
    const mw = tag(async (req, _res, next) => { headers = req.headers; await next() })
    const runner = createWsContextRunner([mw])
    await runner(
      { headers: { 'x-multi': ['a', 'b'], 'x-undef': undefined } },
      () => undefined,
    )
    assert.equal(headers!['x-multi'], 'a, b')
    assert.ok(!('x-undef' in headers!))
  })
})
