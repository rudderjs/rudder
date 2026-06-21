import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { HttpException, abort, abort_if, abort_unless } from './index.js'

describe('abort()', () => {
  it('always throws HttpException with the given status code', () => {
    assert.throws(() => abort(403), (err) => {
      assert.ok(err instanceof HttpException)
      assert.equal(err.statusCode, 403)
      return true
    })
  })

  it('uses the default status text when no message is given', () => {
    assert.throws(() => abort(404), (err) => {
      assert.ok(err instanceof HttpException)
      assert.equal(err.message, 'Not Found')
      return true
    })
  })

  it('uses the custom message when provided', () => {
    assert.throws(() => abort(422, 'Custom message'), (err) => {
      assert.ok(err instanceof HttpException)
      assert.equal(err.statusCode, 422)
      assert.equal(err.message, 'Custom message')
      return true
    })
  })

  it('attaches custom headers to the thrown exception', () => {
    assert.throws(() => abort(401, 'Unauthorized', { 'WWW-Authenticate': 'Bearer' }), (err) => {
      assert.ok(err instanceof HttpException)
      assert.deepEqual(err.headers, { 'WWW-Authenticate': 'Bearer' })
      return true
    })
  })
})

describe('abort_if()', () => {
  it('throws HttpException when condition is true', () => {
    assert.throws(() => abort_if(true, 403), (err) => {
      assert.ok(err instanceof HttpException)
      assert.equal(err.statusCode, 403)
      return true
    })
  })

  it('is a no-op when condition is false', () => {
    assert.doesNotThrow(() => abort_if(false, 403))
  })

  it('propagates the custom message when condition is true', () => {
    assert.throws(() => abort_if(true, 403, 'Not allowed'), (err) => {
      assert.ok(err instanceof HttpException)
      assert.equal(err.message, 'Not allowed')
      return true
    })
  })

  it('propagates custom headers when condition is true', () => {
    assert.throws(() => abort_if(true, 429, undefined, { 'Retry-After': '60' }), (err) => {
      assert.ok(err instanceof HttpException)
      assert.deepEqual(err.headers, { 'Retry-After': '60' })
      return true
    })
  })
})

describe('abort_unless()', () => {
  it('throws HttpException when condition is false', () => {
    assert.throws(() => abort_unless(false, 403), (err) => {
      assert.ok(err instanceof HttpException)
      assert.equal(err.statusCode, 403)
      return true
    })
  })

  it('is a no-op when condition is true', () => {
    assert.doesNotThrow(() => abort_unless(true, 403))
  })

  it('propagates the custom message when condition is false', () => {
    assert.throws(() => abort_unless(false, 401, 'Must be logged in'), (err) => {
      assert.ok(err instanceof HttpException)
      assert.equal(err.message, 'Must be logged in')
      return true
    })
  })

  it('propagates custom headers when condition is false', () => {
    assert.throws(() => abort_unless(false, 401, undefined, { 'WWW-Authenticate': 'Bearer' }), (err) => {
      assert.ok(err instanceof HttpException)
      assert.deepEqual(err.headers, { 'WWW-Authenticate': 'Bearer' })
      return true
    })
  })
})
