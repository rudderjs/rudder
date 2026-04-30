import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { Seeder } from './seeder.js'

describe('Seeder', () => {
  it('subclass run() is invoked', async () => {
    const calls: string[] = []
    class MySeeder extends Seeder {
      async run(): Promise<void> {
        calls.push('ran')
      }
    }
    await new MySeeder().run()
    assert.deepEqual(calls, ['ran'])
  })

  it('call() invokes another seeder class', async () => {
    const calls: string[] = []
    class A extends Seeder {
      async run(): Promise<void> { calls.push('A') }
    }
    class B extends Seeder {
      async run(): Promise<void> {
        calls.push('B-pre')
        await this['call'](A)
        calls.push('B-post')
      }
    }
    await new B().run()
    assert.deepEqual(calls, ['B-pre', 'A', 'B-post'])
  })

  it('call() accepts an array of seeder classes', async () => {
    const calls: string[] = []
    class A extends Seeder { async run(): Promise<void> { calls.push('A') } }
    class B extends Seeder { async run(): Promise<void> { calls.push('B') } }
    class Root extends Seeder {
      async run(): Promise<void> { await this['call']([A, B]) }
    }
    await new Root().run()
    assert.deepEqual(calls, ['A', 'B'])
  })
})
