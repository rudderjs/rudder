import 'reflect-metadata'
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import type { RouteDefinition, ServerAdapter, MiddlewareHandler } from '@forge/contracts'
import { Router, Controller, Get, Post, Middleware } from './index.js'

class FakeServerAdapter implements ServerAdapter {
  readonly routes: RouteDefinition[] = []
  readonly middleware: MiddlewareHandler[] = []

  registerRoute(route: RouteDefinition): void {
    this.routes.push(route)
  }

  applyMiddleware(middleware: MiddlewareHandler): void {
    this.middleware.push(middleware)
  }

  listen(_port: number, callback?: () => void): void {
    callback?.()
  }

  getNativeServer(): unknown {
    return { kind: 'fake-server' }
  }
}

describe('Router contract baseline', () => {
  let router: Router

  beforeEach(() => {
    router = new Router()
  })

  it('registers fluent routes with method and path', () => {
    const handler = () => new Response('ok')

    router.get('/users', handler)
    router.post('/users', handler)

    const routes = router.list()
    assert.strictEqual(routes.length, 2)
    assert.strictEqual(routes[0]?.method, 'GET')
    assert.strictEqual(routes[0]?.path, '/users')
    assert.strictEqual(routes[1]?.method, 'POST')
    assert.strictEqual(routes[1]?.path, '/users')
  })

  it('mount() applies global middleware before routes', () => {
    const server = new FakeServerAdapter()
    const middleware = (() => undefined) as MiddlewareHandler

    router.use(middleware)
    router.get('/health', () => new Response('ok'))
    router.mount(server)

    assert.strictEqual(server.middleware.length, 1)
    assert.strictEqual(server.middleware[0], middleware)
    assert.strictEqual(server.routes.length, 1)
    assert.strictEqual(server.routes[0]?.path, '/health')
  })

  it('registerController() composes prefix + controller/method middleware', () => {
    const classMiddleware = (() => undefined) as MiddlewareHandler
    const methodMiddleware = (() => undefined) as MiddlewareHandler

    @Controller('/api')
    @Middleware([classMiddleware])
    class UsersController {
      @Get('/users')
      index() {
        return new Response('ok')
      }

      @Post('/users')
      @Middleware([methodMiddleware])
      create() {
        return new Response('created')
      }
    }

    router.registerController(UsersController)
    const routes = router.list()

    assert.strictEqual(routes.length, 2)

    const getRoute = routes.find(r => r.method === 'GET')
    assert.ok(getRoute)
    assert.strictEqual(getRoute.path, '/api/users')
    assert.deepStrictEqual(getRoute.middleware, [classMiddleware])

    const postRoute = routes.find(r => r.method === 'POST')
    assert.ok(postRoute)
    assert.strictEqual(postRoute.path, '/api/users')
    assert.deepStrictEqual(postRoute.middleware, [classMiddleware, methodMiddleware])
  })

  it('reset() clears routes and global middleware', () => {
    const middleware = (() => undefined) as MiddlewareHandler
    router.use(middleware)
    router.get('/health', () => new Response('ok'))

    router.reset()

    const server = new FakeServerAdapter()
    router.mount(server)
    assert.strictEqual(router.list().length, 0)
    assert.strictEqual(server.middleware.length, 0)
    assert.strictEqual(server.routes.length, 0)
  })
})
