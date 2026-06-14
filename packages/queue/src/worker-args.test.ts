import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { parseWorkerArgs } from './index.js'

describe('parseWorkerArgs', () => {
  it('parses the queue list and numeric flags', () => {
    const { queues, options } = parseWorkerArgs([
      'high,default', '--sleep=5', '--tries=3', '--backoff=10', '--timeout=30', '--max-jobs=100',
    ])
    assert.equal(queues, 'high,default')
    assert.equal(options.sleep, 5)
    assert.equal(options.tries, 3)
    assert.equal(options.backoff, 10)
    assert.equal(options.timeout, 30)
    assert.equal(options.maxJobs, 100)
  })

  it('parses boolean flags and defaults the queue to "default"', () => {
    const { queues, options } = parseWorkerArgs(['--once', '--stop-when-empty'])
    assert.equal(queues, 'default')
    assert.equal(options.once, true)
    assert.equal(options.stopWhenEmpty, true)
  })

  it('ignores a valueless numeric flag instead of storing NaN', () => {
    // `--tries` with no `=value` used to yield Number(undefined) === NaN, which
    // is not nullish — so the option survived every `?? default`. Downstream,
    // `attempts >= NaN` is always false (the job is released forever, never
    // dead-lettered) and `(NaN ?? 3) * 1000` makes the empty-queue poll busy-spin.
    const { options } = parseWorkerArgs(['default', '--tries', '--sleep', '--backoff'])
    assert.equal(options.tries, undefined)
    assert.equal(options.sleep, undefined)
    assert.equal(options.backoff, undefined)
  })

  it('ignores a non-numeric value for a numeric flag', () => {
    const { options } = parseWorkerArgs(['--tries=abc', '--sleep=', '--timeout=12'])
    assert.equal(options.tries, undefined)
    assert.equal(options.sleep, undefined)
    assert.equal(options.timeout, 12, 'valid flags after a bad one still parse')
  })
})
