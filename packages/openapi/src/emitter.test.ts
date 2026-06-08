import assert from 'node:assert/strict'
import { test } from 'node:test'
import { z } from 'zod'
import type { RouteDefinition } from '@rudderjs/contracts'
import { generateOpenApiDocument } from './emitter.js'
import { registerSchemaConverter } from './converters.js'
import type { RouterLike } from './types.js'

// Minimal RouteDefinition factory — only the introspection fields matter here.
function route(partial: Partial<RouteDefinition> & Pick<RouteDefinition, 'method' | 'path'>): RouteDefinition {
  return {
    handler: () => undefined,
    middleware: [],
    ...partial,
  } as RouteDefinition
}

function routerOf(...defs: RouteDefinition[]): RouterLike {
  return { list: () => defs }
}

const INFO = { title: 'Test API', version: '2.0.0' }

test('emits a 3.1 document with info', () => {
  const doc = generateOpenApiDocument(routerOf(), INFO)
  assert.equal(doc.openapi, '3.1.0')
  assert.deepEqual(doc.info, { title: 'Test API', version: '2.0.0' })
  assert.deepEqual(doc.paths, {})
})

test('path params: :id → {id}, named operationId, body, query, responses', () => {
  const doc = generateOpenApiDocument(routerOf(
    route({
      method: 'POST',
      path: '/users/:id',
      name: 'users.update',
      bodySchema: z.object({ name: z.string(), age: z.number().optional() }),
      querySchema: z.object({ notify: z.boolean() }),
      responses: {
        200: { schema: z.object({ id: z.number(), name: z.string() }), description: 'The user' },
        404: { schema: z.object({ error: z.string() }) },
      },
    }),
  ), INFO)

  const op = doc.paths['/users/{id}']?.post
  assert.ok(op, 'operation exists under templated path + post')
  assert.equal(op.operationId, 'users.update')

  // path param
  const pathParam = op.parameters?.find(p => p.in === 'path')
  assert.deepEqual(pathParam, { name: 'id', in: 'path', required: true, schema: { type: 'string' } })

  // query param
  const queryParam = op.parameters?.find(p => p.in === 'query')
  assert.equal(queryParam?.name, 'notify')
  assert.equal(queryParam?.required, true)
  assert.deepEqual(queryParam?.schema, { type: 'boolean' })

  // request body
  assert.equal(op.requestBody?.required, true)
  const bodySchema = op.requestBody?.content['application/json']?.schema as Record<string, unknown>
  assert.equal(bodySchema.type, 'object')
  assert.deepEqual(bodySchema.required, ['name'])

  // responses
  assert.equal(op.responses['200']?.description, 'The user')
  assert.ok(op.responses['200']?.content?.['application/json'])
  assert.equal(op.responses['404']?.description, 'Not Found')
})

test('whereNumber pattern → integer path param', () => {
  const doc = generateOpenApiDocument(routerOf(
    route({ method: 'GET', path: '/posts/:id{[0-9]+}', name: 'posts.show' }),
  ), INFO)
  const param = doc.paths['/posts/{id}']?.get?.parameters?.[0]
  assert.deepEqual(param, { name: 'id', in: 'path', required: true, schema: { type: 'integer' } })
})

test('multiple methods on one path merge into one path item', () => {
  const doc = generateOpenApiDocument(routerOf(
    route({ method: 'GET', path: '/widgets', name: 'widgets.index' }),
    route({ method: 'POST', path: '/widgets', name: 'widgets.store' }),
  ), INFO)
  const item = doc.paths['/widgets']
  assert.ok(item?.get)
  assert.ok(item?.post)
  assert.equal(item.get?.operationId, 'widgets.index')
  assert.equal(item.post?.operationId, 'widgets.store')
})

test('unnamed route synthesizes an operationId from method + path', () => {
  const doc = generateOpenApiDocument(routerOf(
    route({ method: 'GET', path: '/health/check' }),
  ), INFO)
  assert.equal(doc.paths['/health/check']?.get?.operationId, 'get_health_check')
})

test('route with no declared responses gets a generic 200', () => {
  const doc = generateOpenApiDocument(routerOf(
    route({ method: 'GET', path: '/ping', name: 'ping' }),
  ), INFO)
  assert.deepEqual(doc.paths['/ping']?.get?.responses, { '200': { description: 'OK' } })
})

test('router.all() expands to the common HTTP methods', () => {
  const doc = generateOpenApiDocument(routerOf(
    route({ method: 'ALL', path: '/any', name: 'any' }),
  ), INFO)
  const item = doc.paths['/any']
  for (const m of ['get', 'post', 'put', 'patch', 'delete'] as const) {
    assert.ok(item?.[m], `expected ${m} operation`)
  }
})

test('explicit method wins over an all() catch-all on the same path', () => {
  const doc = generateOpenApiDocument(routerOf(
    route({ method: 'GET', path: '/mixed', name: 'mixed.get' }),
    route({ method: 'ALL', path: '/mixed', name: 'mixed.all' }),
  ), INFO)
  // GET registered first → keeps its specific operationId, not the all() one.
  assert.equal(doc.paths['/mixed']?.get?.operationId, 'mixed.get')
  // The all()-expanded POST gets a method-suffixed id (multi-method → unique).
  assert.equal(doc.paths['/mixed']?.post?.operationId, 'mixed.all_post')
})

test('a validator with no registered converter is warned + skipped, not a crash', () => {
  // A fake Standard Schema validator for an unknown vendor.
  const fake = { '~standard': { version: 1, vendor: 'mystery-validator', validate: () => ({ value: {} }) } }
  const warnings: string[] = []
  const doc = generateOpenApiDocument(routerOf(
    route({ method: 'POST', path: '/x', name: 'x', bodySchema: fake, responses: { 200: { schema: fake } } }),
  ), { ...INFO, onWarn: (m) => warnings.push(m) })

  const op = doc.paths['/x']?.post
  // No requestBody emitted (schema skipped), response has description but no content.
  assert.equal(op?.requestBody, undefined)
  assert.equal(op?.responses['200']?.content, undefined)
  assert.ok(warnings.some(w => w.includes('mystery-validator')))
})

test('a schema with no ~standard tag is warned + skipped', () => {
  const warnings: string[] = []
  generateOpenApiDocument(routerOf(
    route({ method: 'POST', path: '/y', name: 'y', bodySchema: { not: 'a schema' } }),
  ), { ...INFO, onWarn: (m) => warnings.push(m) })
  assert.ok(warnings.some(w => w.includes('no Standard Schema')))
})

test('registerSchemaConverter lets a custom vendor plug in', () => {
  registerSchemaConverter('myvendor', () => ({ type: 'object', properties: { ok: { type: 'boolean' } } }))
  const fake = { '~standard': { version: 1, vendor: 'myvendor', validate: () => ({ value: {} }) } }
  const doc = generateOpenApiDocument(routerOf(
    route({ method: 'POST', path: '/z', name: 'z', bodySchema: fake }),
  ), INFO)
  // The registry dispatches on the top-level schema's vendor tag.
  assert.deepEqual(
    doc.paths['/z']?.post?.requestBody?.content['application/json']?.schema,
    { type: 'object', properties: { ok: { type: 'boolean' } } },
  )
})

test('operationIds stay unique across wildcard/collision-prone paths', () => {
  const doc = generateOpenApiDocument(routerOf(
    route({ method: 'GET', path: '/api/files' }),
    route({ method: 'GET', path: '/api/files/*' }),
  ), INFO)
  const a = doc.paths['/api/files']?.get?.operationId
  const b = doc.paths['/api/files/*']?.get?.operationId
  assert.equal(a, 'get_api_files')
  assert.equal(b, 'get_api_files_all') // `*` → `all`, so no collision
  assert.notEqual(a, b)
})

test('servers from info land on the document', () => {
  const doc = generateOpenApiDocument(routerOf(), { ...INFO, servers: [{ url: 'https://api.example.com' }] })
  assert.deepEqual(doc.servers, [{ url: 'https://api.example.com' }])
})
