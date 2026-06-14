import { describe, it, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { setExceptionReporter, report } from './index.js'

// Restore a quiet reporter after each test so a captured reporter doesn't
// leak into other test files / console.
afterEach(() => {
  setExceptionReporter(() => {})
})

describe('setExceptionReporter chaining', () => {
  it('returns the previously installed reporter', () => {
    const a = (): void => {}
    // Returns *something* callable (the prior default reporter).
    const prevDefault = setExceptionReporter(a)
    assert.equal(typeof prevDefault, 'function')

    // Installing a new reporter returns exactly the one we just set.
    const returned = setExceptionReporter(() => {})
    assert.equal(returned, a)
  })

  it('lets a wrapper chain to the previous reporter without recursing', () => {
    const seen: string[] = []
    const base = (err: unknown): void => { seen.push(`base:${String(err)}`) }
    setExceptionReporter(base)

    // Capturing the return value (the prior reporter) is the only correct way
    // to chain. Capturing `report` instead would re-enter this very wrapper and
    // recurse until the stack overflows.
    const previous = setExceptionReporter((err: unknown) => {
      seen.push(`wrap:${String(err)}`)
      previous(err)
    })

    report('boom')

    assert.deepEqual(seen, ['wrap:boom', 'base:boom'])
  })
})
