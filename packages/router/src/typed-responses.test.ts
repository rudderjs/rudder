// Typed responses (.responds) + schema retention on RouteDefinition.
//
// Phase 1 of the typed-responses/OpenAPI arc: `.body()`/`.query()` now retain
// the raw schema on the definition (was buried in a validator middleware), and
// `.responds()` declares per-status response schemas — both so a downstream
// emitter (the @rudderjs/openapi package) can read them. `.responds()` types
// against Standard Schema, so a Zod schema (which implements `~standard`) is
// accepted structurally.

import 'reflect-metadata'
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { z } from 'zod'
import { Router } from './index.js'

describe('schema retention — .body() / .query()', () => {
  let r: Router
  beforeEach(() => { r = new Router() })

  it('.body(schema) retains the raw schema on the definition AND still validates', () => {
    const schema = z.object({ title: z.string() })
    r.post('/posts', () => {}).body(schema)
    const def = r.list()[0]!
    assert.strictEqual(def.bodySchema, schema, 'raw body schema retained')
    // Validation middleware is still installed (prepended).
    assert.ok(def.middleware.length >= 1, 'body validator middleware present')
  })

  it('.query(schema) retains the raw schema on the definition', () => {
    const schema = z.object({ page: z.coerce.number() })
    r.get('/users', () => {}).query(schema)
    assert.strictEqual(r.list()[0]!.querySchema, schema)
  })

  it('routes without .body()/.query() leave the schema fields undefined', () => {
    r.get('/plain', () => {})
    const def = r.list()[0]!
    assert.strictEqual(def.bodySchema, undefined)
    assert.strictEqual(def.querySchema, undefined)
  })
})

describe('.name() retains the name on the definition', () => {
  it('populates def.name (single source for introspection)', () => {
    const r = new Router()
    r.get('/users/:id', () => {}).name('users.show')
    assert.strictEqual(r.list()[0]!.name, 'users.show')
  })
})

describe('.responds() — declared response schemas', () => {
  let r: Router
  beforeEach(() => { r = new Router() })

  it('.responds(schema) defaults to status 200', () => {
    const ok = z.object({ id: z.number(), name: z.string() })
    r.get('/users/:id', () => {}).responds(ok)
    const responses = r.list()[0]!.responses!
    assert.strictEqual(responses[200]!.schema, ok)
  })

  it('.responds(status, schema) stores under that status; multiple accumulate', () => {
    const ok       = z.object({ id: z.number() })
    const notFound = z.object({ error: z.string() })
    r.get('/users/:id', () => {})
      .responds(200, ok)
      .responds(404, notFound, { description: 'User not found' })
    const responses = r.list()[0]!.responses!
    assert.strictEqual(responses[200]!.schema, ok)
    assert.strictEqual(responses[404]!.schema, notFound)
    assert.strictEqual(responses[404]!.description, 'User not found')
    assert.strictEqual(responses[200]!.description, undefined)
  })

  it('a union schema is accepted (same-status variant shapes)', () => {
    const variant = z.union([
      z.object({ type: z.literal('user'),  id: z.number() }),
      z.object({ type: z.literal('guest'), sessionId: z.string() }),
    ])
    r.get('/me', () => {}).responds(variant)
    assert.strictEqual(r.list()[0]!.responses![200]!.schema, variant)
  })

  it('chains with .body()/.query()/.name() and keeps all of them', () => {
    r.post('/posts', () => {})
      .name('posts.store')
      .body(z.object({ title: z.string() }))
      .responds(201, z.object({ id: z.number() }))
    const def = r.list()[0]!
    assert.strictEqual(def.name, 'posts.store')
    assert.ok(def.bodySchema)
    assert.ok(def.responses![201])
  })
})
