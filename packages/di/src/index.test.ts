import 'reflect-metadata'
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { Container, container, Inject, Injectable } from './index.js'

describe('DI contract baseline', () => {
  beforeEach(() => {
    container.reset()
  })

  it('bind() + make() resolves a transient binding', () => {
    const local = new Container()
    local.bind('service', () => ({ id: Math.random() }))

    const a = local.make<{ id: number }>('service')
    const b = local.make<{ id: number }>('service')

    assert.notStrictEqual(a, b)
  })

  it('singleton() returns the same instance', () => {
    const local = new Container()
    local.singleton('singleton', () => ({ id: Math.random() }))

    const a = local.make<{ id: number }>('singleton')
    const b = local.make<{ id: number }>('singleton')

    assert.strictEqual(a, b)
  })

  it('instance() stores and returns a concrete instance', () => {
    const service = { name: 'forge' }
    container.instance('service', service)

    assert.strictEqual(container.make('service'), service)
  })

  it('reset() clears bindings and instances', () => {
    container.bind('x', () => 1)
    container.instance('y', 2)

    container.reset()

    assert.strictEqual(container.has('x'), false)
    assert.strictEqual(container.has('y'), false)
  })

  it('Injectable auto-resolves constructor dependencies', () => {
    @Injectable()
    class Logger {
      readonly tag = 'logger'
    }

    @Injectable()
    class Service {
      constructor(readonly logger: Logger) {}
    }
    Reflect.defineMetadata('design:paramtypes', [Logger], Service)

    const local = new Container()
    const service = local.make(Service)

    assert.ok(service.logger instanceof Logger)
    assert.strictEqual(service.logger.tag, 'logger')
  })

  it('Inject token override resolves dependency by token', () => {
    @Injectable()
    class ConfigConsumer {
      constructor(@Inject('app.name') readonly name: string) {}
    }
    Reflect.defineMetadata('design:paramtypes', [String], ConfigConsumer)

    const local = new Container()
    local.instance('app.name', 'ForgeApp')

    const consumer = local.make(ConfigConsumer)
    assert.strictEqual(consumer.name, 'ForgeApp')
  })
})
