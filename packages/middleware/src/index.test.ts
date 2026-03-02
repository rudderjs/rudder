import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { ForgeRequest, ForgeResponse } from '@forge/server'
import { Pipeline, CorsMiddleware, ThrottleMiddleware } from './index.js'

function makeReq(path = '/api/test', headers: Record<string, string> = {}): ForgeRequest {
  return {
    method: 'GET',
    url: `http://localhost${path}`,
    path,
    query: {},
    params: {},
    headers,
    body: null,
    raw: {},
  }
}

function makeRes() {
  const state: {
    statusCode: number
    headers: Record<string, string>
    jsonBody: unknown
  } = {
    statusCode: 200,
    headers: {},
    jsonBody: undefined,
  }

  const res: ForgeResponse = {
    status: (code: number) => {
      state.statusCode = code
      return res
    },
    header: (key: string, value: string) => {
      state.headers[key] = value
      return res
    },
    json: (data: unknown) => {
      state.jsonBody = data
    },
    send: (_data: string) => undefined,
    redirect: (_url: string, _code?: number) => undefined,
    raw: {},
  }

  return { res, state }
}

describe('Middleware contract baseline', () => {
  it('Pipeline runs middleware in order and reaches destination', async () => {
    const req = makeReq()
    const { res } = makeRes()
    const order: string[] = []

    const m1 = async (_req: ForgeRequest, _res: ForgeResponse, next: () => Promise<void>) => {
      order.push('m1-before')
      await next()
      order.push('m1-after')
    }

    const m2 = async (_req: ForgeRequest, _res: ForgeResponse, next: () => Promise<void>) => {
      order.push('m2-before')
      await next()
      order.push('m2-after')
    }

    await Pipeline.make().through([m1, m2]).run(req, res, async () => {
      order.push('destination')
    })

    assert.deepStrictEqual(order, ['m1-before', 'm2-before', 'destination', 'm2-after', 'm1-after'])
  })

  it('CorsMiddleware sets standard CORS headers', async () => {
    const req = makeReq()
    const { res, state } = makeRes()
    const mw = new CorsMiddleware({ origin: 'https://forge.dev' }).toHandler()

    await mw(req, res, async () => undefined)

    assert.strictEqual(state.headers['Access-Control-Allow-Origin'], 'https://forge.dev')
    assert.ok(state.headers['Access-Control-Allow-Methods'])
    assert.ok(state.headers['Access-Control-Allow-Headers'])
  })

  it('ThrottleMiddleware returns 429 when limit exceeded', async () => {
    const req = makeReq('/api/users', { 'x-real-ip': '127.0.0.1' })
    const first = makeRes()
    const second = makeRes()
    const throttle = new ThrottleMiddleware(1, 60_000).toHandler()

    let nextCalls = 0
    await throttle(req, first.res, async () => { nextCalls += 1 })
    await throttle(req, second.res, async () => { nextCalls += 1 })

    assert.strictEqual(nextCalls, 1)
    assert.strictEqual(second.state.statusCode, 429)
    assert.deepStrictEqual(second.state.jsonBody, { message: 'Too many requests. Please slow down.' })
  })
})
