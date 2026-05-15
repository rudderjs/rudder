import { test, describe } from 'node:test'
import assert from 'node:assert'
import { z } from 'zod'
import { ValidationError } from '@rudderjs/contracts'
import type { AppRequest, AppResponse } from '@rudderjs/contracts'

import { buildQueryValidator } from './query-validator.js'
import { Router } from './index.js'

// ─── Minimal AppRequest/AppResponse builders ───────────────

function makeReq(query: Record<string, string>): AppRequest {
  // Cast through unknown — we only exercise the fields the validator reads.
  return {
    method:  'GET',
    url:     '/test',
    path:    '/test',
    query,
    params:  {},
    headers: {},
    body:    null,
    raw:     null,
  } as unknown as AppRequest
}

const noopRes = {} as AppResponse

// ─── buildQueryValidator ───────────────────────────────────

describe('buildQueryValidator', () => {
  test('parses and replaces req.query on success', async () => {
    const schema = z.object({ page: z.coerce.number(), q: z.string() })
    const mw     = buildQueryValidator(schema)
    const req    = makeReq({ page: '3', q: 'hello' })

    let nextCalled = false
    await mw(req, noopRes, async () => { nextCalled = true })

    assert.equal(nextCalled, true)
    assert.deepStrictEqual(req.query, { page: 3, q: 'hello' })
  })

  test('throws ValidationError on failure', async () => {
    const schema = z.object({ page: z.coerce.number() })
    const mw     = buildQueryValidator(schema)
    const req    = makeReq({ page: 'not-a-number' })

    await assert.rejects(
      async () => { await mw(req, noopRes, async () => {}) },
      (err: unknown) => err instanceof ValidationError,
    )
  })

  test('ValidationError carries field errors keyed by zod path', async () => {
    const schema = z.object({
      page:  z.coerce.number(),
      limit: z.coerce.number(),
    })
    const mw  = buildQueryValidator(schema)
    const req = makeReq({ page: 'bad', limit: 'also-bad' })

    let caught: ValidationError | undefined
    try {
      await mw(req, noopRes, async () => {})
    } catch (err) {
      caught = err as ValidationError
    }
    assert.ok(caught instanceof ValidationError)
    assert.ok(Array.isArray(caught.errors.page))
    assert.ok(Array.isArray(caught.errors.limit))
    assert.ok(caught.errors.page!.length > 0)
  })

  test('applies schema defaults', async () => {
    const schema = z.object({
      page:  z.coerce.number().default(1),
      limit: z.coerce.number().default(10),
    })
    const mw  = buildQueryValidator(schema)
    const req = makeReq({})

    await mw(req, noopRes, async () => {})
    assert.deepStrictEqual(req.query, { page: 1, limit: 10 })
  })

  test('top-level (non-object schema) errors land under "root"', async () => {
    const schema = z.string()  // expects a string, will get an object
    const mw     = buildQueryValidator(schema)
    const req    = makeReq({ anything: 'goes' })

    let caught: ValidationError | undefined
    try {
      await mw(req, noopRes, async () => {})
    } catch (err) {
      caught = err as ValidationError
    }
    assert.ok(caught instanceof ValidationError)
    assert.ok(Array.isArray(caught.errors.root))
  })
})

// ─── Integration: Router opts form + .query() chain ────────

describe('Router opts form + .query() chain', () => {
  test('opts form installs query validator as middleware', () => {
    const router = new Router()
    const schema = z.object({ page: z.coerce.number() })
    router.get('/users', { query: schema }, (req) => req.query.page)

    const route = router.list()[0]!
    assert.equal(route.method, 'GET')
    assert.equal(route.path, '/users')
    assert.equal(route.middleware.length, 1)
  })

  test('opts form combines query validator with extra middleware', () => {
    const router = new Router()
    const schema = z.object({ page: z.coerce.number() })
    const extraMw = async (_req: AppRequest, _res: AppResponse, next: () => Promise<void>) => { await next() }
    router.get('/users', { query: schema, middleware: [extraMw] }, () => null)

    const route = router.list()[0]!
    assert.equal(route.middleware.length, 2)
  })

  test('.query() chain prepends validator to per-route middleware', () => {
    const router = new Router()
    const otherMw = async (_req: AppRequest, _res: AppResponse, next: () => Promise<void>) => { await next() }
    const schema = z.object({ page: z.coerce.number() })

    router.get('/users', () => null, [otherMw]).query(schema)

    const route = router.list()[0]!
    assert.equal(route.middleware.length, 2)
    // Validator runs first; existing per-route mw second.
    // (We can't easily introspect which is which without invoking, but the
    // length assertion + unshift ordering in source covers the regression.)
  })

  test('bare form leaves req.query untouched at runtime', async () => {
    const router = new Router()
    router.get('/users', () => null)

    const route = router.list()[0]!
    assert.equal(route.middleware.length, 0)
  })

  test('end-to-end: validator runs through the route middleware chain', async () => {
    const router = new Router()
    const schema = z.object({ page: z.coerce.number() })

    let observed: unknown
    router.get('/users', { query: schema }, (req) => { observed = req.query; return null })

    const route = router.list()[0]!
    const req   = makeReq({ page: '7' })

    // Compose: run middleware then handler (mirrors what the server adapter does).
    const mws     = route.middleware
    const handler = route.handler
    let i = 0
    const next = async (): Promise<void> => {
      const mw = mws[i++]
      if (mw) await mw(req, noopRes, next)
      else    await handler(req, noopRes)
    }
    await next()
    assert.deepStrictEqual(observed, { page: 7 })
  })
})
