import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  DoctorRegistry,
  registerDoctorCheck,
  getRegisteredChecks,
  resetDoctorRegistry,
  type DoctorCheck,
} from './doctor.js'

describe('DoctorRegistry', () => {
  let registry: DoctorRegistry

  beforeEach(() => {
    registry = new DoctorRegistry()
  })

  it('register() stores a check and all() returns it', () => {
    const check: DoctorCheck = {
      id: 'test:one', category: 'env', title: 'one',
      run: () => ({ status: 'ok', message: 'fine' }),
    }
    registry.register(check)
    assert.deepStrictEqual(registry.all(), [check])
  })

  it('register() with duplicate id overrides + warns (last writer wins)', () => {
    const first:  DoctorCheck = { id: 'dup', category: 'env', title: 'A', run: () => ({ status: 'ok',    message: 'first'  }) }
    const second: DoctorCheck = { id: 'dup', category: 'env', title: 'B', run: () => ({ status: 'error', message: 'second' }) }
    registry.register(first)

    const warnings: string[] = []
    const originalWarn = console.warn
    console.warn = (msg: string) => warnings.push(msg)
    try {
      registry.register(second)
    } finally {
      console.warn = originalWarn
    }

    assert.strictEqual(registry.all().length, 1)
    assert.strictEqual(registry.all()[0], second)
    assert.strictEqual(warnings.length, 1)
    assert.ok(warnings[0]!.includes("'dup'"))
    assert.ok(warnings[0]!.includes('already registered'))
  })

  it('all() preserves insertion order', () => {
    registry.register({ id: 'a', category: 'env', title: 'a', run: () => ({ status: 'ok', message: '' }) })
    registry.register({ id: 'b', category: 'env', title: 'b', run: () => ({ status: 'ok', message: '' }) })
    registry.register({ id: 'c', category: 'env', title: 'c', run: () => ({ status: 'ok', message: '' }) })
    assert.deepStrictEqual(registry.all().map(c => c.id), ['a', 'b', 'c'])
  })

  it('reset() clears the registry', () => {
    registry.register({ id: 'x', category: 'env', title: 'x', run: () => ({ status: 'ok', message: '' }) })
    registry.reset()
    assert.strictEqual(registry.all().length, 0)
  })
})

describe('global doctor singleton', () => {
  beforeEach(() => resetDoctorRegistry())

  it('registerDoctorCheck + getRegisteredChecks share state across imports', async () => {
    registerDoctorCheck({
      id: 'global:test', category: 'env', title: 'global',
      run: () => ({ status: 'ok', message: 'shared' }),
    })
    // Re-import — singleton on globalThis means we get the same instance
    const { getRegisteredChecks: getChecks2 } = await import('./doctor.js')
    assert.strictEqual(getChecks2().find(c => c.id === 'global:test')?.title, 'global')
  })

  it('resetDoctorRegistry clears the global registry', () => {
    registerDoctorCheck({
      id: 'global:will-clear', category: 'env', title: 't',
      run: () => ({ status: 'ok', message: '' }),
    })
    assert.ok(getRegisteredChecks().length > 0)
    resetDoctorRegistry()
    assert.strictEqual(getRegisteredChecks().length, 0)
  })
})
