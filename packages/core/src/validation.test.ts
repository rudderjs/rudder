import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { AppRequest, AppResponse } from '@rudderjs/contracts'
import { attachInputAccessors } from '@rudderjs/contracts'
import { z, validate, validateWith, FormRequest, ValidationError } from './validation.js'

// ─── Test helpers ──────────────────────────────────────────

function makeReq(overrides: Partial<AppRequest> = {}): AppRequest {
  const req: Record<string, unknown> = {
    method:  'POST',
    url:     '/test',
    path:    '/test',
    query:   {},
    params:  {},
    headers: {},
    body:    {},
    raw:     null,
    ...overrides,
  }
  attachInputAccessors(req)
  return req as unknown as AppRequest
}

const res: AppResponse = {
  status()   { return res },
  header()   { return res },
  json()     {},
  send()     {},
  redirect() {},
  raw:       null,
}

// ─── ValidationError ───────────────────────────────────────

describe('ValidationError', () => {
  it('is an instance of Error', () => {
    const err = new ValidationError({ name: ['Required'] })
    assert.ok(err instanceof Error)
  })

  it('has name "ValidationError"', () => {
    assert.strictEqual(new ValidationError({}).name, 'ValidationError')
  })

  it('has message "Validation failed"', () => {
    assert.strictEqual(new ValidationError({}).message, 'Validation failed')
  })

  it('exposes errors as Record<string, string[]>', () => {
    const err = new ValidationError({ email: ['Invalid email'], name: ['Too short'] })
    assert.deepStrictEqual(err.errors, { email: ['Invalid email'], name: ['Too short'] })
  })

  it('toJSON() returns message + errors', () => {
    const err = new ValidationError({ field: ['bad'] })
    assert.deepStrictEqual(err.toJSON(), {
      message: 'Validation failed',
      errors:  { field: ['bad'] },
    })
  })
})

// ─── validate() ────────────────────────────────────────────

describe('validate()', () => {
  it('returns parsed and coerced data for valid input', async () => {
    const schema = z.object({ name: z.string(), age: z.coerce.number().int() })
    const data = await validate(schema, makeReq({ body: { name: 'Alice', age: '30' } }))
    assert.deepStrictEqual(data, { name: 'Alice', age: 30 })
  })

  it('merges body + query + params before validation', async () => {
    const schema = z.object({ id: z.string(), role: z.string(), name: z.string() })
    const data = await validate(schema, makeReq({
      body:   { name: 'Alice' },
      query:  { role: 'admin' },
      params: { id: '42' },
    }))
    assert.deepStrictEqual(data, { id: '42', role: 'admin', name: 'Alice' })
  })

  it('params take precedence over query and body for the same key', async () => {
    const schema = z.object({ name: z.string() })
    const data = await validate(schema, makeReq({
      body:   { name: 'from-body' },
      query:  { name: 'from-query' },
      params: { name: 'from-params' },
    }))
    assert.strictEqual(data.name, 'from-params')
  })

  it('handles null body gracefully', async () => {
    const schema = z.object({ role: z.string() })
    const data = await validate(schema, makeReq({ body: null, query: { role: 'user' } }))
    assert.strictEqual(data.role, 'user')
  })

  it('throws ValidationError with field-keyed errors on invalid input', async () => {
    const schema = z.object({ name: z.string().min(2), age: z.number().int() })
    await assert.rejects(
      async () => validate(schema, makeReq({ body: { name: 'A', age: 'x' } })),
      (err: unknown) => {
        assert.ok(err instanceof ValidationError)
        assert.ok(Array.isArray(err.errors['name']))
        assert.ok(Array.isArray(err.errors['age']))
        return true
      }
    )
  })

  it('uses "root" as key for top-level (no-path) errors', async () => {
    const schema = z.string()
    await assert.rejects(
      async () => validate(schema, makeReq({ body: 123 })),
      (err: unknown) => {
        assert.ok(err instanceof ValidationError)
        assert.ok('root' in err.errors)
        return true
      }
    )
  })

  it('field errors are returned as string arrays', async () => {
    const schema = z.object({ pw: z.string().min(8) })
    await assert.rejects(
      async () => validate(schema, makeReq({ body: { pw: 'abc' } })),
      (err: unknown) => {
        assert.ok(err instanceof ValidationError)
        assert.ok(Array.isArray(err.errors['pw']))
        assert.ok((err.errors['pw']?.length ?? 0) >= 1)
        return true
      }
    )
  })

  it('re-throws non-Zod errors', async () => {
    const schema = z.object({ x: z.string() })
    const badSchema = { ...schema, parse: () => { throw new TypeError('unexpected') } } as unknown as typeof schema
    await assert.rejects(
      async () => validate(badSchema, makeReq()),
      TypeError
    )
  })

  it('supports nested path keys (a.b)', async () => {
    const schema = z.object({ address: z.object({ city: z.string().min(2) }) })
    await assert.rejects(
      async () => validate(schema, makeReq({ body: { address: { city: 'X' } } })),
      (err: unknown) => {
        assert.ok(err instanceof ValidationError)
        assert.ok('address.city' in err.errors)
        return true
      }
    )
  })
})

// ─── validateWith() ────────────────────────────────────────

describe('validateWith()', () => {
  it('returns a function (MiddlewareHandler)', () => {
    assert.strictEqual(typeof validateWith(z.object({})), 'function')
  })

  it('calls next() when input is valid', async () => {
    const mw = validateWith(z.object({ email: z.string().email() }))
    let called = false
    await mw(makeReq({ body: { email: 'a@b.com' } }), res, async () => { called = true })
    assert.ok(called)
  })

  it('does NOT call next() when input is invalid', async () => {
    const mw = validateWith(z.object({ email: z.string().email() }))
    let called = false
    await assert.rejects(
      async () => mw(makeReq({ body: { email: 'bad' } }), res, async () => { called = true }),
      (err: unknown) => err instanceof ValidationError
    )
    assert.ok(!called)
  })

  it('throws ValidationError with field errors on invalid input', async () => {
    const mw = validateWith(z.object({ name: z.string().min(3) }))
    await assert.rejects(
      async () => mw(makeReq({ body: { name: 'X' } }), res, async () => {}),
      (err: unknown) => {
        assert.ok(err instanceof ValidationError)
        assert.ok(Array.isArray(err.errors['name']))
        return true
      }
    )
  })

  it('does not attach parsed data to req.body', async () => {
    const mw = validateWith(z.object({ age: z.coerce.number() }))
    const req = makeReq({ body: { age: '25' } })
    await mw(req, res, async () => {})
    assert.strictEqual((req.body as Record<string, unknown>)['age'], '25')
  })
})

// ─── FormRequest ───────────────────────────────────────────

describe('FormRequest', () => {
  it('validates and returns typed data for valid input', async () => {
    class CreateUser extends FormRequest {
      rules() { return z.object({ name: z.string(), age: z.coerce.number() }) }
    }
    const data = await new CreateUser().validate(makeReq({ body: { name: 'Bob', age: '25' } })) as { name: string; age: number }
    assert.deepStrictEqual(data, { name: 'Bob', age: 25 })
  })

  it('merges body + query + params', async () => {
    class Req extends FormRequest {
      rules() { return z.object({ id: z.string(), role: z.string(), name: z.string() }) }
    }
    const data = await new Req().validate(makeReq({
      body:   { name: 'Carol' },
      query:  { role: 'admin' },
      params: { id: '7' },
    }))
    assert.deepStrictEqual(data as unknown, { id: '7', role: 'admin', name: 'Carol' })
  })

  it('authorize() defaults to true — allows request', async () => {
    class Req extends FormRequest {
      rules() { return z.object({ x: z.string() }) }
    }
    const data = await new Req().validate(makeReq({ body: { x: 'ok' } })) as { x: string }
    assert.strictEqual(data.x, 'ok')
  })

  it('throws ValidationError with auth error when authorize() returns false', async () => {
    class Locked extends FormRequest {
      rules() { return z.object({ id: z.string() }) }
      override authorize() { return false }
    }
    await assert.rejects(
      async () => new Locked().validate(makeReq({ body: { id: '1' } })),
      (err: unknown) => {
        assert.ok(err instanceof ValidationError)
        assert.deepStrictEqual(err.errors['auth'], ['Unauthorized'])
        return true
      }
    )
  })

  it('throws ValidationError on schema failure', async () => {
    class Req extends FormRequest {
      rules() { return z.object({ email: z.string().email() }) }
    }
    await assert.rejects(
      async () => new Req().validate(makeReq({ body: { email: 'not-an-email' } })),
      (err: unknown) => err instanceof ValidationError
    )
  })

  it('exposes req on this after validate() is called', async () => {
    let capturedReq: AppRequest | null = null
    class Req extends FormRequest {
      rules() {
        capturedReq = this.req
        return z.object({ x: z.string() })
      }
    }
    const req = makeReq({ body: { x: 'hi' } })
    await new Req().validate(req)
    assert.strictEqual(capturedReq, req)
  })

  it('handles null body gracefully', async () => {
    class Req extends FormRequest {
      rules() { return z.object({ role: z.string() }) }
    }
    const data = await new Req().validate(makeReq({ body: null, query: { role: 'user' } })) as { role: string }
    assert.strictEqual(data.role, 'user')
  })
})

// ─── z re-export ───────────────────────────────────────────

describe('z re-export', () => {
  it('z.string() works correctly', () => {
    assert.strictEqual(z.string().parse('hello'), 'hello')
  })

  it('z.object() validates correctly', () => {
    const result = z.object({ n: z.number() }).parse({ n: 42 })
    assert.strictEqual(result.n, 42)
  })
})
