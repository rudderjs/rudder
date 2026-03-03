import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { ForgeRequest, ForgeResponse } from '@boostkit/contracts'
import { Middleware, Pipeline, CorsMiddleware, ThrottleMiddleware } from './index.js'

function makeReq(overrides: Partial<ForgeRequest> = {}): ForgeRequest {
  return {
    method: 'GET',
    url: '/',
    path: '/',
    query: {},
    params: {},
    headers: {},
    body: null,
    raw: null,
    ...overrides,
  }
}

function makeRes() {
  const headers = new Map<string, string>()
  let statusCode = 200
  let jsonBody: unknown
  const res: ForgeResponse = {
    status(code) { statusCode = code; return res },
    header(key, value) { headers.set(key, value); return res },
    json(data) { jsonBody = data },
    send() {},
    redirect() {},
    raw: null,
  }
  return { res, headers, getStatus: () => statusCode, getJson: () => jsonBody }
}

describe('Middleware contract baseline', () => {
  it('Middleware.toHandler() wires class handle()', async () => {
    let called = false
    class TestMiddleware extends Middleware {
      async handle(_req: ForgeRequest, _res: ForgeResponse, next: () => Promise<void>): Promise<void> {
        called = true
        await next()
      }
    }

    let reached = false
    const { res } = makeRes()
    await new TestMiddleware().toHandler()(makeReq(), res, async () => { reached = true })

    assert.strictEqual(called, true)
    assert.strictEqual(reached, true)
  })

  it('Pipeline runs handlers in order and reaches destination', async () => {
    const order: string[] = []
    const { res } = makeRes()

    await Pipeline.make()
      .through([
        async (_req, _res, next) => { order.push('a'); await next(); order.push('a:after') },
        async (_req, _res, next) => { order.push('b'); await next(); order.push('b:after') },
      ])
      .run(makeReq(), res, async () => { order.push('dest') })

    assert.deepStrictEqual(order, ['a', 'b', 'dest', 'b:after', 'a:after'])
  })

  it('Pipeline short-circuits when next() is not called', async () => {
    let reached = false
    const { res } = makeRes()

    await Pipeline.make()
      .through([async () => undefined])
      .run(makeReq(), res, async () => { reached = true })

    assert.strictEqual(reached, false)
  })

  it('CorsMiddleware sets expected response headers', async () => {
    const bag = makeRes()
    const middleware = new CorsMiddleware({
      origin: ['https://a.dev', 'https://b.dev'],
      methods: ['GET', 'POST'],
      headers: ['Content-Type'],
    })

    await middleware.handle(makeReq(), bag.res, async () => undefined)

    assert.strictEqual(bag.headers.get('Access-Control-Allow-Origin'), 'https://a.dev, https://b.dev')
    assert.strictEqual(bag.headers.get('Access-Control-Allow-Methods'), 'GET, POST')
    assert.strictEqual(bag.headers.get('Access-Control-Allow-Headers'), 'Content-Type')
  })

  it('ThrottleMiddleware allows under limit and blocks at limit', async () => {
    const throttle = new ThrottleMiddleware(2, 10_000)
    const req = makeReq({ headers: { 'x-real-ip': '127.0.0.1' } })

    let nextCount = 0
    await throttle.handle(req, makeRes().res, async () => { nextCount++ })
    await throttle.handle(req, makeRes().res, async () => { nextCount++ })

    const blocked = makeRes()
    await throttle.handle(req, blocked.res, async () => { nextCount++ })

    assert.strictEqual(nextCount, 2)
    assert.strictEqual(blocked.getStatus(), 429)
    assert.deepStrictEqual(blocked.getJson(), { message: 'Too many requests. Please slow down.' })
  })

  it('ThrottleMiddleware skips static asset paths', async () => {
    const throttle = new ThrottleMiddleware(0, 10_000)
    const req = makeReq({ path: '/assets/app.js' })

    let passed = false
    await throttle.handle(req, makeRes().res, async () => { passed = true })

    assert.strictEqual(passed, true)
  })
})
