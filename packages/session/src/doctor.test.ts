import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'

// Side-effect import: registers `session:secret`.
import './doctor.js'
import { getRegisteredChecks, type DoctorResult } from '@rudderjs/console'

const CHECK_ID = 'session:secret'
const ENV_KEYS = ['SESSION_SECRET', 'APP_KEY'] as const
const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k]
    delete process.env[k]
  }
})
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

function runCheck(): DoctorResult {
  const check = getRegisteredChecks().find(c => c.id === CHECK_ID)
  assert.ok(check, `expected ${CHECK_ID} to be registered`)
  return check.run() as DoctorResult
}

describe('session:secret doctor check', () => {
  it('warns when SESSION_SECRET and APP_KEY are both unset (no signing secret)', () => {
    const result = runCheck()
    assert.strictEqual(result.status, 'warn')
    assert.match(result.message, /APP_KEY is also unset/)
  })

  it('is ok when SESSION_SECRET is unset but APP_KEY provides the fallback', () => {
    process.env['APP_KEY'] = 'b'.repeat(44)
    const result = runCheck()
    assert.strictEqual(result.status, 'ok')
    assert.match(result.message, /APP_KEY/)
  })

  it('warns when SESSION_SECRET is set but shorter than 32 chars', () => {
    process.env['SESSION_SECRET'] = 'short'
    const result = runCheck()
    assert.strictEqual(result.status, 'warn')
    assert.match(result.message, /only 5 chars/)
  })

  it('is ok when SESSION_SECRET is set and long enough', () => {
    process.env['SESSION_SECRET'] = 'a'.repeat(40)
    const result = runCheck()
    assert.strictEqual(result.status, 'ok')
    assert.match(result.message, /40 chars/)
  })
})
