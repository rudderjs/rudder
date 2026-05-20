import { test, describe } from 'node:test'
import assert from 'node:assert'
import { z } from 'zod'
import { ValidationError } from '@rudderjs/contracts'
import type { AppRequest, AppResponse } from '@rudderjs/contracts'

import { buildBodyValidator } from './body-validator.js'
import { Router } from './index.js'

// ─── Minimal AppRequest/AppResponse builders ───────────────

function makeReq(body: unknown): AppRequest {
  // Cast through unknown — we only exercise the fields the validator reads.
  return {
    method:  'POST',
    url:     '/test',
    path:    '/test',
    query:   {},
    params:  {},
    headers: {},
    body,
    raw:     null,
  } as unknown as AppRequest
}

const noopRes = {} as AppResponse

// ─── buildBodyValidator ────────────────────────────────────

describe('buildBodyValidator', () => {
  test('parses and replaces req.body on success', async () => {
    const schema = z.object({ title: z.string(), views: z.coerce.number() })
    const mw     = buildBodyValidator(schema)
    const req    = makeReq({ title: 'hello', views: '42' })

    let nextCalled = false
    await mw(req, noopRes, async () => { nextCalled = true })

    assert.equal(nextCalled, true)
    assert.deepStrictEqual(req.body, { title: 'hello', views: 42 })
  })

  test('throws ValidationError on failure', async () => {
    const schema = z.object({ title: z.string() })
    const mw     = buildBodyValidator(schema)
    const req    = makeReq({ title: 123 })

    await assert.rejects(
      async () => { await mw(req, noopRes, async () => {}) },
      (err: unknown) => err instanceof ValidationError,
    )
  })

  test('ValidationError carries field errors keyed by zod path', async () => {
    const schema = z.object({
      title: z.string(),
      views: z.coerce.number(),
    })
    const mw  = buildBodyValidator(schema)
    const req = makeReq({ title: 123, views: 'not-a-number' })

    let caught: ValidationError | undefined
    try {
      await mw(req, noopRes, async () => {})
    } catch (err) {
      caught = err as ValidationError
    }
    assert.ok(caught instanceof ValidationError)
    assert.ok(Array.isArray(caught.errors.title))
    assert.ok(Array.isArray(caught.errors.views))
    assert.ok(caught.errors.title!.length > 0)
  })

  test('applies schema defaults', async () => {
    const schema = z.object({
      title: z.string().default('untitled'),
      views: z.coerce.number().default(0),
    })
    const mw  = buildBodyValidator(schema)
    const req = makeReq({})

    await mw(req, noopRes, async () => {})
    assert.deepStrictEqual(req.body, { title: 'untitled', views: 0 })
  })

  test('top-level (non-object schema) errors land under "root"', async () => {
    const schema = z.string()  // expects a string, will get an object
    const mw     = buildBodyValidator(schema)
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

  test('preserves transforms — body is the parsed result, not the raw input', async () => {
    const schema = z.object({
      slug: z.string().transform(s => s.toLowerCase().replace(/\s+/g, '-')),
    })
    const mw  = buildBodyValidator(schema)
    const req = makeReq({ slug: 'Hello World' })

    await mw(req, noopRes, async () => {})
    assert.deepStrictEqual(req.body, { slug: 'hello-world' })
  })
})

// ─── Integration: Router opts form + .body() chain ─────────

describe('Router opts form + .body() chain', () => {
  test('opts form installs body validator as middleware', () => {
    const router = new Router()
    const schema = z.object({ title: z.string() })
    router.post('/posts', { body: schema }, (req) => req.body.title)

    const route = router.list()[0]!
    assert.equal(route.method, 'POST')
    assert.equal(route.path, '/posts')
    assert.equal(route.middleware.length, 1)
  })

  test('opts form combines body validator with extra middleware', () => {
    const router = new Router()
    const schema = z.object({ title: z.string() })
    const extraMw = async (_req: AppRequest, _res: AppResponse, next: () => Promise<void>) => { await next() }
    router.post('/posts', { body: schema, middleware: [extraMw] }, () => null)

    const route = router.list()[0]!
    assert.equal(route.middleware.length, 2)
  })

  test('opts form installs BOTH query and body validators in order', () => {
    const router = new Router()
    const qSchema = z.object({ page: z.coerce.number() })
    const bSchema = z.object({ title: z.string() })
    router.post('/posts', { query: qSchema, body: bSchema }, () => null)

    const route = router.list()[0]!
    // query validator + body validator
    assert.equal(route.middleware.length, 2)
  })

  test('.body() chain prepends validator to per-route middleware', () => {
    const router = new Router()
    const otherMw = async (_req: AppRequest, _res: AppResponse, next: () => Promise<void>) => { await next() }
    const schema = z.object({ title: z.string() })

    router.post('/posts', () => null, [otherMw]).body(schema)

    const route = router.list()[0]!
    assert.equal(route.middleware.length, 2)
  })

  test('.query() + .body() chained together compose both validators', () => {
    const router = new Router()
    const qSchema = z.object({ page: z.coerce.number() })
    const bSchema = z.object({ title: z.string() })
    router.post('/posts', () => null).query(qSchema).body(bSchema)

    const route = router.list()[0]!
    assert.equal(route.middleware.length, 2)
  })

  test('end-to-end: body validator runs through the route middleware chain', async () => {
    const router = new Router()
    const schema = z.object({ title: z.string(), views: z.coerce.number() })

    let observed: unknown
    router.post('/posts', { body: schema }, (req) => { observed = req.body; return null })

    const route = router.list()[0]!
    const req   = makeReq({ title: 'hello', views: '42' })

    const mws     = route.middleware
    const handler = route.handler
    let i = 0
    const next = async (): Promise<void> => {
      const mw = mws[i++]
      if (mw) await mw(req, noopRes, next)
      else    await handler(req, noopRes)
    }
    await next()
    assert.deepStrictEqual(observed, { title: 'hello', views: 42 })
  })

  test('end-to-end: query + body together both parse', async () => {
    const router = new Router()
    const qSchema = z.object({ page: z.coerce.number() })
    const bSchema = z.object({ title: z.string() })

    let observedQuery: unknown
    let observedBody:  unknown
    router.post('/posts', { query: qSchema, body: bSchema }, (req) => {
      observedQuery = req.query
      observedBody  = req.body
      return null
    })

    const route = router.list()[0]!
    const req   = {
      ...makeReq({ title: 'hi' }),
      query: { page: '3' } as Record<string, string>,
    }

    const mws     = route.middleware
    const handler = route.handler
    let i = 0
    const next = async (): Promise<void> => {
      const mw = mws[i++]
      if (mw) await mw(req, noopRes, next)
      else    await handler(req, noopRes)
    }
    await next()
    assert.deepStrictEqual(observedQuery, { page: 3 })
    assert.deepStrictEqual(observedBody,  { title: 'hi' })
  })

  test('body validator rejection short-circuits the handler (handler never runs)', async () => {
    const router = new Router()
    const schema = z.object({ title: z.string() })

    let handlerRan = false
    router.post('/posts', { body: schema }, () => { handlerRan = true; return null })

    const route = router.list()[0]!
    const req   = makeReq({ title: 123 })

    const mws     = route.middleware
    const handler = route.handler
    let i = 0
    const next = async (): Promise<void> => {
      const mw = mws[i++]
      if (mw) await mw(req, noopRes, next)
      else    await handler(req, noopRes)
    }
    await assert.rejects(next, (err: unknown) => err instanceof ValidationError)
    assert.equal(handlerRan, false)
  })
})
