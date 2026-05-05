import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { AppRequest, AppResponse } from '@rudderjs/contracts'
import { attachInputAccessors } from '@rudderjs/contracts'
import { z, validate, validateWith, FormRequest, ValidationError, ValidationResponse } from './validation.js'
import type { AfterCallback } from './validation.js'

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
  statusCode: 200,
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

  // ─── prepareForValidation ────────────────────────────────

  it('prepareForValidation: mutates input in place (void return)', async () => {
    class Req extends FormRequest {
      override prepareForValidation(input: Record<string, unknown>) {
        if (typeof input['email'] === 'string') input['email'] = (input['email'] as string).toLowerCase()
      }
      rules() { return z.object({ email: z.string().email() }) }
    }
    const data = await new Req().validate(makeReq({ body: { email: 'BOB@EXAMPLE.COM' } })) as { email: string }
    assert.strictEqual(data.email, 'bob@example.com')
  })

  it('prepareForValidation: returning new object replaces input', async () => {
    class Req extends FormRequest {
      override prepareForValidation(_input: Record<string, unknown>) {
        return { name: 'overridden' }
      }
      rules() { return z.object({ name: z.string() }) }
    }
    const data = await new Req().validate(makeReq({ body: { name: 'original' } })) as { name: string }
    assert.strictEqual(data.name, 'overridden')
  })

  it('prepareForValidation: runs before rules() is called', async () => {
    const order: string[] = []
    class Req extends FormRequest {
      override prepareForValidation() { order.push('prepare') }
      rules() {
        order.push('rules')
        return z.object({ x: z.string() })
      }
    }
    await new Req().validate(makeReq({ body: { x: 'ok' } }))
    // rules() is called twice — once for the schema build inside validate(), once when registered.
    // Just assert prepare came before the first rules() call.
    assert.strictEqual(order[0], 'prepare')
    assert.ok(order.includes('rules'))
  })

  // ─── passedValidation ────────────────────────────────────

  it('passedValidation: returning Record replaces resolved data', async () => {
    class Req extends FormRequest {
      rules() { return z.object({ password: z.string() }) }
      override passedValidation(data: { password: string }) {
        return { ...data, password: `hashed:${data.password}` }
      }
    }
    const data = await new Req().validate(makeReq({ body: { password: 'secret' } })) as { password: string }
    assert.strictEqual(data.password, 'hashed:secret')
  })

  it('passedValidation: void return preserves parsed data', async () => {
    class Req extends FormRequest {
      rules() { return z.object({ x: z.string() }) }
      override passedValidation() { /* no-op */ }
    }
    const data = await new Req().validate(makeReq({ body: { x: 'ok' } })) as { x: string }
    assert.strictEqual(data.x, 'ok')
  })

  it('passedValidation: async return is awaited', async () => {
    class Req extends FormRequest {
      rules() { return z.object({ x: z.string() }) }
      override async passedValidation(data: { x: string }) {
        await new Promise((r) => setTimeout(r, 1))
        return { x: `async:${data.x}` }
      }
    }
    const data = await new Req().validate(makeReq({ body: { x: 'ok' } })) as { x: string }
    assert.strictEqual(data.x, 'async:ok')
  })

  // ─── after() ────────────────────────────────────────────

  it('after: empty array resolves normally', async () => {
    class Req extends FormRequest {
      rules() { return z.object({ x: z.string() }) }
      override after() { return [] }
    }
    const data = await new Req().validate(makeReq({ body: { x: 'ok' } })) as { x: string }
    assert.strictEqual(data.x, 'ok')
  })

  it('after: addError throws ValidationError with that field', async () => {
    const schema = z.object({ from: z.string(), to: z.string() })
    type Data = z.infer<typeof schema>
    class Req extends FormRequest<typeof schema> {
      rules() { return schema }
      override after(): Array<AfterCallback<Data>> {
        return [({ data, addError }) => {
          if (data.from === data.to) addError('to', 'Cannot transfer to the same account')
        }]
      }
    }
    await assert.rejects(
      async () => new Req().validate(makeReq({ body: { from: 'a', to: 'a' } })),
      (err: unknown) => {
        assert.ok(err instanceof ValidationError)
        assert.deepStrictEqual(err.errors['to'], ['Cannot transfer to the same account'])
        return true
      }
    )
  })

  it('after: collects errors across multiple callbacks (one round-trip)', async () => {
    const schema = z.object({ a: z.string(), b: z.string() })
    type Data = z.infer<typeof schema>
    class Req extends FormRequest<typeof schema> {
      rules() { return schema }
      override after(): Array<AfterCallback<Data>> {
        return [
          ({ addError }) => addError('a', 'a is bad'),
          ({ addError }) => addError('b', 'b is bad'),
        ]
      }
    }
    await assert.rejects(
      async () => new Req().validate(makeReq({ body: { a: '1', b: '2' } })),
      (err: unknown) => {
        assert.ok(err instanceof ValidationError)
        assert.deepStrictEqual(err.errors['a'], ['a is bad'])
        assert.deepStrictEqual(err.errors['b'], ['b is bad'])
        return true
      }
    )
  })

  it('after: async callbacks are awaited serially', async () => {
    const order: string[] = []
    class Req extends FormRequest {
      rules() { return z.object({ x: z.string() }) }
      override after() {
        return [
          async () => {
            await new Promise((r) => setTimeout(r, 5))
            order.push('first')
          },
          () => {
            order.push('second')
          },
        ]
      }
    }
    await new Req().validate(makeReq({ body: { x: 'ok' } }))
    assert.deepStrictEqual(order, ['first', 'second'])
  })

  // ─── failedValidation ────────────────────────────────────

  it('failedValidation: override can throw a custom error', async () => {
    class CustomError extends Error {}
    class Req extends FormRequest {
      rules() { return z.object({ x: z.string() }) }
      override failedValidation(_errors: Record<string, string[]>): never {
        throw new CustomError('nope')
      }
    }
    await assert.rejects(
      async () => new Req().validate(makeReq({ body: { x: 123 } })),
      (err: unknown) => err instanceof CustomError
    )
  })

  it('failedValidation: returning Response throws ValidationResponse wrapper', async () => {
    const customResponse = new Response('custom body', { status: 418 })
    class Req extends FormRequest {
      rules() { return z.object({ x: z.string() }) }
      override failedValidation(_errors: Record<string, string[]>): Response {
        return customResponse
      }
    }
    await assert.rejects(
      async () => new Req().validate(makeReq({ body: { x: 123 } })),
      (err: unknown) => {
        assert.ok(err instanceof ValidationResponse)
        assert.strictEqual(err.response, customResponse)
        return true
      }
    )
  })

  it('failedValidation: fires for after()-added errors too', async () => {
    let capturedErrors: Record<string, string[]> | null = null
    const schema = z.object({ x: z.string() })
    type Data = z.infer<typeof schema>
    class Req extends FormRequest<typeof schema> {
      rules() { return schema }
      override after(): Array<AfterCallback<Data>> {
        return [({ addError }) => addError('x', 'cross-field nope')]
      }
      override failedValidation(errors: Record<string, string[]>): never {
        capturedErrors = errors
        throw new ValidationError(errors)
      }
    }
    await assert.rejects(async () => new Req().validate(makeReq({ body: { x: 'ok' } })))
    assert.deepStrictEqual(capturedErrors, { x: ['cross-field nope'] })
  })

  // ─── messages() ─────────────────────────────────────────

  it('messages: static string overrides Zod default', async () => {
    class Req extends FormRequest {
      rules() { return z.object({ email: z.string() }) }
      override messages() { return { email: 'Custom email message' } }
    }
    await assert.rejects(
      async () => new Req().validate(makeReq({ body: { email: 123 } })),
      (err: unknown) => {
        assert.ok(err instanceof ValidationError)
        assert.deepStrictEqual(err.errors['email'], ['Custom email message'])
        return true
      }
    )
  })

  it('messages: function form receives the issue', async () => {
    class Req extends FormRequest {
      rules() { return z.object({ age: z.number().int().min(18) }) }
      override messages() {
        return {
          age: (issue: z.core.$ZodRawIssue) =>
            issue.code === 'too_small' ? 'too young' : `bad: ${issue.code}`,
        }
      }
    }
    await assert.rejects(
      async () => new Req().validate(makeReq({ body: { age: 15 } })),
      (err: unknown) => {
        assert.ok(err instanceof ValidationError)
        assert.deepStrictEqual(err.errors['age'], ['too young'])
        return true
      }
    )
  })

  it('messages: no entry for path falls through to Zod default', async () => {
    class Req extends FormRequest {
      rules() { return z.object({ name: z.string(), age: z.number() }) }
      override messages() { return { age: 'Custom age message' } }
    }
    await assert.rejects(
      async () => new Req().validate(makeReq({ body: { name: 123, age: 'x' } })),
      (err: unknown) => {
        assert.ok(err instanceof ValidationError)
        assert.deepStrictEqual(err.errors['age'], ['Custom age message'])
        // name should NOT be the custom message — it should be Zod's default
        assert.ok(err.errors['name'] && err.errors['name'][0] !== 'Custom age message')
        return true
      }
    )
  })

  // ─── Order of operations ─────────────────────────────────

  it('order: prepareForValidation → parse → after → passedValidation', async () => {
    const order: string[] = []
    class Req extends FormRequest {
      override prepareForValidation() { order.push('prepare') }
      rules() {
        order.push('rules')
        return z.object({ x: z.string() })
      }
      override after() {
        return [() => { order.push('after') }]
      }
      override passedValidation() { order.push('passed') }
    }
    await new Req().validate(makeReq({ body: { x: 'ok' } }))
    // First entry must be prepare
    assert.strictEqual(order[0], 'prepare')
    // 'after' must come before 'passed'
    const afterIdx = order.indexOf('after')
    const passedIdx = order.indexOf('passed')
    assert.ok(afterIdx > -1 && passedIdx > -1 && afterIdx < passedIdx)
  })

  it('regression: existing rules() + authorize() subclass still works', async () => {
    class Req extends FormRequest {
      rules() { return z.object({ x: z.string() }) }
      override authorize() { return true }
    }
    const data = await new Req().validate(makeReq({ body: { x: 'ok' } })) as { x: string }
    assert.strictEqual(data.x, 'ok')
  })

  // ─── Pipeline ordering: prepareForValidation runs before authorize ───

  it('prepareForValidation runs BEFORE authorize() — Laravel parity', async () => {
    const order: string[] = []
    class Req extends FormRequest {
      override prepareForValidation() { order.push('prepare') }
      override authorize() { order.push('authorize'); return true }
      rules() { return z.object({ x: z.string() }) }
    }
    await new Req().validate(makeReq({ body: { x: 'ok' } }))
    assert.deepStrictEqual(order, ['prepare', 'authorize'])
  })

  it('authorize() can read state set up by prepareForValidation', async () => {
    class Req extends FormRequest {
      private _normalizedRole = ''
      override prepareForValidation(input: Record<string, unknown>) {
        this._normalizedRole = String(input['role'] ?? '').toLowerCase()
      }
      override authorize() {
        // The agent example: a permission check that reads a normalized
        // identifier set up by prepareForValidation.
        return this._normalizedRole === 'admin'
      }
      rules() { return z.object({ role: z.string() }) }
    }
    // 'ADMIN' is normalized to 'admin' before authorize fires → allowed.
    const data = await new Req().validate(makeReq({ body: { role: 'ADMIN' } })) as { role: string }
    assert.strictEqual(data.role, 'ADMIN')

    // 'user' fails the lowered-case check.
    await assert.rejects(
      async () => new Req().validate(makeReq({ body: { role: 'user' } })),
      (err: unknown) => {
        assert.ok(err instanceof ValidationError)
        assert.deepStrictEqual(err.errors['auth'], ['Unauthorized'])
        return true
      },
    )
  })

  // ─── prepareForValidation: async ───

  it('prepareForValidation: async return is awaited (Promise no longer treated as object)', async () => {
    class Req extends FormRequest {
      override async prepareForValidation(input: Record<string, unknown>) {
        await new Promise((r) => setTimeout(r, 1))
        return { ...input, email: String(input['email'] ?? '').toLowerCase() }
      }
      rules() { return z.object({ email: z.string().email() }) }
    }
    const data = await new Req().validate(makeReq({ body: { email: 'BOB@EXAMPLE.COM' } })) as { email: string }
    assert.strictEqual(data.email, 'bob@example.com')
  })

  // ─── messages() top-level errors ───

  it("messages: 'root' key overrides top-level (path-less) errors", async () => {
    // A schema-level refine produces an issue with empty path. Both the
    // ValidationError output and the messages() override must use the same
    // canonical 'root' key — previously the override map looked up by `''`
    // while the error output reported under `'root'`, so users could see the
    // error key but never override its message.
    class Req extends FormRequest {
      rules() {
        // No `message` on refine — leaves the issue without a pre-attached
        // message so Zod consults the errorMap.
        return z.object({ from: z.string(), to: z.string() }).refine(
          (v) => v.from !== v.to,
        )
      }
      override messages() { return { root: 'Custom top-level message' } }
    }
    await assert.rejects(
      async () => new Req().validate(makeReq({ body: { from: 'a', to: 'a' } })),
      (err: unknown) => {
        assert.ok(err instanceof ValidationError)
        assert.deepStrictEqual(err.errors['root'], ['Custom top-level message'])
        return true
      },
    )
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
