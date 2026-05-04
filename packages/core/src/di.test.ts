import 'reflect-metadata'
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { Container, ContextualBindingBuilder, container, Inject, Injectable } from './di.js'

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
    const obj = { name: 'rudderjs' }
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
    c.instance('app.name', 'RudderJS')

    const inst = c.make(Consumer)
    assert.strictEqual(inst.name, 'RudderJS')
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

// ─── Scoped bindings ──────────────────────────────────────

describe('Container.scoped()', () => {
  it('returns the same instance within one runScoped() call', () => {
    const c = new Container()
    let n = 0
    c.scoped('svc', () => ({ id: ++n }))

    c.runScoped(() => {
      const a = c.make<{ id: number }>('svc')
      const b = c.make<{ id: number }>('svc')
      assert.strictEqual(a, b)
      assert.strictEqual(a.id, 1)
    })
  })

  it('returns different instances across separate runScoped() calls', () => {
    const c = new Container()
    let n = 0
    c.scoped('svc', () => ({ id: ++n }))

    let firstId: number | undefined
    c.runScoped(() => {
      firstId = c.make<{ id: number }>('svc').id
    })

    let secondId: number | undefined
    c.runScoped(() => {
      secondId = c.make<{ id: number }>('svc').id
    })

    assert.strictEqual(firstId, 1)
    assert.strictEqual(secondId, 2)
  })

  it('throws when resolving scoped binding outside a scope', () => {
    const c = new Container()
    c.scoped('svc', () => ({}))
    assert.throws(() => c.make('svc'), /outside of a request scope/)
  })

  it('does not interfere with singletons', () => {
    const c = new Container()
    c.singleton('single', () => ({ type: 'singleton' }))
    c.scoped('scoped', () => ({ type: 'scoped' }))

    c.runScoped(() => {
      assert.strictEqual(c.make<{ type: string }>('single').type, 'singleton')
      assert.strictEqual(c.make<{ type: string }>('scoped').type, 'scoped')
    })
  })

  it('nested scopes get independent instances', () => {
    const c = new Container()
    let n = 0
    c.scoped('svc', () => ({ id: ++n }))

    c.runScoped(() => {
      const outer = c.make<{ id: number }>('svc')
      assert.strictEqual(outer.id, 1)

      c.runScoped(() => {
        const inner = c.make<{ id: number }>('svc')
        assert.strictEqual(inner.id, 2)
        assert.notStrictEqual(outer, inner)
      })

      // Outer scope still has its own instance
      assert.strictEqual(c.make<{ id: number }>('svc'), outer)
    })
  })

  it('returns this for chaining', () => {
    const c = new Container()
    assert.strictEqual(c.scoped('x', () => 1), c)
  })
})

// ─── Contextual bindings ──────────────────────────────────

describe('Container.when() — contextual binding', () => {
  it('overrides a dependency for a specific class', () => {
    @Injectable()
    class Storage { readonly type = 'default' }

    @Injectable()
    class PhotoController {
      constructor(readonly storage: Storage) {}
    }
    Reflect.defineMetadata('design:paramtypes', [Storage], PhotoController)

    @Injectable()
    class VideoController {
      constructor(readonly storage: Storage) {}
    }
    Reflect.defineMetadata('design:paramtypes', [Storage], VideoController)

    const c = new Container()
    c.when(PhotoController).needs(Storage).give(() => ({ type: 's3' }) as unknown as Storage)

    const photo = c.make(PhotoController)
    const video = c.make(VideoController)

    assert.strictEqual((photo.storage as unknown as { type: string }).type, 's3')
    assert.strictEqual(video.storage.type, 'default')
  })

  it('overrides a string token dependency', () => {
    @Injectable()
    class Consumer {
      constructor(@Inject('greeting') readonly greeting: string) {}
    }
    Reflect.defineMetadata('design:paramtypes', [String], Consumer)

    const c = new Container()
    c.instance('greeting', 'hello')
    c.when(Consumer).needs('greeting').give('hola')

    assert.strictEqual(c.make(Consumer).greeting, 'hola')
  })

  it('give() accepts a raw value (not a factory)', () => {
    @Injectable()
    class Consumer {
      constructor(@Inject('val') readonly val: number) {}
    }
    Reflect.defineMetadata('design:paramtypes', [Number], Consumer)

    const c = new Container()
    c.instance('val', 0)
    c.when(Consumer).needs('val').give(42)

    assert.strictEqual(c.make(Consumer).val, 42)
  })

  it('returns a ContextualBindingBuilder', () => {
    const c = new Container()
    @Injectable()
    class Foo {}
    assert.ok(c.when(Foo) instanceof ContextualBindingBuilder)
  })
})

// ─── Missing handler (deferred providers) ─────────────────

describe('Container.setMissingHandler()', () => {
  it('calls handler when make() cannot find a binding', () => {
    const c = new Container()
    let handledToken: string | symbol | undefined
    c.setMissingHandler((token) => {
      handledToken = token
      c.instance(token, 'resolved-by-handler')
    })

    const result = c.make<string>('lazy-token')
    assert.strictEqual(result, 'resolved-by-handler')
    assert.strictEqual(handledToken, 'lazy-token')
  })

  it('does not call handler when binding exists', () => {
    const c = new Container()
    let called = false
    c.setMissingHandler(() => { called = true })
    c.instance('exists', 42)

    assert.strictEqual(c.make<number>('exists'), 42)
    assert.ok(!called)
  })

  it('still throws if handler does not register the token', () => {
    const c = new Container()
    c.setMissingHandler(() => { /* does nothing */ })
    assert.throws(() => c.make('nope'), /Cannot resolve/)
  })

  it('returns this for chaining', () => {
    const c = new Container()
    assert.strictEqual(c.setMissingHandler(null), c)
  })
})

// ─── Container.tag() / tagged() ────────────────────────────

describe('Container.tag() / tagged()', () => {
  it('returns [] for an unknown tag (no throw)', () => {
    const c = new Container()
    assert.deepStrictEqual(c.tagged('missing'), [])
  })

  it('groups multiple tokens under one tag (insertion order)', () => {
    const c = new Container()
    c.bind('a', () => 'A').bind('b', () => 'B').bind('c', () => 'C')
    c.tag(['a', 'b', 'c'], 'group')
    assert.deepStrictEqual(c.tagged<string>('group'), ['A', 'B', 'C'])
  })

  it('supports a single-token form', () => {
    const c = new Container()
    c.bind('a', () => 'A')
    c.tag('a', 'group')
    assert.deepStrictEqual(c.tagged<string>('group'), ['A'])
  })

  it('supports a single-tag form alongside arrays', () => {
    const c = new Container()
    c.bind('a', () => 'A')
    c.tag('a', ['g1', 'g2'])
    assert.deepStrictEqual(c.tagged<string>('g1'), ['A'])
    assert.deepStrictEqual(c.tagged<string>('g2'), ['A'])
  })

  it('is additive — calling tag() twice on the same token is a no-op', () => {
    const c = new Container()
    c.bind('a', () => 'A')
    c.tag('a', 'group')
    c.tag('a', 'group')
    assert.deepStrictEqual(c.tagged<string>('group'), ['A'])
  })

  it('throws on resolve when a tagged token was never bound', () => {
    const c = new Container()
    c.tag('unbound', 'group')
    assert.throws(() => c.tagged('group'), /Cannot resolve/)
  })

  it('preserves singleton identity across tagged() calls', () => {
    const c = new Container()
    c.singleton('svc', () => ({ id: Math.random() }))
    c.tag('svc', 'group')
    const [first]  = c.tagged<{ id: number }>('group')
    const [second] = c.tagged<{ id: number }>('group')
    assert.strictEqual(first, second)
  })

  it('returns this for chaining', () => {
    const c = new Container()
    assert.strictEqual(c.tag('x', 'g'), c)
  })

  it('reset() clears tags', () => {
    const c = new Container()
    c.bind('a', () => 'A')
    c.tag('a', 'group')
    c.reset()
    assert.deepStrictEqual(c.tagged('group'), [])
  })
})

// ─── Container.bindIf / singletonIf / scopedIf ─────────────

describe('Container.bindIf()', () => {
  it('binds when the token is unbound', () => {
    const c = new Container()
    c.bindIf('svc', () => 'first')
    assert.strictEqual(c.make<string>('svc'), 'first')
  })

  it('does not overwrite an existing binding', () => {
    const c = new Container()
    c.bind('svc', () => 'first')
    c.bindIf('svc', () => 'second')
    assert.strictEqual(c.make<string>('svc'), 'first')
  })

  it('does not overwrite an existing instance', () => {
    const c = new Container()
    c.instance('svc', 'fixed')
    c.bindIf('svc', () => 'replaced')
    assert.strictEqual(c.make<string>('svc'), 'fixed')
  })

  it('returns this for chaining', () => {
    const c = new Container()
    assert.strictEqual(c.bindIf('x', () => 1), c)
  })
})

describe('Container.singletonIf()', () => {
  it('registers a singleton when unbound', () => {
    const c = new Container()
    c.singletonIf('svc', () => ({ id: 1 }))
    const a = c.make<{ id: number }>('svc')
    const b = c.make<{ id: number }>('svc')
    assert.strictEqual(a, b)
  })

  it('does not overwrite an existing singleton', () => {
    const c = new Container()
    c.singleton('svc', () => 'first')
    c.singletonIf('svc', () => 'second')
    assert.strictEqual(c.make<string>('svc'), 'first')
  })
})

describe('Container.scopedIf()', () => {
  it('registers a scoped binding when unbound', () => {
    const c = new Container()
    c.scopedIf('svc', () => 'scoped-value')
    c.runScoped(() => {
      assert.strictEqual(c.make<string>('svc'), 'scoped-value')
    })
  })

  it('does not overwrite an existing binding', () => {
    const c = new Container()
    c.bind('svc', () => 'original')
    c.scopedIf('svc', () => 'replaced')
    assert.strictEqual(c.make<string>('svc'), 'original')
  })
})
