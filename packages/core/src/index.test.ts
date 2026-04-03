import 'reflect-metadata'
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  Application,
  AppBuilder,
  MiddlewareConfigurator,
  ExceptionConfigurator,
  ServiceProvider,
  defineConfig,
  parseSignature,
  Rudder,
  rudder,
  CancelledError,
  ValidationError,
  EventDispatcher,
  dispatcher,
  dispatch,
  events,
  app,
  resolve,
  container,
} from './index.js'

function reset(): void {
  Application.resetForTesting()
  container.reset()
  Rudder.reset()
}

// ─── Application ──────────────────────────────────────────

describe('Application', () => {
  beforeEach(reset)

  it('create() returns the same instance on a second call', () => {
    const app1 = Application.create({ name: 'TestApp', env: 'production' })
    const app2 = Application.create({ name: 'OtherApp', env: 'production' })
    assert.strictEqual(app1, app2)
  })

  it('create() recreates the instance in development when config is provided', () => {
    const app1 = Application.create({ name: 'First', env: 'local' })
    const app2 = Application.create({ name: 'Second', env: 'local' })
    assert.notStrictEqual(app1, app2)
  })

  it('getInstance() throws when no instance has been created', () => {
    assert.throws(() => Application.getInstance(), /Application has not been created yet/)
  })

  it('getInstance() returns the same instance after create()', () => {
    const created = Application.create({ env: 'production' })
    assert.strictEqual(Application.getInstance(), created)
  })

  it('name/env/debug are set from config', () => {
    const a = Application.create({ name: 'MyApp', env: 'staging', debug: true })
    assert.strictEqual(a.name, 'MyApp')
    assert.strictEqual(a.env, 'staging')
    assert.strictEqual(a.debug, true)
  })

  it('isProduction() returns true only for production env', () => {
    assert.ok(Application.create({ env: 'production' }).isProduction())
    reset()
    assert.ok(!Application.create({ env: 'local' }).isProduction())
  })

  it('isDevelopment() returns true for local and development', () => {
    assert.ok(Application.create({ env: 'local' }).isDevelopment())
    reset()
    assert.ok(Application.create({ env: 'development' }).isDevelopment())
    reset()
    assert.ok(!Application.create({ env: 'production' }).isDevelopment())
  })

  it('bootstrap() runs register then boot in order', async () => {
    const order: string[] = []

    class TestProvider extends ServiceProvider {
      register() { order.push('register') }
      async boot() { order.push('boot') }
    }

    const a = Application.create({ providers: [TestProvider], env: 'production' })
    await a.bootstrap()
    assert.deepStrictEqual(order, ['register', 'boot'])
  })

  it('bootstrap() runs all providers in registration order', async () => {
    const order: string[] = []

    class ProviderA extends ServiceProvider {
      register() { order.push('A:register') }
      async boot() { order.push('A:boot') }
    }
    class ProviderB extends ServiceProvider {
      register() { order.push('B:register') }
      async boot() { order.push('B:boot') }
    }

    const a = Application.create({ providers: [ProviderA, ProviderB], env: 'production' })
    await a.bootstrap()
    assert.deepStrictEqual(order, ['A:register', 'B:register', 'A:boot', 'B:boot'])
  })

  it('isBooted() is false before bootstrap, true after', async () => {
    const a = Application.create()
    assert.strictEqual(a.isBooted(), false)
    await a.bootstrap()
    assert.strictEqual(a.isBooted(), true)
  })

  it('wraps provider boot errors with context', async () => {
    class BrokenProvider extends ServiceProvider {
      register() {}
      async boot() { throw new Error('connection refused') }
    }
    const a = Application.create({ providers: [BrokenProvider], env: 'production' })
    await assert.rejects(
      () => a.bootstrap(),
      /Provider "BrokenProvider" failed to boot/
    )
  })

  it('bootstrap() is idempotent — second call is a no-op', async () => {
    const order: string[] = []
    class TestProvider extends ServiceProvider {
      register() { order.push('register') }
      async boot() { order.push('boot') }
    }
    const a = Application.create({ providers: [TestProvider], env: 'production' })
    await a.bootstrap()
    await a.bootstrap()
    assert.deepStrictEqual(order, ['register', 'boot'])
  })
})

// ─── Application.register() — dynamic provider registration ─

describe('Application.register()', () => {
  beforeEach(reset)

  it('calls the provider register() immediately', async () => {
    const a = Application.create({ env: 'production' })
    const calls: string[] = []

    class LateProvider extends ServiceProvider {
      register() { calls.push('register') }
    }

    await a.register(LateProvider)
    assert.deepStrictEqual(calls, ['register'])
  })

  it('calls boot() if the app is already booted', async () => {
    const calls: string[] = []

    class LateProvider extends ServiceProvider {
      register() { calls.push('register') }
      async boot() { calls.push('boot') }
    }

    const a = Application.create({ env: 'production' })
    await a.bootstrap()
    await a.register(LateProvider)
    assert.deepStrictEqual(calls, ['register', 'boot'])
  })

  it('does NOT call boot() if the app has not yet booted', async () => {
    const calls: string[] = []

    class EarlyProvider extends ServiceProvider {
      register() { calls.push('register') }
      async boot() { calls.push('boot') }
    }

    const a = Application.create({ env: 'production' })
    await a.register(EarlyProvider)
    assert.deepStrictEqual(calls, ['register'])

    // Now bootstrap — boot() should run as part of normal lifecycle
    await a.bootstrap()
    assert.deepStrictEqual(calls, ['register', 'register', 'boot'])
  })

  it('guards against duplicate class references', async () => {
    const calls: string[] = []

    class UniqueProvider extends ServiceProvider {
      register() { calls.push('register') }
    }

    const a = Application.create({ env: 'production' })
    await a.register(UniqueProvider)
    await a.register(UniqueProvider)
    assert.deepStrictEqual(calls, ['register'])
  })

  it('guards against duplicate factory providers by name', async () => {
    const calls: string[] = []

    function myFactory() {
      return class MyFactoryProvider extends ServiceProvider {
        register() { calls.push('register') }
      }
    }

    const a = Application.create({ env: 'production' })
    await a.register(myFactory()) // first call — registers
    await a.register(myFactory()) // second call — different class ref, same name → skipped
    assert.deepStrictEqual(calls, ['register'])
  })

  it('guards against providers already in the initial config', async () => {
    const calls: string[] = []

    class InitialProvider extends ServiceProvider {
      register() { calls.push('register') }
    }

    const a = Application.create({ providers: [InitialProvider], env: 'production' })
    await a.register(InitialProvider) // already in config → skipped
    assert.deepStrictEqual(calls, [])
  })

  it('wraps boot errors with context', async () => {
    class FailProvider extends ServiceProvider {
      register() {}
      async boot() { throw new Error('db down') }
    }

    const a = Application.create({ env: 'production' })
    await a.bootstrap()
    await assert.rejects(
      () => a.register(FailProvider),
      /Provider "FailProvider" failed to boot/,
    )
  })

  it('returns the app instance for chaining', async () => {
    class ChainProvider extends ServiceProvider {
      register() {}
    }

    const a = Application.create({ env: 'production' })
    const result = await a.register(ChainProvider)
    assert.strictEqual(result, a)
  })

  it('a provider can register another provider from its own boot()', async () => {
    const calls: string[] = []

    class ChildProvider extends ServiceProvider {
      register() { calls.push('child:register') }
      async boot() { calls.push('child:boot') }
    }

    class ParentProvider extends ServiceProvider {
      register() { calls.push('parent:register') }
      async boot() {
        calls.push('parent:boot')
        await this.app.register(ChildProvider)
      }
    }

    const a = Application.create({ providers: [ParentProvider], env: 'production' })
    await a.bootstrap()
    assert.deepStrictEqual(calls, [
      'parent:register',
      'parent:boot',
      'child:register',
      'child:boot',
    ])
  })

  it('bindings from register() are immediately available', async () => {
    class BindingProvider extends ServiceProvider {
      register() { this.app.instance('dynamic-key', 'dynamic-value') }
    }

    const a = Application.create({ env: 'production' })
    await a.register(BindingProvider)
    assert.strictEqual(a.make('dynamic-key'), 'dynamic-value')
  })
})

// ─── Container proxy methods ──────────────────────────────

describe('Application container proxies', () => {
  beforeEach(reset)

  it('instance() binds a value and make() returns it', () => {
    const a = Application.create({ env: 'production' })
    a.instance('myKey', { value: 42 })
    assert.deepStrictEqual(a.make('myKey'), { value: 42 })
  })

  it('bind() registers a factory resolved fresh each call', () => {
    const a = Application.create({ env: 'production' })
    let count = 0
    a.bind('counter', () => ++count)
    assert.strictEqual(a.make('counter'), 1)
    assert.strictEqual(a.make('counter'), 2)
  })

  it('singleton() resolves factory only once', () => {
    const a = Application.create({ env: 'production' })
    let count = 0
    a.singleton('once', () => ++count)
    assert.strictEqual(a.make('once'), 1)
    assert.strictEqual(a.make('once'), 1)
  })

  it('instance/bind/singleton return this for chaining', () => {
    const a = Application.create({ env: 'production' })
    const result = a.instance('x', 1).bind('y', () => 2).singleton('z', () => 3)
    assert.strictEqual(result, a)
  })
})

// ─── Global helpers ───────────────────────────────────────

describe('app() and resolve() helpers', () => {
  beforeEach(reset)

  it('app() throws when no instance exists', () => {
    assert.throws(() => app(), /Application has not been created yet/)
  })

  it('app() returns the Application instance after create()', () => {
    const a = Application.create({ env: 'production' })
    assert.strictEqual(app(), a)
  })

  it('resolve() retrieves a binding from the container', () => {
    const a = Application.create({ env: 'production' })
    a.instance('greeting', 'hello')
    assert.strictEqual(resolve('greeting'), 'hello')
  })
})

// ─── Config binding ───────────────────────────────────────

describe('Application config binding', () => {
  beforeEach(reset)

  it('binds ConfigRepository as "config" when config is provided', () => {
    const a = Application.create({ config: { app: { name: 'Test' } }, env: 'production' })
    const repo = a.make<{ get(key: string): unknown }>('config')
    assert.strictEqual(repo.get('app.name'), 'Test')
  })

  it('config helper resolves nested keys', async () => {
    const { config } = await import('./index.js')
    Application.create({ config: { app: { env: 'test' } }, env: 'production' })
    assert.strictEqual(config('app.env'), 'test')
  })
})

// ─── MiddlewareConfigurator ───────────────────────────────

describe('MiddlewareConfigurator', () => {
  it('use() adds handlers and getHandlers() returns them in order', () => {
    const m = new MiddlewareConfigurator()
    const h1 = async () => {}
    const h2 = async () => {}
    m.use(h1).use(h2)
    assert.deepStrictEqual(m.getHandlers(), [h1, h2])
  })

  it('starts with an empty handler list', () => {
    assert.strictEqual(new MiddlewareConfigurator().getHandlers().length, 0)
  })
})

// ─── AppBuilder ───────────────────────────────────────────

describe('AppBuilder', () => {
  beforeEach(reset)

  it('Application.configure() returns an AppBuilder', () => {
    const builder = Application.configure({
      server: {} as never,
    })
    assert.ok(builder instanceof AppBuilder)
  })

  it('withRouting() returns the builder for chaining', () => {
    const builder = Application.configure({ server: {} as never })
    assert.strictEqual(builder.withRouting({}), builder)
  })

  it('withRouting() accepts channels loader', () => {
    const loader  = async () => ({})
    const builder = Application.configure({ server: {} as never })
    assert.strictEqual(builder.withRouting({ channels: loader }), builder)
  })

  it('withMiddleware() returns the builder for chaining', () => {
    const builder = Application.configure({ server: {} as never })
    assert.strictEqual(builder.withMiddleware(() => {}), builder)
  })

  it('withExceptions() returns the builder for chaining', () => {
    const builder = Application.configure({ server: {} as never })
    assert.strictEqual(builder.withExceptions(() => {}), builder)
  })
})

// ─── ExceptionConfigurator ────────────────────────────────

describe('ExceptionConfigurator', () => {
  function makeReq() {
    return {} as Parameters<ReturnType<ExceptionConfigurator['buildHandler']>>[1]
  }

  it('buildHandler() auto-handles ValidationError → 422 JSON', async () => {
    const exc = new ExceptionConfigurator()
    const handler = exc.buildHandler()
    const err = new ValidationError({ email: ['Invalid email'] })
    const res = await handler(err, makeReq())
    assert.strictEqual(res.status, 422)
    const body = await res.json() as { message: string; errors: Record<string, string[]> }
    assert.strictEqual(body.message, 'Validation failed')
    assert.deepStrictEqual(body.errors, { email: ['Invalid email'] })
  })

  it('buildHandler() calls user render() for matching error type', async () => {
    class PaymentError extends Error { code = 402 }
    const exc = new ExceptionConfigurator()
    exc.render(PaymentError, (err) =>
      new Response(JSON.stringify({ code: err.code }), { status: 402 })
    )
    const handler = exc.buildHandler()
    const res = await handler(new PaymentError('failed'), makeReq())
    assert.strictEqual(res.status, 402)
    const body = await res.json() as { code: number }
    assert.strictEqual(body.code, 402)
  })

  it('buildHandler() re-throws unhandled errors', async () => {
    const exc = new ExceptionConfigurator()
    const handler = exc.buildHandler()
    const err = new Error('unhandled')
    await assert.rejects(async () => handler(err, makeReq()), /unhandled/)
  })

  it('buildHandler() re-throws ignored error types', async () => {
    class IgnoredError extends Error {}
    const exc = new ExceptionConfigurator()
    exc.ignore(IgnoredError)
    const handler = exc.buildHandler()
    await assert.rejects(async () => handler(new IgnoredError('go away'), makeReq()), /go away/)
  })

  it('render() takes precedence over the default 422 for ValidationError subclass', async () => {
    class StrictValidationError extends ValidationError {}
    const exc = new ExceptionConfigurator()
     
    exc.render(StrictValidationError as any, () =>
      new Response(JSON.stringify({ message: 'custom' }), { status: 400 })
    )
    const handler = exc.buildHandler()
    const res = await handler(new StrictValidationError({ x: ['bad'] }), makeReq())
    assert.strictEqual(res.status, 400)
  })

  it('render() returns this for chaining', () => {
    const exc = new ExceptionConfigurator()
     
    assert.strictEqual(exc.render(Error as any, () => new Response(null, { status: 500 })), exc)
  })

  it('ignore() returns this for chaining', () => {
    const exc = new ExceptionConfigurator()
     
    assert.strictEqual(exc.ignore(Error as any), exc)
  })
})

// ─── EventDispatcher ──────────────────────────────────────

describe('EventDispatcher', () => {
  let d: EventDispatcher

  beforeEach(() => { d = new EventDispatcher() })

  class UserCreated { constructor(public readonly id: number) {} }
  class OrderPlaced { constructor(public readonly total: number) {} }

  it('dispatches an event to a registered listener', async () => {
    const received: number[] = []
    d.register('UserCreated', { handle: (e) => { received.push((e as UserCreated).id) } })
    await d.dispatch(new UserCreated(42))
    assert.deepStrictEqual(received, [42])
  })

  it('dispatches to multiple listeners in registration order', async () => {
    const order: string[] = []
    d.register('UserCreated',
      { handle: () => { order.push('first') } },
      { handle: () => { order.push('second') } },
    )
    await d.dispatch(new UserCreated(1))
    assert.deepStrictEqual(order, ['first', 'second'])
  })

  it('dispatches to multiple listeners added in separate register() calls', async () => {
    const order: string[] = []
    d.register('UserCreated', { handle: () => { order.push('a') } })
    d.register('UserCreated', { handle: () => { order.push('b') } })
    await d.dispatch(new UserCreated(1))
    assert.deepStrictEqual(order, ['a', 'b'])
  })

  it('does not dispatch to listeners of a different event', async () => {
    const received: number[] = []
    d.register('OrderPlaced', { handle: (e) => { received.push((e as OrderPlaced).total) } })
    await d.dispatch(new UserCreated(99))
    assert.deepStrictEqual(received, [])
  })

  it('wildcard listener receives every dispatched event', async () => {
    const names: string[] = []
    d.register('*', { handle: (e) => { names.push((e as object).constructor.name) } })
    await d.dispatch(new UserCreated(1))
    await d.dispatch(new OrderPlaced(100))
    assert.deepStrictEqual(names, ['UserCreated', 'OrderPlaced'])
  })

  it('wildcard listeners run after specific listeners', async () => {
    const order: string[] = []
    d.register('UserCreated', { handle: () => { order.push('specific') } })
    d.register('*',           { handle: () => { order.push('wildcard') } })
    await d.dispatch(new UserCreated(1))
    assert.deepStrictEqual(order, ['specific', 'wildcard'])
  })

  it('awaits async listeners in order', async () => {
    const order: string[] = []
    d.register('UserCreated',
      { handle: async () => { await Promise.resolve(); order.push('first') } },
      { handle: async () => { await Promise.resolve(); order.push('second') } },
    )
    await d.dispatch(new UserCreated(1))
    assert.deepStrictEqual(order, ['first', 'second'])
  })

  it('count() returns number of listeners for an event', () => {
    d.register('UserCreated', { handle: () => {} }, { handle: () => {} })
    assert.strictEqual(d.count('UserCreated'), 2)
    assert.strictEqual(d.count('OrderPlaced'), 0)
  })

  it('hasListeners() returns true/false correctly', () => {
    d.register('UserCreated', { handle: () => {} })
    assert.strictEqual(d.hasListeners('UserCreated'), true)
    assert.strictEqual(d.hasListeners('OrderPlaced'), false)
  })

  it('list() returns a snapshot of all event names and counts', () => {
    d.register('UserCreated', { handle: () => {} }, { handle: () => {} })
    d.register('OrderPlaced', { handle: () => {} })
    const snap = d.list()
    assert.strictEqual(snap['UserCreated'], 2)
    assert.strictEqual(snap['OrderPlaced'], 1)
  })

  it('list() returns an empty object when no listeners are registered', () => {
    assert.deepStrictEqual(d.list(), {})
  })

  it('reset() clears all listeners', async () => {
    const received: number[] = []
    d.register('UserCreated', { handle: (e) => { received.push((e as UserCreated).id) } })
    d.reset()
    await d.dispatch(new UserCreated(1))
    assert.deepStrictEqual(received, [])
    assert.deepStrictEqual(d.list(), {})
  })

  it('a listener error propagates and stops subsequent listeners', async () => {
    const order: string[] = []
    d.register('UserCreated',
      { handle: () => { throw new Error('boom') } },
      { handle: () => { order.push('should not run') } },
    )
    await assert.rejects(() => d.dispatch(new UserCreated(1)), /boom/)
    assert.deepStrictEqual(order, [])
  })
})

// ─── Global dispatcher + dispatch() ───────────────────────

describe('global dispatcher and dispatch()', () => {
  beforeEach(() => dispatcher.reset())

  class PingEvent { readonly name = 'ping' }

  it('dispatch() uses the global dispatcher singleton', async () => {
    const received: string[] = []
    dispatcher.register('PingEvent', { handle: (e) => { received.push((e as PingEvent).name) } })
    await dispatch(new PingEvent())
    assert.deepStrictEqual(received, ['ping'])
  })

  it('global dispatcher is the same object as dispatcher export', () => {
    assert.ok(dispatcher instanceof EventDispatcher)
  })
})

// ─── events() provider ────────────────────────────────────

describe('events() provider', () => {
  beforeEach(() => dispatcher.reset())

  class ItemSaved { constructor(public id: number) {} }

  it('boot() registers listeners from the ListenMap', () => {
    class ItemSavedListener { handle(_e: unknown) {} }
    const Provider = events({ ItemSaved: [ItemSavedListener as never] })
    new Provider({} as never).boot?.()
    assert.strictEqual(dispatcher.count('ItemSaved'), 1)
  })

  it('boot() dispatches to registered listeners', async () => {
    const calls: number[] = []
    class ItemSavedListener { handle(e: unknown) { calls.push((e as ItemSaved).id) } }
    const Provider = events({ ItemSaved: [ItemSavedListener as never] })
    new Provider({} as never).boot?.()
    await dispatch(new ItemSaved(7))
    assert.deepStrictEqual(calls, [7])
  })

  it('boot() supports multiple event types', () => {
    class AListener { handle(_: unknown) {} }
    class BListener { handle(_: unknown) {} }
    const Provider = events({ EventA: [AListener as never], EventB: [BListener as never] })
    new Provider({} as never).boot?.()
    assert.strictEqual(dispatcher.count('EventA'), 1)
    assert.strictEqual(dispatcher.count('EventB'), 1)
  })

  it('boot() supports multiple listeners per event', () => {
    class L1 { handle(_: unknown) {} }
    class L2 { handle(_: unknown) {} }
    const Provider = events({ ItemSaved: [L1 as never, L2 as never] })
    new Provider({} as never).boot?.()
    assert.strictEqual(dispatcher.count('ItemSaved'), 2)
  })

  it('register() is a no-op (events has no bindings)', () => {
    const Provider = events({})
    assert.doesNotThrow(() => new Provider({} as never).register?.())
  })
})

// ─── defineConfig ─────────────────────────────────────────

describe('defineConfig()', () => {
  it('returns the config object unchanged', () => {
    const cfg = { server: 'hono', ui: 'react' }
    assert.deepStrictEqual(defineConfig(cfg), cfg)
  })

  it('preserves object identity', () => {
    const cfg = { a: 1 }
    assert.strictEqual(defineConfig(cfg), cfg)
  })
})

// ─── Core contract baseline ───────────────────────────────

describe('Core contract baseline', () => {
  beforeEach(() => Rudder.reset())

  it('parseSignature() supports args, optional args, and options', () => {
    const parsed = parseSignature('users:create {name} {email?} {--admin} {--role=}')

    assert.strictEqual(parsed.name, 'users:create')
    assert.deepStrictEqual(parsed.args, [
      { name: 'name',  required: true,  variadic: false },
      { name: 'email', required: false, variadic: false },
    ])
    assert.deepStrictEqual(parsed.opts, [
      { name: 'admin', hasValue: false },
      { name: 'role',  hasValue: true  },
    ])
  })

  it('Rudder registry stores commands with description metadata', () => {
    const unique = `test:contract:${Date.now()}`
    const cmd = rudder.command(unique, () => undefined).description('contract command')

    const registered = Rudder.getCommands().find(c => c.name === unique)
    assert.strictEqual(registered, cmd)
    assert.strictEqual(registered?.getDescription(), 'contract command')
  })

  it('Rudder.reset() clears registered commands', () => {
    Rudder.command(`test:reset:${Date.now()}`, () => undefined)
    assert.ok(Rudder.getCommands().length > 0)
    Rudder.reset()
    assert.strictEqual(Rudder.getCommands().length, 0)
  })

  it('CancelledError is re-exported from core', () => {
    const err = new CancelledError()
    assert.ok(err instanceof Error)
    assert.strictEqual(err.name, 'CancelledError')
  })
})
