import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { ForgeRequest, ForgeResponse } from '@boostkit/contracts'
import { z, validate, validateWith, FormRequest, ValidationError } from './index.js'

function makeReq(overrides: Partial<ForgeRequest> = {}): ForgeRequest {
  return {
    method: 'POST',
    url: '/users',
    path: '/users',
    query: {},
    params: {},
    headers: {},
    body: {},
    raw: null,
    ...overrides,
  }
}

const res = {
  status() { return res as unknown as ForgeResponse },
  header() { return res as unknown as ForgeResponse },
  json() {},
  send() {},
  redirect() {},
  raw: null,
} as ForgeResponse

describe('Validation contract baseline', () => {
  it('validate() returns parsed data for valid input', async () => {
    const schema = z.object({ name: z.string(), age: z.coerce.number().int() })
    const data = await validate(schema, makeReq({ body: { name: 'Suleman', age: '21' } }))

    assert.deepStrictEqual(data, { name: 'Suleman', age: 21 })
  })

  it('validate() throws ValidationError with field errors on invalid input', async () => {
    const schema = z.object({ name: z.string().min(2), age: z.number().int() })

    await assert.rejects(
      () => validate(schema, makeReq({ body: { name: 'A', age: 'x' } })),
      (err: unknown) => {
        assert.ok(err instanceof ValidationError)
        assert.ok(Array.isArray(err.errors.name))
        assert.ok(Array.isArray(err.errors.age))
        return true
      }
    )
  })

  it('FormRequest throws when authorize() returns false', async () => {
    class LockedRequest extends FormRequest {
      rules() { return z.object({ id: z.string() }) }
      override authorize(): boolean { return false }
    }

    await assert.rejects(
      () => new LockedRequest().validate(makeReq({ body: { id: '1' } })),
      (err: unknown) => {
        assert.ok(err instanceof ValidationError)
        assert.deepStrictEqual(err.errors.auth, ['Unauthorized'])
        return true
      }
    )
  })

  it('FormRequest.validate() merges body + query + params', async () => {
    class CreateUserRequest extends FormRequest {
      rules() {
        return z.object({ id: z.string(), role: z.string(), name: z.string() })
      }
    }

    const req = makeReq({ body: { name: 'Forge' }, query: { role: 'admin' }, params: { id: '42' } })
    const data = await new CreateUserRequest().validate(req)

    assert.deepStrictEqual(data, { id: '42', role: 'admin', name: 'Forge' })
  })

  it('validateWith() calls next() when input is valid', async () => {
    const middleware = validateWith(z.object({ email: z.string().email() }))
    let nextCalled = false

    await middleware(makeReq({ body: { email: 'test@example.com' } }), res, async () => { nextCalled = true })

    assert.strictEqual(nextCalled, true)
  })

  it('validateWith() throws ValidationError on invalid input', async () => {
    const middleware = validateWith(z.object({ email: z.string().email() }))

    await assert.rejects(
      () => middleware(makeReq({ body: { email: 'bad' } }), res, async () => undefined),
      (err: unknown) => {
        assert.ok(err instanceof ValidationError)
        assert.ok(Array.isArray(err.errors.email))
        return true
      }
    )
  })
})
