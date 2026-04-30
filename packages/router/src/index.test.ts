import 'reflect-metadata'
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import type { RouteDefinition, ServerAdapter, MiddlewareHandler } from '@rudderjs/contracts'
import {
  Router, router, Route,
  Controller, Middleware,
  Get, Post, Put, Patch, Delete, Options,
} from './index.js'

// ─── Test helpers ───────────────────────────────────────────

class FakeServer implements ServerAdapter {
  readonly routes: RouteDefinition[] = []
  readonly middleware: MiddlewareHandler[] = []

  registerRoute(route: RouteDefinition): void { this.routes.push(route) }
  applyMiddleware(mw: MiddlewareHandler): void { this.middleware.push(mw) }
  listen(_port: number, cb?: () => void): void { cb?.() }
  getNativeServer(): unknown { return {} }
}

const noop: MiddlewareHandler = async () => {}
const noop2: MiddlewareHandler = async () => {}
const handler = () => {}

// ─── Router fluent methods ──────────────────────────────────

describe('Router — fluent methods', () => {
  let r: Router

  beforeEach(() => { r = new Router() })

  it('get() registers GET route', () => {
    r.get('/users', handler)
    const routes = r.list()
    assert.strictEqual(routes.length, 1)
    assert.strictEqual(routes[0]?.method, 'GET')
    assert.strictEqual(routes[0]?.path, '/users')
  })

  it('post() registers POST route', () => {
    r.post('/users', handler)
    assert.strictEqual(r.list()[0]?.method, 'POST')
  })

  it('put() registers PUT route', () => {
    r.put('/users/1', handler)
    assert.strictEqual(r.list()[0]?.method, 'PUT')
  })

  it('patch() registers PATCH route', () => {
    r.patch('/users/1', handler)
    assert.strictEqual(r.list()[0]?.method, 'PATCH')
  })

  it('delete() registers DELETE route', () => {
    r.delete('/users/1', handler)
    assert.strictEqual(r.list()[0]?.method, 'DELETE')
  })

  it('all() registers ALL method route', () => {
    r.all('/api/*', handler)
    assert.strictEqual(r.list()[0]?.method, 'ALL')
  })

  it('add() registers route with explicit method', () => {
    r.add('OPTIONS', '/api/resource', handler)
    assert.strictEqual(r.list()[0]?.method, 'OPTIONS')
  })

  it('routes preserve registration order', () => {
    r.get('/a', handler)
    r.post('/b', handler)
    r.put('/c', handler)
    const routes = r.list()
    assert.strictEqual(routes[0]?.path, '/a')
    assert.strictEqual(routes[1]?.path, '/b')
    assert.strictEqual(routes[2]?.path, '/c')
  })

  it('fluent methods accept route-level middleware', () => {
    r.get('/protected', handler, [noop])
    assert.deepStrictEqual(r.list()[0]?.middleware, [noop])
  })

  it('fluent methods with no middleware default to empty array', () => {
    r.get('/open', handler)
    assert.deepStrictEqual(r.list()[0]?.middleware, [])
  })

  it('verb methods register routes and return RouteBuilder for .name()', () => {
    r.get('/a', handler)
    r.post('/b', handler)
    r.delete('/c', handler)
    assert.strictEqual(r.list().length, 3)
    // RouteBuilder supports .name() chaining
    r.get('/d', handler).name('d-route')
    assert.strictEqual(r.getNamedRoute('d-route'), '/d')
  })

  it('list() returns a copy — mutations do not affect internal state', () => {
    r.get('/a', handler)
    const list = r.list()
    list.push({ method: 'GET', path: '/injected', handler, middleware: [] })
    assert.strictEqual(r.list().length, 1)
  })
})

// ─── Router.use() and global middleware ────────────────────

describe('Router — global middleware', () => {
  let r: Router

  beforeEach(() => { r = new Router() })

  it('use() registers global middleware', () => {
    r.use(noop)
    const server = new FakeServer()
    r.mount(server)
    assert.deepStrictEqual(server.middleware, [noop])
  })

  it('multiple use() calls accumulate in order', () => {
    r.use(noop)
    r.use(noop2)
    const server = new FakeServer()
    r.mount(server)
    assert.strictEqual(server.middleware[0], noop)
    assert.strictEqual(server.middleware[1], noop2)
  })

  it('use() is chainable', () => {
    const result = r.use(noop).use(noop2)
    assert.strictEqual(result, r)
  })
})

// ─── Router.mount() ────────────────────────────────────────

describe('Router — mount()', () => {
  let r: Router

  beforeEach(() => { r = new Router() })

  it('registers all routes on the server adapter', () => {
    r.get('/a', handler)
    r.post('/b', handler)
    const server = new FakeServer()
    r.mount(server)
    assert.strictEqual(server.routes.length, 2)
    assert.strictEqual(server.routes[0]?.path, '/a')
    assert.strictEqual(server.routes[1]?.path, '/b')
  })

  it('applies global middleware before routes', () => {
    r.use(noop)
    r.get('/x', handler)
    const server = new FakeServer()
    r.mount(server)
    assert.strictEqual(server.middleware[0], noop)
    assert.strictEqual(server.routes[0]?.path, '/x')
  })

  it('works with no routes and no middleware', () => {
    const server = new FakeServer()
    r.mount(server)
    assert.strictEqual(server.routes.length, 0)
    assert.strictEqual(server.middleware.length, 0)
  })
})

// ─── Router.reset() ────────────────────────────────────────

describe('Router — reset()', () => {
  let r: Router

  beforeEach(() => { r = new Router() })

  it('clears all routes', () => {
    r.get('/a', handler)
    r.reset()
    assert.strictEqual(r.list().length, 0)
  })

  it('clears global middleware', () => {
    r.use(noop)
    r.reset()
    const server = new FakeServer()
    r.mount(server)
    assert.strictEqual(server.middleware.length, 0)
  })

  it('is chainable', () => {
    assert.strictEqual(r.reset(), r)
  })
})

// ─── Decorator: @Controller ────────────────────────────────

describe('@Controller', () => {
  let r: Router

  beforeEach(() => { r = new Router() })

  it('registers routes with the given prefix', () => {
    @Controller('/api/users')
    class UserCtrl {
      @Get('/')
      index() {}
    }
    r.registerController(UserCtrl)
    assert.strictEqual(r.list()[0]?.path, '/api/users/')
  })

  it('normalises double slashes (prefix + path)', () => {
    @Controller('/api')
    class Ctrl {
      @Get('/users')
      index() {}
    }
    r.registerController(Ctrl)
    assert.strictEqual(r.list()[0]?.path, '/api/users')
  })

  it('works without a prefix (empty string)', () => {
    @Controller()
    class Ctrl {
      @Get('/health')
      health() {}
    }
    r.registerController(Ctrl)
    assert.strictEqual(r.list()[0]?.path, '/health')
  })

  it('binds handler to the controller instance', async () => {
    let capturedThis: unknown
    @Controller()
    class Ctrl {
      readonly tag = 'controller-instance'
      @Get('/test')
      // eslint-disable-next-line @typescript-eslint/no-this-alias
      doIt() { capturedThis = this }
    }
    r.registerController(Ctrl)
    const route = r.list()[0]
    assert.ok(route)
    await route.handler({} as any, {} as any)
    assert.ok((capturedThis as any)?.tag === 'controller-instance')
  })
})

// ─── Decorator: HTTP method decorators ─────────────────────

describe('HTTP method decorators', () => {
  let r: Router

  beforeEach(() => { r = new Router() })

  it('@Get registers GET', () => {
    @Controller()
    class Ctrl { @Get('/x') x() {} }
    r.registerController(Ctrl)
    assert.strictEqual(r.list()[0]?.method, 'GET')
  })

  it('@Post registers POST', () => {
    @Controller()
    class Ctrl { @Post('/x') x() {} }
    r.registerController(Ctrl)
    assert.strictEqual(r.list()[0]?.method, 'POST')
  })

  it('@Put registers PUT', () => {
    @Controller()
    class Ctrl { @Put('/x') x() {} }
    r.registerController(Ctrl)
    assert.strictEqual(r.list()[0]?.method, 'PUT')
  })

  it('@Patch registers PATCH', () => {
    @Controller()
    class Ctrl { @Patch('/x') x() {} }
    r.registerController(Ctrl)
    assert.strictEqual(r.list()[0]?.method, 'PATCH')
  })

  it('@Delete registers DELETE', () => {
    @Controller()
    class Ctrl { @Delete('/x') x() {} }
    r.registerController(Ctrl)
    assert.strictEqual(r.list()[0]?.method, 'DELETE')
  })

  it('@Options registers OPTIONS', () => {
    @Controller()
    class Ctrl { @Options('/x') x() {} }
    r.registerController(Ctrl)
    assert.strictEqual(r.list()[0]?.method, 'OPTIONS')
  })

  it('multiple route decorators on same controller register multiple routes', () => {
    @Controller('/api')
    class Ctrl {
      @Get('/users') index() {}
      @Post('/users') create() {}
      @Delete('/users/:id') destroy() {}
    }
    r.registerController(Ctrl)
    assert.strictEqual(r.list().length, 3)
  })
})

// ─── Decorator: @Middleware ─────────────────────────────────

describe('@Middleware', () => {
  let r: Router

  beforeEach(() => { r = new Router() })

  it('class-level @Middleware applies to every route', () => {
    @Controller()
    @Middleware([noop])
    class Ctrl {
      @Get('/a') a() {}
      @Post('/b') b() {}
    }
    r.registerController(Ctrl)
    const routes = r.list()
    assert.ok(routes.every(rt => rt.middleware.includes(noop)))
  })

  it('method-level @Middleware applies only to that route', () => {
    @Controller()
    class Ctrl {
      @Get('/open') open() {}
      @Post('/protected') @Middleware([noop]) protected() {}
    }
    r.registerController(Ctrl)
    const routes = r.list()
    const open = routes.find(rt => rt.path === '/open')
    const prot = routes.find(rt => rt.path === '/protected')
    assert.deepStrictEqual(open?.middleware, [])
    assert.ok(prot?.middleware.includes(noop))
  })

  it('class middleware comes before method middleware', () => {
    @Controller()
    @Middleware([noop])
    class Ctrl {
      @Get('/x') @Middleware([noop2]) x() {}
    }
    r.registerController(Ctrl)
    const mw = r.list()[0]?.middleware ?? []
    assert.strictEqual(mw[0], noop)
    assert.strictEqual(mw[1], noop2)
  })
})

// ─── Global router / Route alias ───────────────────────────

describe('Global router and Route alias', () => {
  it('router is a Router instance', () => {
    assert.ok(router instanceof Router)
  })

  it('Route is the same object as router', () => {
    assert.strictEqual(Route, router)
  })
})

// ─── Route model binding ───────────────────────────────────

describe('Router.bind() — route model binding', () => {
  let r: Router

  beforeEach(() => { r = new Router() })

  function makeReq(params: Record<string, string>): import('@rudderjs/contracts').AppRequest {
    return {
      method: 'GET', url: '/', path: '/',
      query: {}, params, headers: {},
      body: null, raw: null,
      input: () => undefined as never,
      string: () => '',
      integer: () => 0,
      float: () => 0,
      boolean: () => false,
      date: () => new Date(),
      array: () => [],
      has: () => false,
      missing: () => true,
      filled: () => false,
    }
  }

  function makeRes(): import('@rudderjs/contracts').AppResponse {
    return {
      statusCode: 200,
      status() { return this },
      header() { return this },
      json() {},
      send() {},
      redirect() {},
      raw: null,
    }
  }

  it('listBindings() reflects registered bindings', () => {
    const User = { name: 'User', findForRoute: async () => null }
    r.bind('user', User)
    assert.ok('user' in r.listBindings())
    assert.strictEqual(r.listBindings()['user'], User)
  })

  it('reset() clears bindings', () => {
    r.bind('user', { name: 'User', findForRoute: async () => null })
    assert.equal(Object.keys(r.listBindings()).length, 1)
    r.reset()
    assert.equal(Object.keys(r.listBindings()).length, 0)
  })

  it('routes without :name params get no binding middleware injected', () => {
    r.bind('user', { name: 'User', findForRoute: async () => ({ id: 1 }) })
    r.get('/health', handler)
    const server = new FakeServer()
    r.mount(server)
    assert.equal(server.routes[0]?.middleware.length, 0)
  })

  it('routes with bound :name param get binding middleware prepended', () => {
    r.bind('user', { name: 'User', findForRoute: async () => ({ id: 1 }) })
    r.get('/users/:user', handler)
    const server = new FakeServer()
    r.mount(server)
    assert.equal(server.routes[0]?.middleware.length, 1)
  })

  it('binding middleware resolves and populates req.bound', async () => {
    let resolverArg: string | null = null
    const User = {
      name: 'User',
      findForRoute: async (val: string) => { resolverArg = val; return { id: 7, name: 'Alice' } },
    }
    r.bind('user', User)
    r.get('/users/:user', handler)

    const server = new FakeServer()
    r.mount(server)
    const mw = server.routes[0]!.middleware[0]!

    const req = makeReq({ user: '7' })
    let nextCalled = false
    await mw(req, makeRes(), async () => { nextCalled = true })
    assert.equal(resolverArg, '7')
    assert.deepStrictEqual((req as unknown as { bound: Record<string, unknown> }).bound, {
      user: { id: 7, name: 'Alice' },
    })
    assert.equal(nextCalled, true)
  })

  it('binding middleware throws RouteModelNotFoundError when resolver returns null', async () => {
    const { RouteModelNotFoundError } = await import('./index.js')
    r.bind('user', { name: 'User', findForRoute: async () => null })
    r.get('/users/:user', handler)
    const server = new FakeServer()
    r.mount(server)
    const mw = server.routes[0]!.middleware[0]!

    await assert.rejects(
      async () => { await mw(makeReq({ user: '99' }), makeRes(), async () => {}) },
      (err: unknown) => err instanceof RouteModelNotFoundError
        && err.model === 'User'
        && err.param === 'user'
        && err.value === '99',
    )
  })

  it('optional binding sets bound[name] = null instead of throwing', async () => {
    r.bind('user', { name: 'User', findForRoute: async () => null }, { optional: true })
    r.get('/users/:user', handler)
    const server = new FakeServer()
    r.mount(server)
    const mw = server.routes[0]!.middleware[0]!

    const req = makeReq({ user: '99' })
    let nextCalled = false
    await mw(req, makeRes(), async () => { nextCalled = true })
    assert.equal((req as unknown as { bound: Record<string, unknown> }).bound['user'], null)
    assert.equal(nextCalled, true)
  })

  it('throws when a required param value is empty', async () => {
    const { RouteModelNotFoundError } = await import('./index.js')
    r.bind('user', { name: 'User', findForRoute: async () => ({ id: 1 }) })
    r.get('/users/:user', handler)
    const server = new FakeServer()
    r.mount(server)
    const mw = server.routes[0]!.middleware[0]!

    await assert.rejects(
      async () => { await mw(makeReq({ user: '' }), makeRes(), async () => {}) },
      (err: unknown) => err instanceof RouteModelNotFoundError && err.value === '',
    )
  })

  it('preserves user-provided per-route middleware after binding mw', async () => {
    const calls: string[] = []
    const userMw: MiddlewareHandler = async (_req, _res, next) => { calls.push('user'); await next() }
    r.bind('user', { name: 'User', findForRoute: async () => ({ id: 1 }) })
    r.get('/users/:user', handler, [userMw])
    const server = new FakeServer()
    r.mount(server)
    const route = server.routes[0]!
    assert.equal(route.middleware.length, 2)
    // Run them in order to confirm binding mw is first.
    const req = makeReq({ user: '1' })
    let bindingFirst = false
    await route.middleware[0]!(req, makeRes(), async () => {
      // After binding mw, req.bound is populated
      bindingFirst = (req as unknown as { bound: Record<string, unknown> }).bound['user'] !== undefined
      await route.middleware[1]!(req, makeRes(), async () => {})
    })
    assert.equal(bindingFirst, true)
    assert.deepStrictEqual(calls, ['user'])
  })

  it('multiple bindings on one route are all resolved', async () => {
    const Owner = { name: 'Owner', findForRoute: async (v: string) => ({ id: Number(v), kind: 'owner' }) }
    const Pet   = { name: 'Pet',   findForRoute: async (v: string) => ({ id: Number(v), kind: 'pet' }) }
    r.bind('owner', Owner)
    r.bind('pet', Pet)
    r.get('/owners/:owner/pets/:pet', handler)
    const server = new FakeServer()
    r.mount(server)
    const mw = server.routes[0]!.middleware[0]!

    const req = makeReq({ owner: '1', pet: '2' })
    await mw(req, makeRes(), async () => {})
    const bound = (req as unknown as { bound: Record<string, unknown> }).bound
    assert.deepStrictEqual(bound['owner'], { id: 1, kind: 'owner' })
    assert.deepStrictEqual(bound['pet'],   { id: 2, kind: 'pet' })
  })

  it('unbound params on the same route are ignored', async () => {
    r.bind('user', { name: 'User', findForRoute: async () => ({ id: 1 }) })
    r.get('/users/:user/posts/:postId', handler)
    const server = new FakeServer()
    r.mount(server)
    const mw = server.routes[0]!.middleware[0]!

    const req = makeReq({ user: '1', postId: '42' })
    await mw(req, makeRes(), async () => {})
    const bound = (req as unknown as { bound: Record<string, unknown> }).bound
    assert.equal(bound['user'] !== undefined, true)
    assert.equal('postId' in bound, false) // postId is not bound — stays a plain string in req.params
    assert.equal(req.params['postId'], '42')
  })

  it('synchronous resolver is supported', async () => {
    r.bind('user', { name: 'User', findForRoute: (v: string) => ({ id: Number(v) }) })
    r.get('/users/:user', handler)
    const server = new FakeServer()
    r.mount(server)
    const mw = server.routes[0]!.middleware[0]!

    const req = makeReq({ user: '5' })
    await mw(req, makeRes(), async () => {})
    assert.deepStrictEqual((req as unknown as { bound: Record<string, unknown> }).bound['user'], { id: 5 })
  })

  it('optional :param? syntax is recognized', async () => {
    r.bind('user', { name: 'User', findForRoute: async () => ({ id: 1 }) })
    r.get('/profile/:user?', handler)
    const server = new FakeServer()
    r.mount(server)
    assert.equal(server.routes[0]?.middleware.length, 1)
  })
})
