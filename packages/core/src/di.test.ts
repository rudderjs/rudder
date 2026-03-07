import 'reflect-metadata'
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { Container, container, Inject, Injectable } from './di.js'

// ─── Container bindings ────────────────────────────────────

describe('Container.bind()', () => {
  it('resolves a new instance on every make() call', () => {
    const c = new Container()
    let n = 0
    c.bind('svc', () => ({ id: ++n }))
    assert.strictEqual(c.make<{ id: number }>('svc').id, 1)
    assert.strictEqual(c.make<{ id: number }>('svc').id, 2)
  })

  it('factory receives the container as argument', () => {
    const c = new Container()
    c.instance('dep', 'hello')
    c.bind('svc', container => ({ dep: container.make('dep') }))
    assert.strictEqual(c.make<{ dep: string }>('svc').dep, 'hello')
  })

  it('returns this for chaining', () => {
    const c = new Container()
    assert.strictEqual(c.bind('x', () => 1), c)
  })
})

describe('Container.singleton()', () => {
  it('returns the same instance on every make() call', () => {
    const c = new Container()
    c.singleton('svc', () => ({ id: Math.random() }))
    const a = c.make<{ id: number }>('svc')
    const b = c.make<{ id: number }>('svc')
    assert.strictEqual(a, b)
  })

  it('runs the factory only once', () => {
    const c = new Container()
    let calls = 0
    c.singleton('svc', () => { calls++; return {} })
    c.make('svc')
    c.make('svc')
    assert.strictEqual(calls, 1)
  })

  it('returns this for chaining', () => {
    const c = new Container()
    assert.strictEqual(c.singleton('x', () => 1), c)
  })
})

describe('Container.instance()', () => {
  it('always returns the exact registered value', () => {
    const c = new Container()
    const obj = { name: 'boostkit' }
    c.instance('obj', obj)
    assert.strictEqual(c.make('obj'), obj)
    assert.strictEqual(c.make('obj'), obj)
  })

  it('accepts a symbol token', () => {
    const c = new Container()
    const KEY = Symbol('key')
    c.instance(KEY, 42)
    assert.strictEqual(c.make(KEY), 42)
  })

  it('accepts a Constructor token (keyed by class name)', () => {
    class MyService {}
    const c = new Container()
    const svc = new MyService()
    c.instance(MyService, svc)
    assert.strictEqual(c.make(MyService), svc)
  })

  it('returns this for chaining', () => {
    const c = new Container()
    assert.strictEqual(c.instance('x', 1), c)
  })
})

// ─── Container.alias() ─────────────────────────────────────

describe('Container.alias()', () => {
  it('maps a string alias to a registered token', () => {
    const c = new Container()
    c.instance('real', { value: 1 })
    c.alias('shortcut', 'real')
    assert.deepStrictEqual(c.make('shortcut'), { value: 1 })
  })

  it('returns this for chaining', () => {
    const c = new Container()
    assert.strictEqual(c.alias('a', 'b'), c)
  })
})

// ─── Container.has() ───────────────────────────────────────

describe('Container.has()', () => {
  it('returns true for a bound token', () => {
    const c = new Container()
    c.bind('x', () => 1)
    assert.ok(c.has('x'))
  })

  it('returns true for an instanced token', () => {
    const c = new Container()
    c.instance('x', 1)
    assert.ok(c.has('x'))
  })

  it('returns false for an unregistered token', () => {
    const c = new Container()
    assert.ok(!c.has('unknown'))
  })

  it('resolves through aliases when checking', () => {
    const c = new Container()
    c.instance('real', 1)
    c.alias('alias', 'real')
    assert.ok(c.has('alias'))
  })
})

// ─── Container.forget() ────────────────────────────────────

describe('Container.forget()', () => {
  it('removes a binding', () => {
    const c = new Container()
    c.bind('x', () => 1)
    c.forget('x')
    assert.ok(!c.has('x'))
  })

  it('removes a singleton instance', () => {
    const c = new Container()
    c.singleton('x', () => 1)
    c.make('x')    // cache the singleton
    c.forget('x')
    assert.ok(!c.has('x'))
  })

  it('returns this for chaining', () => {
    const c = new Container()
    assert.strictEqual(c.forget('x'), c)
  })
})

// ─── Container.reset() ─────────────────────────────────────

describe('Container.reset()', () => {
  it('clears all bindings and instances', () => {
    const c = new Container()
    c.bind('a', () => 1)
    c.instance('b', 2)
    c.reset()
    assert.ok(!c.has('a'))
    assert.ok(!c.has('b'))
  })

  it('clears aliases', () => {
    const c = new Container()
    c.instance('real', 1)
    c.alias('alias', 'real')
    c.reset()
    assert.throws(() => c.make('alias'), /Cannot resolve/)
  })

  it('returns this for chaining', () => {
    const c = new Container()
    assert.strictEqual(c.reset(), c)
  })
})

// ─── Container.make() error cases ──────────────────────────

describe('Container.make() error cases', () => {
  it('throws for an unknown string token', () => {
    const c = new Container()
    assert.throws(() => c.make('nonexistent'), /Cannot resolve/)
  })

  it('throws for an unknown symbol token', () => {
    const c = new Container()
    const KEY = Symbol('missing')
    assert.throws(() => c.make(KEY), /Cannot resolve/)
  })
})

// ─── Chaining ──────────────────────────────────────────────

describe('Container fluent chaining', () => {
  it('all mutating methods return this', () => {
    const c = new Container()
    const result = c
      .instance('a', 1)
      .bind('b', () => 2)
      .singleton('c', () => 3)
      .alias('d', 'a')
      .forget('d')
      .reset()
    assert.strictEqual(result, c)
  })
})

// ─── @Injectable auto-resolution ───────────────────────────

describe('@Injectable auto-resolution', () => {
  it('auto-resolves a class with no dependencies', () => {
    @Injectable()
    class Dep {}

    const c = new Container()
    Reflect.defineMetadata('design:paramtypes', [], Dep)
    const dep = c.make(Dep)
    assert.ok(dep instanceof Dep)
  })

  it('auto-resolves a class with a typed dependency', () => {
    @Injectable()
    class Logger { readonly tag = 'logger' }

    @Injectable()
    class Service { constructor(readonly logger: Logger) {} }
    Reflect.defineMetadata('design:paramtypes', [Logger], Service)

    const c = new Container()
    const svc = c.make(Service)
    assert.ok(svc.logger instanceof Logger)
    assert.strictEqual(svc.logger.tag, 'logger')
  })

  it('auto-resolves transitive dependencies', () => {
    @Injectable()
    class A { readonly name = 'A' }

    @Injectable()
    class B { constructor(readonly a: A) {} }
    Reflect.defineMetadata('design:paramtypes', [A], B)

    @Injectable()
    class C { constructor(readonly b: B) {} }
    Reflect.defineMetadata('design:paramtypes', [B], C)

    const c = new Container()
    const inst = c.make(C)
    assert.ok(inst.b instanceof B)
    assert.ok(inst.b.a instanceof A)
    assert.strictEqual(inst.b.a.name, 'A')
  })

  it('throws when class is not decorated with @Injectable', () => {
    class NotInjectable {}
    const c = new Container()
    assert.throws(() => c.make(NotInjectable), /not decorated with @Injectable/)
  })

  it('prefers explicit binding over auto-resolution', () => {
    @Injectable()
    class MyService { readonly source = 'auto' }

    const c = new Container()
    c.instance(MyService, { source: 'manual' } as unknown as MyService)
    const svc = c.make(MyService)
    assert.strictEqual((svc as unknown as { source: string }).source, 'manual')
  })
})

// ─── @Inject token override ────────────────────────────────

describe('@Inject token override', () => {
  it('resolves the parameter by a string token', () => {
    @Injectable()
    class Consumer {
      constructor(@Inject('app.name') readonly name: string) {}
    }
    Reflect.defineMetadata('design:paramtypes', [String], Consumer)

    const c = new Container()
    c.instance('app.name', 'BoostKit')

    const inst = c.make(Consumer)
    assert.strictEqual(inst.name, 'BoostKit')
  })

  it('resolves the parameter by a symbol token', () => {
    const KEY = Symbol('myKey')

    @Injectable()
    class Consumer {
      constructor(@Inject(KEY) readonly value: number) {}
    }
    Reflect.defineMetadata('design:paramtypes', [Number], Consumer)

    const c = new Container()
    c.instance(KEY, 42)

    const inst = c.make(Consumer)
    assert.strictEqual(inst.value, 42)
  })

  it('mixes @Inject and auto-resolved parameters', () => {
    @Injectable()
    class Logger { readonly tag = 'log' }

    @Injectable()
    class Service {
      constructor(
        readonly logger: Logger,
        @Inject('name') readonly name: string,
      ) {}
    }
    Reflect.defineMetadata('design:paramtypes', [Logger, String], Service)

    const c = new Container()
    c.instance('name', 'TestApp')

    const svc = c.make(Service)
    assert.ok(svc.logger instanceof Logger)
    assert.strictEqual(svc.name, 'TestApp')
  })
})

// ─── Global container singleton ────────────────────────────

describe('global container singleton', () => {
  beforeEach(() => container.reset())

  it('container is the same instance across imports', async () => {
    const { container: container2 } = await import('./di.js')
    assert.strictEqual(container, container2)
  })

  it('bindings made on container are visible everywhere', () => {
    container.instance('shared', { ok: true })
    assert.deepStrictEqual(container.make('shared'), { ok: true })
  })
})
