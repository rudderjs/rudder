import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { ForgeRequest, ForgeResponse } from '@forge/server'
import { z, ValidationError, FormRequest, validate, validateWith } from './index.js'

function makeReq(overrides: Partial<ForgeRequest> = {}): ForgeRequest {
  return {
    method: 'POST',
    url: 'http://localhost/api/users',
    path: '/api/users',
    query: {},
    params: {},
    headers: {},
    body: {},
    raw: {},
    ...overrides,
  }
}

function makeRes(): ForgeResponse {
  return {
    status: () => makeRes(),
    header: () => makeRes(),
    json: () => undefined,
    send: () => undefined,
    redirect: () => undefined,
    raw: {},
  }
}

describe('Validation contract baseline', () => {
  it('validate() parses merged body/query/params input', async () => {
    const schema = z.object({ id: z.string(), name: z.string() })
    const req = makeReq({ body: { name: 'Forge' }, params: { id: 'u_1' } })

    const out = await validate(schema, req)
    assert.deepStrictEqual(out, { id: 'u_1', name: 'Forge' })
  })

  it('validate() throws ValidationError with grouped field errors', async () => {
    const schema = z.object({ name: z.string().min(2) })
    const req = makeReq({ body: { name: '' } })

    await assert.rejects(
      () => validate(schema, req),
      (err: unknown) => {
        assert.ok(err instanceof ValidationError)
        const errors = (err as ValidationError).errors
        assert.ok(Array.isArray(errors.name))
        assert.ok((errors.name?.length ?? 0) > 0)
        return true
      }
    )
  })

  it('FormRequest validate() respects authorize()', async () => {
    class CreateUserRequest extends FormRequest<z.ZodObject<{ name: z.ZodString }>> {
      authorize(): boolean {
        return false
      }
      rules() {
        return z.object({ name: z.string() })
      }
    }

    const req = makeReq({ body: { name: 'Forge' } })
    await assert.rejects(
      () => new CreateUserRequest().validate(req),
      (err: unknown) => {
        assert.ok(err instanceof ValidationError)
        assert.deepStrictEqual((err as ValidationError).errors, { auth: ['Unauthorized'] })
        return true
      }
    )
  })

  it('validateWith() calls next() when payload is valid', async () => {
    const req = makeReq({ body: { name: 'Forge' } })
    const res = makeRes()
    const middleware = validateWith(z.object({ name: z.string().min(2) }))

    let called = false
    await middleware(req, res, async () => {
      called = true
    })

    assert.strictEqual(called, true)
  })
})
