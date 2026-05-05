import 'reflect-metadata'
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import type { RouteDefinition, ServerAdapter, MiddlewareHandler, AppRequest } from '@rudderjs/contracts'
import { attachInputAccessors } from '@rudderjs/contracts'
import {
  Router, router, Route,
  Controller, Middleware,
  Get, Post, Put, Patch, Delete, Options,
  route,
  ROUTE_PATTERN_NUMBER,
  ROUTE_PATTERN_ALPHA,
  ROUTE_PATTERN_ALPHANUM,
  ROUTE_PATTERN_UUID,
  ROUTE_PATTERN_ULID,
  Url,
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

  it('RouteModelNotFoundError exposes httpStatus = 404 for the framework HTTP layer', async () => {
    const { RouteModelNotFoundError } = await import('./index.js')
    const err = new RouteModelNotFoundError('User', 'user', 'missing')
    assert.equal(err.httpStatus, 404)
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

// ─── RouteBuilder.where*() — constraint shortcuts ──────────

describe('RouteBuilder.where()', () => {
  let r: Router
  beforeEach(() => { r = new Router() })

  it('rewrites :param to :param{pattern} via Hono regex syntax', () => {
    r.get('/users/:id', handler).whereNumber('id')
    assert.strictEqual(r.list()[0]?.path, `/users/:id{${ROUTE_PATTERN_NUMBER}}`)
  })

  it('whereAlpha applies the letter pattern', () => {
    r.get('/users/:slug', handler).whereAlpha('slug')
    assert.strictEqual(r.list()[0]?.path, `/users/:slug{${ROUTE_PATTERN_ALPHA}}`)
  })

  it('whereAlphaNumeric applies the alphanum pattern', () => {
    r.get('/code/:c', handler).whereAlphaNumeric('c')
    assert.strictEqual(r.list()[0]?.path, `/code/:c{${ROUTE_PATTERN_ALPHANUM}}`)
  })

  it('whereUuid applies the UUID pattern', () => {
    r.get('/u/:id', handler).whereUuid('id')
    assert.strictEqual(r.list()[0]?.path, `/u/:id{${ROUTE_PATTERN_UUID}}`)
  })

  it('whereUlid applies the ULID pattern', () => {
    r.get('/u/:id', handler).whereUlid('id')
    assert.strictEqual(r.list()[0]?.path, `/u/:id{${ROUTE_PATTERN_ULID}}`)
  })

  it('whereIn alternates supplied literal values, regex-escaped', () => {
    r.get('/posts/:status', handler).whereIn('status', ['draft', 'published'])
    assert.strictEqual(r.list()[0]?.path, '/posts/:status{(?:draft|published)}')
  })

  it('whereIn escapes regex metacharacters in values', () => {
    r.get('/file/:ext', handler).whereIn('ext', ['png', 'jpg.bak'])
    assert.strictEqual(r.list()[0]?.path, '/file/:ext{(?:png|jpg\\.bak)}')
  })

  it('where() accepts a RegExp and uses its .source', () => {
    r.get('/n/:n', handler).where('n', /\d+/)
    assert.strictEqual(r.list()[0]?.path, '/n/:n{\\d+}')
  })

  it('repeat where*() calls overwrite (last wins)', () => {
    r.get('/x/:id', handler).whereNumber('id').where('id', '[a-f0-9]+')
    assert.strictEqual(r.list()[0]?.path, '/x/:id{[a-f0-9]+}')
  })

  it('chains with .name() in either order', () => {
    r.get('/u/:id', handler).whereNumber('id').name('users.show')
    r.get('/p/:id', handler).name('posts.show').whereNumber('id')
    assert.strictEqual(r.getNamedRoute('users.show'), `/u/:id{${ROUTE_PATTERN_NUMBER}}`)
    assert.strictEqual(r.getNamedRoute('posts.show'), `/p/:id{${ROUTE_PATTERN_NUMBER}}`)
  })

  it('throws when path has no :param segment', () => {
    assert.throws(() => r.get('/users', handler).whereNumber('id'), /no :id segment/)
  })

  it('throws when whereIn is given an empty values array', () => {
    assert.throws(() => r.get('/x/:s', handler).whereIn('s', []), /must be non-empty/)
  })

  it('does not match :id inside :identifier (longest segment-name wins)', () => {
    r.get('/u/:identifier', handler).whereAlpha('identifier')
    assert.strictEqual(r.list()[0]?.path, `/u/:identifier{${ROUTE_PATTERN_ALPHA}}`)
    // throws because `:id` segment doesn't exist standalone
    assert.throws(() => r.get('/v/:identifier', handler).whereNumber('id'), /no :id segment/)
  })

  it('route() URL generator handles paths with {regex} segments', () => {
    router.get('/users/:id', handler).whereNumber('id').name('rb.users.show')
    assert.strictEqual(route('rb.users.show', { id: 42 }), '/users/42')
    router.reset()
  })

  it('route() works with multiple constrained params + extra query', () => {
    router.get('/posts/:postId/comments/:cid', handler)
      .whereNumber('postId').whereUuid('cid').name('rb.posts.comments.show')
    const url = route('rb.posts.comments.show', {
      postId: 7,
      cid: '550e8400-e29b-41d4-a716-446655440000',
      page: 2,
    })
    assert.strictEqual(url, '/posts/7/comments/550e8400-e29b-41d4-a716-446655440000?page=2')
    router.reset()
  })

  it('route binding extraction ignores params named inside {regex} bodies', async () => {
    let called = false
    const resolver = { name: 'X', findForRoute: () => { called = true; return { ok: true } } }
    r.bind('id', resolver)
    // `:foo` inside the regex pattern must NOT be picked up as a route param
    r.get('/x/:id', handler).where('id', '(?::foo|\\d+)')
    const server = new FakeServer()
    r.mount(server)
    const mw = server.routes[0]!.middleware[0]!
    const req = { params: { id: '5' }, query: {}, headers: {}, body: undefined, url: '/x/5' }
    await mw(req as unknown as Parameters<MiddlewareHandler>[0], {} as unknown as Parameters<MiddlewareHandler>[1], async () => {})
    assert.strictEqual(called, true)
    assert.deepStrictEqual((req as unknown as { bound: Record<string, unknown> }).bound, { id: { ok: true } })
  })

  it('whereIn handles values that regex-escape to `\\}` without breaking route()', () => {
    // `}` is regex-escaped to `\}`, which a naive balanced-brace scanner
    // would treat as a block terminator and corrupt the param extraction
    // — the regression was a path like `/items/a}bc)}` (junk appended).
    router.get('/items/:id', handler)
      .whereIn('id', ['ok', 'a}b'])
      .name('rb.brace.escape')
    assert.strictEqual(route('rb.brace.escape', { id: 'ok' }), '/items/ok')
    router.reset()
  })

  it('repeat where() after whereIn-with-`}` overwrites cleanly (escape-aware brace tracking)', () => {
    // First call writes a path containing `\}`. Second call has to balance
    // braces correctly to find the existing block, even though the escape
    // sits inside it. Without escape-aware tracking, the second call would
    // overwrite only part of the block and leave `]+}` style junk behind.
    r.get('/items/:id', handler).whereIn('id', ['a}b']).whereNumber('id')
    assert.strictEqual(r.list()[0]?.path, `/items/:id{${ROUTE_PATTERN_NUMBER}}`)
  })

  it('repeat where() after a regex with `}` inside `[^}]` overwrites cleanly', () => {
    // `}` inside a character class is literal. The brace scanner has to
    // track `[ ... ]` context so the inner `}` doesn't terminate the block.
    r.get('/u/:slug', handler).where('slug', '[^}]+').whereAlpha('slug')
    assert.strictEqual(r.list()[0]?.path, `/u/:slug{${ROUTE_PATTERN_ALPHA}}`)
  })

  it('route binding param extraction is unaffected by escaped `}` in the constraint', async () => {
    let resolvedWith: string | null = null
    const resolver = {
      name: 'X',
      findForRoute: (v: string) => { resolvedWith = v; return { ok: true } },
    }
    r.bind('id', resolver)
    r.get('/items/:id', handler).whereIn('id', ['ok', 'x}y'])
    const server = new FakeServer()
    r.mount(server)
    const mw = server.routes[0]!.middleware[0]!
    const req = { params: { id: 'ok' }, query: {}, headers: {}, body: undefined, url: '/items/ok' }
    await mw(req as unknown as Parameters<MiddlewareHandler>[0], {} as unknown as Parameters<MiddlewareHandler>[1], async () => {})
    assert.strictEqual(resolvedWith, 'ok', 'binding should be invoked with the :id value, not a corrupted name')
    assert.deepStrictEqual((req as unknown as { bound: Record<string, unknown> }).bound, { id: { ok: true } })
  })
})

// ─── RouteBuilder.domain() — subdomain routing ─────────────

describe('RouteBuilder.domain()', () => {
  let r: Router
  beforeEach(() => { r = new Router() })

  it('sets definition.host on a route', () => {
    r.get('/users', handler).domain('api.example.com')
    assert.strictEqual(r.list()[0]?.host, 'api.example.com')
  })

  it('accepts subdomain templates with :param segments', () => {
    r.get('/me', handler).domain(':tenant.example.com')
    assert.strictEqual(r.list()[0]?.host, ':tenant.example.com')
  })

  it('returns the builder for chaining', () => {
    const b = r.get('/users', handler).domain('api.example.com').name('users.index')
    assert.ok(b)
    assert.strictEqual(r.list()[0]?.host, 'api.example.com')
    assert.strictEqual(r.getNamedRoute('users.index'), '/users')
  })
})

// ─── Router.group() — Laravel-style grouping ───────────────

describe('Router.group()', () => {
  let r: Router
  beforeEach(() => { r = new Router() })

  it('applies prefix to every route inside the callback', () => {
    r.group({ prefix: '/admin' }, () => {
      r.get('/users', handler)
      r.get('/posts', handler)
    })
    assert.deepStrictEqual(r.list().map(rt => rt.path), ['/admin/users', '/admin/posts'])
  })

  it('applies domain to every route inside the callback', () => {
    r.group({ domain: 'api.example.com' }, () => {
      r.get('/users', handler)
      r.post('/users', handler)
    })
    assert.ok(r.list().every(rt => rt.host === 'api.example.com'))
  })

  it('prepends middleware to every route inside the callback', () => {
    r.group({ middleware: [noop] }, () => {
      r.get('/x', handler, [noop2])
    })
    assert.deepStrictEqual(r.list()[0]?.middleware, [noop, noop2])
  })

  it('routes outside the group are unaffected', () => {
    r.get('/a', handler)
    r.group({ prefix: '/admin' }, () => { r.get('/b', handler) })
    r.get('/c', handler)
    assert.deepStrictEqual(r.list().map(rt => rt.path), ['/a', '/admin/b', '/c'])
  })

  it('nested groups concatenate prefixes', () => {
    r.group({ prefix: '/api' }, () => {
      r.group({ prefix: '/v1' }, () => {
        r.get('/users', handler)
      })
    })
    assert.strictEqual(r.list()[0]?.path, '/api/v1/users')
  })

  it('nested groups stack middleware (outer first)', () => {
    r.group({ middleware: [noop] }, () => {
      r.group({ middleware: [noop2] }, () => {
        r.get('/x', handler)
      })
    })
    assert.deepStrictEqual(r.list()[0]?.middleware, [noop, noop2])
  })

  it('innermost defined domain wins over outer', () => {
    r.group({ domain: 'outer.example.com' }, () => {
      r.group({ domain: 'inner.example.com' }, () => {
        r.get('/x', handler)
      })
    })
    assert.strictEqual(r.list()[0]?.host, 'inner.example.com')
  })

  it('outer domain inherits when inner group does not define one', () => {
    r.group({ domain: 'api.example.com' }, () => {
      r.group({ prefix: '/v1' }, () => {
        r.get('/users', handler)
      })
    })
    assert.strictEqual(r.list()[0]?.host, 'api.example.com')
    assert.strictEqual(r.list()[0]?.path, '/v1/users')
  })

  it('per-route .domain() overrides the group domain', () => {
    r.group({ domain: 'api.example.com' }, () => {
      r.get('/admin', handler).domain('admin.example.com')
    })
    assert.strictEqual(r.list()[0]?.host, 'admin.example.com')
  })

  it('collapses double slashes in composed paths', () => {
    r.group({ prefix: '/api/' }, () => {
      r.get('/users', handler)
    })
    assert.strictEqual(r.list()[0]?.path, '/api/users')
  })

  it('group state is restored after callback throws', () => {
    assert.throws(() => {
      r.group({ prefix: '/admin' }, () => {
        throw new Error('boom')
      })
    }, /boom/)
    r.get('/health', handler)
    assert.strictEqual(r.list()[0]?.path, '/health')
  })

  it('reset() clears the group stack', () => {
    // Forcing a stack mid-callback: simulate state leak by pushing then resetting.
    r.group({ prefix: '/api' }, () => {
      r.reset()
    })
    r.get('/health', handler)
    assert.strictEqual(r.list()[0]?.path, '/health')
  })

  it('returns the router for chaining', () => {
    const result = r.group({ prefix: '/x' }, () => { r.get('/a', handler) })
    assert.strictEqual(result, r)
  })

  it('composes with registerController (group prefix wraps controller prefix)', () => {
    @Controller('/users')
    class C { @Get('/:id') show() {} }
    r.group({ prefix: '/api' }, () => { r.registerController(C) })
    assert.strictEqual(r.list()[0]?.path, '/api/users/:id')
  })
})

// ─── RouteBuilder.missing() — explicit binding 404 ─────────

describe('RouteBuilder.missing()', () => {
  let r: Router
  beforeEach(() => { r = new Router() })

  function makeReq(params: Record<string, string>): import('@rudderjs/contracts').AppRequest {
    return {
      method: 'GET', url: '/', path: '/',
      query: {}, params, headers: {},
      body: null, raw: null,
      input: () => undefined as never,
      string: () => '', integer: () => 0, float: () => 0,
      boolean: () => false, date: () => new Date(),
      array: () => [], has: () => false, missing: () => true, filled: () => false,
    }
  }

  function makeRes(): import('@rudderjs/contracts').AppResponse & {
    _json?: unknown; _send?: string; _status?: number
  } {
    const r: import('@rudderjs/contracts').AppResponse & {
      _json?: unknown; _send?: string; _status?: number
    } = {
      statusCode: 200,
      status(code) { (this as unknown as { _status: number })._status = code; this.statusCode = code; return this },
      header() { return this },
      json(data) { (this as unknown as { _json: unknown })._json = data },
      send(data) { (this as unknown as { _send: string })._send = data },
      redirect() {},
      raw: { res: undefined as Response | undefined },
    }
    return r
  }

  it('stores the callback on definition.missing', () => {
    const cb = () => 'ok'
    r.get('/users/:user', handler).missing(cb)
    assert.strictEqual(r.list()[0]?.missing, cb)
  })

  it('callback fires when binding resolves to null and returns plain object → res.json()', async () => {
    const { RouteModelNotFoundError } = await import('./index.js')
    const receivedErr: { value: Error | null } = { value: null }
    r.bind('user', { name: 'User', findForRoute: async () => null })
    r.get('/users/:user', handler).missing((_req, err) => {
      receivedErr.value = err
      return { error: 'not found', param: err.param }
    })

    const server = new FakeServer()
    r.mount(server)
    const mw = server.routes[0]!.middleware[0]!

    const req = makeReq({ user: '99' })
    const res = makeRes()
    let nextCalled = false
    await mw(req, res, async () => { nextCalled = true })

    assert.equal(nextCalled, false)
    assert.ok(receivedErr.value instanceof RouteModelNotFoundError)
    assert.deepStrictEqual(res._json, { error: 'not found', param: 'user' })
  })

  it('callback returning a string → res.send()', async () => {
    r.bind('user', { name: 'User', findForRoute: async () => null })
    r.get('/users/:user', handler).missing(() => 'gone')

    const server = new FakeServer()
    r.mount(server)
    const mw = server.routes[0]!.middleware[0]!

    const res = makeRes()
    await mw(makeReq({ user: '99' }), res, async () => {})
    assert.strictEqual(res._send, 'gone')
  })

  it('callback returning a Response sets res.raw.res', async () => {
    r.bind('user', { name: 'User', findForRoute: async () => null })
    const customResponse = new Response('custom body', { status: 410 })
    r.get('/users/:user', handler).missing(() => customResponse)

    const server = new FakeServer()
    r.mount(server)
    const mw = server.routes[0]!.middleware[0]!

    const res = makeRes()
    await mw(makeReq({ user: '99' }), res, async () => {})
    assert.strictEqual((res.raw as { res?: Response }).res, customResponse)
  })

  it('callback returning undefined trusts the callback wrote to res directly', async () => {
    r.bind('user', { name: 'User', findForRoute: async () => null })
    r.get('/users/:user', handler).missing((_req, _err) => {
      // no return — pretend the callback called res.json() etc itself
    })

    const server = new FakeServer()
    r.mount(server)
    const mw = server.routes[0]!.middleware[0]!

    const res = makeRes()
    let nextCalled = false
    await mw(makeReq({ user: '99' }), res, async () => { nextCalled = true })
    assert.equal(nextCalled, false)
    assert.strictEqual(res._json, undefined)
    assert.strictEqual(res._send, undefined)
  })

  it('routes without .missing() still throw RouteModelNotFoundError', async () => {
    const { RouteModelNotFoundError } = await import('./index.js')
    r.bind('user', { name: 'User', findForRoute: async () => null })
    r.get('/users/:user', handler)

    const server = new FakeServer()
    r.mount(server)
    const mw = server.routes[0]!.middleware[0]!

    await assert.rejects(
      async () => { await mw(makeReq({ user: '99' }), makeRes(), async () => {}) },
      (err: unknown) => err instanceof RouteModelNotFoundError,
    )
  })

  it('optional binding does NOT trigger .missing()', async () => {
    let called = false
    r.bind('user', { name: 'User', findForRoute: async () => null }, { optional: true })
    r.get('/users/:user', handler).missing(() => { called = true; return 'never' })

    const server = new FakeServer()
    r.mount(server)
    const mw = server.routes[0]!.middleware[0]!

    const req = makeReq({ user: '99' })
    let nextCalled = false
    await mw(req, makeRes(), async () => { nextCalled = true })
    assert.equal(called, false)
    assert.equal(nextCalled, true)
    assert.strictEqual((req as unknown as { bound: Record<string, unknown> }).bound['user'], null)
  })

  it('also fires when raw param value is empty', async () => {
    let firedWith: string | null = null
    r.bind('user', { name: 'User', findForRoute: async () => ({ id: 1 }) })
    r.get('/users/:user', handler).missing((_req, err) => {
      firedWith = err.value
      return { ok: false }
    })

    const server = new FakeServer()
    r.mount(server)
    const mw = server.routes[0]!.middleware[0]!

    await mw(makeReq({ user: '' }), makeRes(), async () => {})
    assert.strictEqual(firedWith, '')
  })
})

// ─── Url signed-URL signing + verification ──────────────────

describe('Url — signed URLs', () => {
  // Deterministic key so signatures are stable across runs.
  Url.setKey('test-signing-key')

  // server-hono populates req.url with the FULL URL (protocol + host + path
  // + query) and req.path with just the pathname. Verification must hash
  // the same pathname Url.sign() hashed — i.e. the path-only form.
  const makeReq = (urlOrPath: string): AppRequest => {
    const u = new URL(urlOrPath, 'http://placeholder.local')
    const r: Record<string, unknown> = {
      method:  'GET',
      url:     urlOrPath,
      path:    u.pathname,
      query:   Object.fromEntries(u.searchParams.entries()),
      params:  {},
      headers: {},
      body:    null,
      raw:     null,
    }
    attachInputAccessors(r)
    return r as unknown as AppRequest
  }

  it('isValidSignature accepts a request whose req.url is a full URL', () => {
    const signed = Url.sign('/invoice/42')
    const fullUrl = `http://localhost:3000${signed}`
    assert.strictEqual(Url.isValidSignature(makeReq(fullUrl)), true)
  })

  it('isValidSignature accepts a request whose req.url is a bare path', () => {
    const signed = Url.sign('/invoice/42')
    // Some adapters may pass the bare signed path as req.url instead of a full URL.
    assert.strictEqual(Url.isValidSignature(makeReq(signed)), true)
  })

  it('isValidSignature rejects a tampered pathname', () => {
    const signed = Url.sign('/invoice/42')
    const tampered = signed.replace('/invoice/42', '/invoice/43')
    assert.strictEqual(Url.isValidSignature(makeReq(`http://x${tampered}`)), false)
  })

  it('isValidSignature rejects a tampered query parameter', () => {
    const signed = Url.sign('/invoice/42?amount=10')
    const tampered = signed.replace('amount=10', 'amount=99')
    assert.strictEqual(Url.isValidSignature(makeReq(`http://x${tampered}`)), false)
  })

  it('isValidSignature rejects an expired signature', () => {
    const past = new Date(Date.now() - 60_000)
    const signed = Url.sign('/invoice/42', past)
    assert.strictEqual(Url.isValidSignature(makeReq(`http://x${signed}`)), false)
  })

  it('isValidSignature accepts a fresh temporary signature', () => {
    const future = new Date(Date.now() + 60_000)
    const signed = Url.sign('/invoice/42', future)
    assert.strictEqual(Url.isValidSignature(makeReq(`http://x${signed}`)), true)
  })

  it('isValidSignature rejects a request missing the signature param', () => {
    assert.strictEqual(Url.isValidSignature(makeReq('http://x/invoice/42')), false)
  })

  it('signedRoute round-trips through isValidSignature', () => {
    router.reset()
    router.get('/invoice/:id', handler).name('signed.invoice.show')
    router.mount(new FakeServer())

    const signed = Url.signedRoute('signed.invoice.show', { id: 42 })
    assert.match(signed, /^\/invoice\/42\?signature=/)
    assert.strictEqual(Url.isValidSignature(makeReq(`http://x${signed}`)), true)
    router.reset()
  })
})

