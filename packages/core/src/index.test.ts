import 'reflect-metadata'
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { Application, defineConfig, parseSignature, artisan } from './index.js'

function resetSingleton(): void {
  ;(Application as unknown as Record<string, unknown>)['instance'] = undefined
  ;(globalThis as Record<string, unknown>)['__forge_app__'] = undefined
}

describe('Application', () => {
  beforeEach(() => {
    resetSingleton()
  })

  it('create() returns the same instance on a second call', () => {
    const app1 = Application.create({ name: 'TestApp' })
    const app2 = Application.create({ name: 'OtherApp' })
    assert.strictEqual(app1, app2)
  })

  it('bootstrap() runs register then boot in order', async () => {
    const order: string[] = []

    class TestProvider {
      constructor(_app: Application) {}
      register() { order.push('register') }
      async boot()   { order.push('boot') }
    }

    const app = Application.create({ providers: [TestProvider as any] })
    await app.bootstrap()

    assert.deepStrictEqual(order, ['register', 'boot'])
  })

  it('isBooted() is true after bootstrap()', async () => {
    const app = Application.create()
    assert.strictEqual(app.isBooted(), false)
    await app.bootstrap()
    assert.strictEqual(app.isBooted(), true)
  })

  it('defineConfig() returns the config object unchanged', () => {
    const cfg = { server: 'hono', ui: 'react' }
    assert.deepStrictEqual(defineConfig(cfg), cfg)
  })
})

describe('Core contract baseline', () => {
  it('parseSignature() supports args, optional args, and options', () => {
    const parsed = parseSignature('users:create {name} {email?} {--admin} {--role=}')

    assert.strictEqual(parsed.name, 'users:create')
    assert.deepStrictEqual(parsed.args, [
      { name: 'name', required: true, variadic: false },
      { name: 'email', required: false, variadic: false },
    ])
    assert.deepStrictEqual(parsed.opts, [
      { name: 'admin', hasValue: false },
      { name: 'role', hasValue: true },
    ])
  })

  it('artisan registry stores commands with description metadata', () => {
    const unique = `test:contract:${Date.now()}`
    const cmd = artisan.command(unique, () => undefined).description('contract command')

    const registered = artisan.getCommands().find(c => c.name === unique)
    assert.strictEqual(registered, cmd)
    assert.strictEqual(registered?.getDescription(), 'contract command')
  })
})
