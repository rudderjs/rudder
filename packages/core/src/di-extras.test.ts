import 'reflect-metadata'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { Container, Inject, Injectable, Tag, tagToken } from './di.js'

// ─── Container.extend() ────────────────────────────────────

describe('Container.extend()', () => {
  it('wraps the value returned by a singleton', () => {
    const c = new Container()
    c.singleton('svc', () => ({ name: 'base' }))
    c.extend<{ name: string }>('svc', v => ({ ...v, name: v.name + '-wrapped' }))
    assert.deepStrictEqual(c.make('svc'), { name: 'base-wrapped' })
  })

  it('chains multiple extenders in registration order', () => {
    const c = new Container()
    c.bind('svc', () => 'a')
    c.extend<string>('svc', v => v + 'b')
    c.extend<string>('svc', v => v + 'c')
    assert.strictEqual(c.make<string>('svc'), 'abc')
  })

  it('runs extenders only once per singleton (cached wrapped value)', () => {
    const c = new Container()
    let factoryCalls = 0
    let extenderCalls = 0
    c.singleton('svc', () => { factoryCalls++; return { v: 1 } })
    c.extend<{ v: number }>('svc', v => { extenderCalls++; return { v: v.v + 1 } })
    const a = c.make<{ v: number }>('svc')
    const b = c.make<{ v: number }>('svc')
    assert.strictEqual(a, b)
    assert.strictEqual(a.v, 2)
    assert.strictEqual(factoryCalls, 1)
    assert.strictEqual(extenderCalls, 1)
  })

  it('re-wraps a previously cached singleton when extend() is called late', () => {
    const c = new Container()
    c.singleton('svc', () => ({ v: 1 }))
    const before = c.make<{ v: number }>('svc')
    c.extend<{ v: number }>('svc', v => ({ v: v.v + 10 }))
    const after = c.make<{ v: number }>('svc')
    assert.strictEqual(before.v, 1)
    assert.strictEqual(after.v, 11)
    assert.strictEqual(c.make('svc'), after)
  })

  it('applies to instance()-bound values (caches the wrap)', () => {
    const c = new Container()
    c.instance('svc', { v: 1 })
    c.extend<{ v: number }>('svc', v => ({ v: v.v + 5 }))
    const first  = c.make<{ v: number }>('svc')
    const second = c.make<{ v: number }>('svc')
    assert.strictEqual(first.v, 6)
    assert.strictEqual(first, second)
  })

  it('runs each scope independently for scoped bindings', () => {
    const c = new Container()
    c.scoped('svc', () => ({ id: 1 }))
    let extendCalls = 0
    c.extend<{ id: number; ext: number }>('svc', v => { extendCalls++; return { ...v, ext: extendCalls } })
    c.runScoped(() => {
      const a = c.make<{ id: number; ext: number }>('svc')
      const b = c.make<{ id: number; ext: number }>('svc')
      assert.strictEqual(a, b)
      assert.strictEqual(a.ext, 1)
    })
    c.runScoped(() => {
      const a = c.make<{ id: number; ext: number }>('svc')
      assert.strictEqual(a.ext, 2)
    })
    assert.strictEqual(extendCalls, 2)
  })

  it('applies to autoResolved injectable classes', () => {
    @Injectable()
    class MyService { source = 'auto' }
    Reflect.defineMetadata('design:paramtypes', [], MyService)

    const c = new Container()
    c.extend<MyService>(MyService, v => { v.source = 'wrapped'; return v })
    const inst = c.make(MyService)
    assert.strictEqual(inst.source, 'wrapped')
  })

  it('returns this for chaining', () => {
    const c = new Container()
    c.bind('x', () => 1)
    assert.strictEqual(c.extend<number>('x', v => v), c)
  })

  it('reset() clears extenders', () => {
    const c = new Container()
    c.bind('svc', () => 'a')
    c.extend<string>('svc', v => v + 'b')
    c.reset()
    c.bind('svc', () => 'a')
    assert.strictEqual(c.make<string>('svc'), 'a')
  })
})

// ─── Container.rebinding() ─────────────────────────────────

describe('Container.rebinding()', () => {
  it('does NOT fire on the initial bind', () => {
    const c = new Container()
    let calls = 0
    c.rebinding('svc', () => { calls++ })
    c.bind('svc', () => 'x')
    assert.strictEqual(calls, 0)
  })

  it('fires on a re-bind with the newly resolved instance', () => {
    const c = new Container()
    c.bind('svc', () => 'first')
    let received: unknown
    c.rebinding<string>('svc', v => { received = v })
    c.bind('svc', () => 'second')
    assert.strictEqual(received, 'second')
  })

  it('fires when instance() replaces a bind()', () => {
    const c = new Container()
    c.bind('svc', () => 'first')
    let received: unknown
    c.rebinding<string>('svc', v => { received = v })
    c.instance('svc', 'replaced')
    assert.strictEqual(received, 'replaced')
  })

  it('fires when a singleton already resolved is rebound', () => {
    const c = new Container()
    c.singleton('mailer', () => ({ kind: 'ses' }))
    const original = c.make<{ kind: string }>('mailer')
    let received: { kind: string } | undefined
    c.rebinding<{ kind: string }>('mailer', v => { received = v })
    c.instance('mailer', { kind: 'fake' })
    assert.notStrictEqual(received, original)
    assert.strictEqual(received?.kind, 'fake')
    assert.strictEqual(c.make<{ kind: string }>('mailer').kind, 'fake')
  })

  it('fires multiple listeners in registration order', () => {
    const c = new Container()
    c.bind('svc', () => 'a')
    const order: string[] = []
    c.rebinding('svc', () => { order.push('one') })
    c.rebinding('svc', () => { order.push('two') })
    c.bind('svc', () => 'b')
    assert.deepStrictEqual(order, ['one', 'two'])
  })

  it('listener receives the container as second arg', () => {
    const c = new Container()
    c.bind('svc', () => 'a')
    let received: Container | undefined
    c.rebinding('svc', (_v, ctr) => { received = ctr })
    c.bind('svc', () => 'b')
    assert.strictEqual(received, c)
  })

  it('returns this for chaining', () => {
    const c = new Container()
    assert.strictEqual(c.rebinding('x', () => {}), c)
  })

  it('reset() clears rebinding listeners', () => {
    const c = new Container()
    c.bind('svc', () => 'a')
    let calls = 0
    c.rebinding('svc', () => { calls++ })
    c.reset()
    c.bind('svc', () => 'a')
    c.bind('svc', () => 'b')
    assert.strictEqual(calls, 0)
  })
})

// ─── @Tag decorator + tagToken() ───────────────────────────

describe('@Tag decorator + tagToken()', () => {
  it('injects a tagged array into a constructor parameter', () => {
    @Injectable()
    class Reporter {
      constructor(@Tag('exporters') readonly exporters: string[]) {}
    }
    Reflect.defineMetadata('design:paramtypes', [Array], Reporter)

    const c = new Container()
    c.bind('csv', () => 'csv').bind('xlsx', () => 'xlsx')
    c.tag(['csv', 'xlsx'], 'exporters')

    const r = c.make(Reporter)
    assert.deepStrictEqual(r.exporters, ['csv', 'xlsx'])
  })

  it('mixes @Tag and @Inject params on the same class', () => {
    @Injectable()
    class Service {
      constructor(
        @Tag('plugins') readonly plugins: string[],
        @Inject('name')  readonly name: string,
      ) {}
    }
    Reflect.defineMetadata('design:paramtypes', [Array, String], Service)

    const c = new Container()
    c.instance('name', 'test')
    c.bind('p1', () => 'p1').tag('p1', 'plugins')

    const inst = c.make(Service)
    assert.deepStrictEqual(inst.plugins, ['p1'])
    assert.strictEqual(inst.name, 'test')
  })

  it('@Tag wins over @Inject when both decorate the same parameter', () => {
    @Injectable()
    class Weird {
      constructor(@Tag('items') @Inject('items') readonly items: unknown[]) {}
    }
    Reflect.defineMetadata('design:paramtypes', [Array], Weird)

    const c = new Container()
    c.instance('items', 'singleValue')
    c.bind('a', () => 'A').tag('a', 'items')

    const inst = c.make(Weird)
    assert.deepStrictEqual(inst.items, ['A'])
  })

  it('tagToken() integrates with contextual bindings', () => {
    @Injectable()
    class Reporter {
      constructor(@Inject(tagToken('exporters')) readonly exporters: string[]) {}
    }
    Reflect.defineMetadata('design:paramtypes', [Array], Reporter)

    const c = new Container()
    c.bind('csv', () => 'csv').tag('csv', 'exporters')
    c.when(Reporter).needs(tagToken('exporters')).give((ctr: Container) => ctr.tagged<string>('exporters'))

    const r = c.make(Reporter)
    assert.deepStrictEqual(r.exporters, ['csv'])
  })

  it('tagToken() returns a stable Symbol.for value', () => {
    assert.strictEqual(tagToken('group'), tagToken('group'))
  })
})
