import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { stub, resolveStatus } from './exception.js'

// ── resolveStatus ─────────────────────────────────────────────

describe('make:exception — resolveStatus', () => {
  it('defaults to 500 when --status is absent', () => {
    assert.equal(resolveStatus({}), 500)
  })

  it('accepts any 4xx/5xx status', () => {
    assert.equal(resolveStatus({ status: '402' }), 402)
    assert.equal(resolveStatus({ status: '404' }), 404)
    assert.equal(resolveStatus({ status: '503' }), 503)
  })

  it('rejects statuses outside the error range', () => {
    assert.throws(() => resolveStatus({ status: '200' }), /between 400 and 599/)
    assert.throws(() => resolveStatus({ status: '302' }), /between 400 and 599/)
    assert.throws(() => resolveStatus({ status: '600' }), /between 400 and 599/)
  })

  it('rejects non-numeric values', () => {
    assert.throws(() => resolveStatus({ status: 'teapot' }), /between 400 and 599/)
    assert.throws(() => resolveStatus({ status: '40.4' }),   /between 400 and 599/)
  })
})

// ── stub ──────────────────────────────────────────────────────

describe('make:exception — stub', () => {
  it('emits an Error subclass with the duck-typed httpStatus', () => {
    const out = stub('PaymentRequiredError', 402)
    assert.match(out, /export class PaymentRequiredError extends Error/)
    assert.match(out, /readonly httpStatus = 402/)
    assert.match(out, /this\.name = 'PaymentRequiredError'/)
  })

  it('mentions the e.render() escape hatch in the JSDoc', () => {
    const out = stub('OrderInvalidError', 500)
    assert.match(out, /e\.render\(OrderInvalidError,/)
    assert.match(out, /withExceptions/)
  })

  it('has no imports — the stub is dependency-free', () => {
    assert.doesNotMatch(stub('FooError', 500), /^import /m)
  })
})
