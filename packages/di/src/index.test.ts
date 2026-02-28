import 'reflect-metadata'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { Container, Injectable, Inject } from './index.js'

describe('Container', () => {
  it('bind() returns a new instance on each call', () => {
    const c = new Container()
    c.bind('svc', () => ({ id: Math.random() }))
    const a = c.make<{ id: number }>('svc')
    const b = c.make<{ id: number }>('svc')
    assert.notStrictEqual(a, b)
  })

  it('singleton() returns the same instance on every call', () => {
    const c = new Container()
    c.singleton('svc', () => ({ id: Math.random() }))
    const a = c.make<{ id: number }>('svc')
    const b = c.make<{ id: number }>('svc')
    assert.strictEqual(a, b)
  })

  it('instance() returns the pre-created value', () => {
    const c = new Container()
    const val = { x: 42 }
    c.instance('val', val)
    assert.strictEqual(c.make('val'), val)
  })

  it('make() auto-resolves an @Injectable class', () => {
    @Injectable()
    class MyService {}

    const c = new Container()
    const inst = c.make(MyService)
    assert.ok(inst instanceof MyService)
  })

  it('make() throws for a class not decorated with @Injectable', () => {
    class NotInjectable {}
    const c = new Container()
    assert.throws(
      () => c.make(NotInjectable),
      /not decorated with @Injectable/
    )
  })

  it('@Inject(token) overrides the resolution token', () => {
    @Injectable()
    class Dep {}

    @Injectable()
    class Parent {
      constructor(@Inject('dep-token') public dep: Dep) {}
    }

    // esbuild doesn't emit design:paramtypes — set it manually (mirrors tsc emitDecoratorMetadata)
    Reflect.defineMetadata('design:paramtypes', [Dep], Parent)

    const c  = new Container()
    const dep = new Dep()
    c.instance('dep-token', dep)
    const parent = c.make(Parent)
    assert.strictEqual(parent.dep, dep)
  })

  it('has() returns true for a bound token and false otherwise', () => {
    const c = new Container()
    c.bind('x', () => 1)
    assert.strictEqual(c.has('x'), true)
    assert.strictEqual(c.has('y'), false)
  })

  it('forget() removes the binding and its cached instance', () => {
    const c = new Container()
    c.bind('x', () => 1)
    c.forget('x')
    assert.strictEqual(c.has('x'), false)
  })
})
