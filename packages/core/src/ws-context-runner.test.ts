import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { IncomingMessage } from 'node:http'

import { REQUEST_CONTEXT } from '@rudderjs/contracts'
import type { AppRequest, AppResponse, MiddlewareHandler } from '@rudderjs/contracts'
import {
  createWsContextRunner,
  synthesizeRequest,
  makeThrowawayResponse,
} from './ws-context-runner.js'

// ─── Fixtures ──────────────────────────────────────────────

function fakeIncoming(init?: Partial<IncomingMessage> & { headers?: IncomingMessage['headers'] }): IncomingMessage {
  return {
    url:     '/ws-sync/room?token=abc',
    headers: { cookie: 'rudderjs_session=signed.value', host: 'localhost' },
    socket:  { remoteAddress: '203.0.113.7' },
    ...init,
  } as unknown as IncomingMessage
}

/** A context-establishing middleware that runs `body` then calls next(). */
function tagged(body: (req: AppRequest, res: AppResponse) => void): MiddlewareHandler {
  const fn: MiddlewareHandler = async (req, res, next) => { body(req, res); await next() }
  ;(fn as unknown as Record<symbol, unknown>)[REQUEST_CONTEXT] = true
  return fn
}

/** A plain (untagged) middleware — must be skipped by the runner. */
function untagged(body: () => void): MiddlewareHandler {
  return async (_req, _res, next) => { body(); await next() }
}

// ─── synthesizeRequest ─────────────────────────────────────

describe('synthesizeRequest', () => {
  it('maps headers, url, path/query, method, ip and a mutable raw bag', () => {
    const req = synthesizeRequest(fakeIncoming())
    assert.equal(req.method, 'GET')
    assert.equal(req.url, '/ws-sync/room?token=abc')
    assert.equal(req.path, '/ws-sync/room')
    assert.deepEqual(req.query, { token: 'abc' })
    assert.equal(req.headers['cookie'], 'rudderjs_session=signed.value')
    assert.equal(req.ip, '203.0.113.7')
    // raw is a fresh mutable bag session/auth write onto
    ;(req.raw as Record<string, unknown>)['__rjs_session'] = 'x'
    assert.equal((req.raw as Record<string, unknown>)['__rjs_session'], 'x')
  })

  it('folds array-valued headers and tolerates a missing url', () => {
    const req = synthesizeRequest(fakeIncoming({ url: undefined, headers: { 'x-multi': ['a', 'b'] } }))
    assert.equal(req.url, '/')
    assert.equal(req.path, '/')
    assert.equal(req.headers['x-multi'], 'a, b')
  })
})

// ─── makeThrowawayResponse ─────────────────────────────────

describe('makeThrowawayResponse', () => {
  it('is an inert AppResponse whose Set-Cookie sink is discarded', () => {
    const res = makeThrowawayResponse()
    assert.equal(res.statusCode, 200)
    assert.equal(res.status(404), res)            // chainable no-op
    assert.equal(res.header('Set-Cookie', 'x=1'), res)
    // session.save() reaches into res.raw and calls .header(...) — must not throw
    assert.doesNotThrow(() => (res.raw as { header(k: string, v: string): void }).header('Set-Cookie', 'y=2'))
  })
})

// ─── createWsContextRunner ─────────────────────────────────

describe('createWsContextRunner', () => {
  it('runs only REQUEST_CONTEXT-tagged middleware, in order, with fn as terminal', async () => {
    const order: string[] = []
    const handlers = [
      tagged(() => order.push('ctx-a')),
      untagged(() => order.push('plain-should-not-run')),
      tagged(() => order.push('ctx-b')),
    ]
    const runner = createWsContextRunner(() => handlers)

    const result = await runner(fakeIncoming(), () => {
      order.push('fn')
      return 'allowed'
    })

    assert.equal(result, 'allowed')
    assert.deepEqual(order, ['ctx-a', 'ctx-b', 'fn'])
  })

  it('passes the synthesized request through to the middleware (cookie visible)', async () => {
    let seenCookie: string | undefined
    const handlers = [tagged((req) => { seenCookie = req.headers['cookie'] })]
    const runner = createWsContextRunner(() => handlers)
    await runner(fakeIncoming(), () => true)
    assert.equal(seenCookie, 'rudderjs_session=signed.value')
  })

  it('rejects when a context middleware throws (caller fails closed)', async () => {
    const boom: MiddlewareHandler = async () => { throw new Error('mw boom') }
    ;(boom as unknown as Record<symbol, unknown>)[REQUEST_CONTEXT] = true
    const runner = createWsContextRunner(() => [boom])
    await assert.rejects(() => runner(fakeIncoming(), () => true), /mw boom/)
  })

  it('does not run fn when a context middleware short-circuits without next()', async () => {
    let ran = false
    const halt: MiddlewareHandler = async () => { /* never calls next */ }
    ;(halt as unknown as Record<symbol, unknown>)[REQUEST_CONTEXT] = true
    const runner = createWsContextRunner(() => [halt])
    const result = await runner(fakeIncoming(), () => { ran = true; return true })
    assert.equal(ran, false)
    assert.equal(result, undefined)
  })

  it('re-resolves the web stack on each call (lazy resolver)', async () => {
    let handlers: MiddlewareHandler[] = []
    const runner = createWsContextRunner(() => handlers)
    assert.equal(await runner(fakeIncoming(), () => 'first'), 'first')
    const hit: string[] = []
    handlers = [tagged(() => hit.push('now-present'))]
    await runner(fakeIncoming(), () => 'second')
    assert.deepEqual(hit, ['now-present'])
  })
})
