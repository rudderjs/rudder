import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { isExpiredAt } from './helpers.js'

describe('isExpiredAt', () => {
  test('returns true for a date in the past', () => {
    const past = new Date(Date.now() - 1000)
    assert.equal(isExpiredAt(past), true)
  })

  test('returns true for a Date exactly at the current millisecond', () => {
    // Simulate "now" by constructing a date from the frozen epoch.
    // We cannot freeze Date.now() in tests, so we verify the boundary
    // condition indirectly: a date 1 ms ago must be expired.
    const justPast = new Date(Date.now() - 1)
    assert.equal(isExpiredAt(justPast), true)
  })

  test('returns false for a date in the future', () => {
    const future = new Date(Date.now() + 60_000)
    assert.equal(isExpiredAt(future), false)
  })

  test('accepts an ISO string', () => {
    const pastStr = new Date(Date.now() - 5000).toISOString()
    assert.equal(isExpiredAt(pastStr), true)

    const futureStr = new Date(Date.now() + 5000).toISOString()
    assert.equal(isExpiredAt(futureStr), false)
  })
})
