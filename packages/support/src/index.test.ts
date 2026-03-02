import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { Collection, Env, defineEnv, sleep, ucfirst, tap, pick, omit } from './index.js'
import { z } from 'zod'

describe('Support contract baseline', () => {
  beforeEach(() => {
    delete process.env.FORGE_TEST_STR
    delete process.env.FORGE_TEST_BOOL
    delete process.env.FORGE_TEST_NUM
    delete process.env.FORGE_ENV_NAME
    delete process.env.FORGE_ENV_PORT
  })

  it('Collection supports map/filter/first/last/count/toArray', () => {
    const values = new Collection([1, 2, 3, 4])
      .map(n => n * 2)
      .filter(n => n > 4)

    assert.deepStrictEqual(values.toArray(), [6, 8])
    assert.strictEqual(values.first(), 6)
    assert.strictEqual(values.last(), 8)
    assert.strictEqual(values.count(), 2)
  })

  it('Env.get/getBool/getNumber use values and fallbacks', () => {
    process.env.FORGE_TEST_STR = 'forge'
    process.env.FORGE_TEST_BOOL = '1'
    process.env.FORGE_TEST_NUM = '42'

    assert.strictEqual(Env.get('FORGE_TEST_STR'), 'forge')
    assert.strictEqual(Env.get('FORGE_MISSING_STR', 'fallback'), 'fallback')
    assert.strictEqual(Env.getBool('FORGE_TEST_BOOL'), true)
    assert.strictEqual(Env.getBool('FORGE_MISSING_BOOL', false), false)
    assert.strictEqual(Env.getNumber('FORGE_TEST_NUM'), 42)
    assert.strictEqual(Env.getNumber('FORGE_MISSING_NUM', 7), 7)
  })

  it('defineEnv returns parsed env for a valid schema', () => {
    process.env.FORGE_ENV_NAME = 'app'
    process.env.FORGE_ENV_PORT = '3000'

    const parsed = defineEnv(
      z.object({
        FORGE_ENV_NAME: z.string().min(1),
        FORGE_ENV_PORT: z.coerce.number().int(),
      })
    )

    assert.strictEqual(parsed.FORGE_ENV_NAME, 'app')
    assert.strictEqual(parsed.FORGE_ENV_PORT, 3000)
  })

  it('defineEnv throws on invalid schema input', () => {
    process.env.FORGE_ENV_PORT = 'not-a-number'

    assert.throws(
      () => defineEnv(z.object({ FORGE_ENV_PORT: z.coerce.number().int() })),
      /Invalid environment configuration/
    )
  })

  it('sleep resolves after delay', async () => {
    const start = Date.now()
    await sleep(10)
    assert.ok(Date.now() - start >= 8)
  })

  it('helpers ucfirst/tap/pick/omit behave correctly', () => {
    assert.strictEqual(ucfirst('forge'), 'Forge')

    const source = { id: 1, name: 'forge', role: 'admin' }
    let seen = 0
    const tapped = tap(source, value => { seen = value.id })

    assert.strictEqual(tapped, source)
    assert.strictEqual(seen, 1)
    assert.deepStrictEqual(pick(source, ['id', 'name']), { id: 1, name: 'forge' })
    assert.deepStrictEqual(omit(source, ['role']), { id: 1, name: 'forge' })
  })
})
