# Validation

Rudder validates request input with [Zod](https://zod.dev). You can validate inline with `validate()`, attach a schema as middleware with `validateWith()`, or extend `FormRequest` for class-based validation that includes authorization.

`@rudderjs/core` re-exports `z` so you don't need a separate `zod` install.

## Inline validation

The simplest pattern: define a schema, parse the request, get a typed object back.

```ts
import { validate, z } from '@rudderjs/core'

router.post('/api/users', async (req, res) => {
  const data = await validate(
    z.object({
      name:  z.string().min(1),
      email: z.string().email(),
    }),
    req,
  )

  // data is fully typed: { name: string; email: string }
  const user = await User.create(data)
  return res.status(201).json({ data: user })
})
```

`validate()` merges `req.params`, `req.query`, and `req.body` (priority: `params` > `query` > `body`) before parsing. It throws `ValidationError` on failure — the framework's exception handler renders that as a structured 422 response automatically.

## Reusable middleware

`validateWith(schema)` returns a middleware that runs before your handler. Use it when the same schema applies to several routes, or when you want validation visible at the route declaration:

```ts
import { validateWith, z } from '@rudderjs/core'

const requireCreateUser = validateWith(
  z.object({
    name:  z.string().min(1),
    email: z.string().email(),
    role:  z.enum(['admin', 'user']).default('user'),
  }),
)

router.post('/api/users', requireCreateUser, async (req, res) => {
  // Validation has already passed.
  // Re-parse to get the typed/coerced data — validateWith() doesn't mutate req.body.
  const data = await validate(schema, req)
  return res.status(201).json({ data: await User.create(data) })
})
```

`validateWith()` is fire-and-forget — it throws on failure and continues otherwise. It does not attach the parsed value to `req`. The convention is to validate twice: once via the middleware (for the early reject), once inside the handler (to get the typed value). The cost is negligible.

## Class-based form requests

For complex shapes, multi-field rules, or when validation needs authorization, extend `FormRequest`:

```ts
// app/Http/Requests/CreateUserRequest.ts
import { FormRequest, z } from '@rudderjs/core'

export class CreateUserRequest extends FormRequest {
  rules() {
    return z.object({
      name:  z.string().min(2).max(100),
      email: z.string().email(),
      role:  z.enum(['admin', 'user']).default('user'),
    })
  }

  override authorize(): boolean {
    return this.req.user?.role === 'admin'
  }
}
```

Use it in the route:

```ts
router.post('/api/users', async (req, res) => {
  const data = await new CreateUserRequest().validate(req)
  return res.status(201).json({ data: await User.create(data) })
})
```

`authorize()` is synchronous and returns `boolean`. Returning `false` rejects with a 403-equivalent error. Generate stubs with `pnpm rudder make:request CreateUser`.

## Lifecycle hooks

`FormRequest` exposes five optional hooks that run around `rules()`. Pipeline order:

```
authorize → prepareForValidation → rules.parse → after → passedValidation
              ↓                       ↓             ↓
              ─────── failedValidation(errors) ───────
```

Both Zod parse failures and `after()`-collected errors converge through `failedValidation(errors)`.

```ts
import { FormRequest, ValidationError, z } from '@rudderjs/core'

const schema = z.object({
  email:    z.string().email(),
  password: z.string().min(8),
})

export class CreateUserRequest extends FormRequest<typeof schema> {
  rules() { return schema }

  // Sync. Mutate the merged input before parsing — normalize, trim, lowercase, etc.
  protected override prepareForValidation(input: Record<string, unknown>) {
    if (typeof input['email'] === 'string') {
      input['email'] = input['email'].toLowerCase().trim()
    }
  }

  // Per-request error message overrides keyed by dot-path. Static string OR function of the Zod issue.
  protected override messages() {
    return {
      email:    'Please enter a valid email address.',
      password: (issue: z.core.$ZodRawIssue) =>
        issue.code === 'too_small' ? 'Min 8 characters.' : 'Invalid password.',
    }
  }

  // Cross-field checks against the parsed data. Each callback runs serially; all errors are collected.
  protected override after() {
    return [
      ({ data, addError }) => {
        if (data.email.endsWith('@example.com')) {
          addError('email', 'Sample addresses are not allowed')
        }
      },
    ]
  }

  // Final transform after all checks pass. Return value replaces the resolved data.
  protected override async passedValidation(data: z.infer<typeof schema>) {
    return { ...data, password: await Bcrypt.hash(data.password) }
  }

  // Customize the failure path. Default throws ValidationError; return a Response to short-circuit
  // the framework's 422 renderer.
  protected override failedValidation(errors: Record<string, string[]>) {
    throw new ValidationError(errors)
  }
}
```

**Type inference.** Parameterize the class with the schema type (`extends FormRequest<typeof schema>`) so `data` in `after()` and `passedValidation()` is inferred. Without the parameter, `data` is `unknown`.

**Short-circuit responses.** `failedValidation()` may `return` a Web `Response` directly to bypass the default 422 — the exception handler unwraps it via the `ValidationResponse` sentinel and emits the wrapped Response unchanged. Useful for redirecting back with flash errors on form submissions.

**`messages()` vs Zod's `.message(...)`.** Zod schema-level messages still apply. `messages()` is a per-request override that takes precedence and supports per-issue functions, which Zod schema messages cannot.

## Validation errors

`validate()` and `FormRequest.validate()` throw a `ValidationError`. The framework's error handler catches it and returns a 422 with a structured body:

```json
{
  "message": "Validation failed",
  "errors": {
    "email": ["Invalid email"],
    "name":  ["String must contain at least 1 character(s)"]
  }
}
```

Field paths from nested objects are joined with `.` (e.g. `address.city`). Top-level schema errors (when the schema isn't an object) use the key `'root'`. Authorization failures use `'auth'`.

If you want to handle the error yourself, catch it explicitly:

```ts
import { validate, ValidationError, z } from '@rudderjs/core'

try {
  const data = await validate(schema, req)
  // ...
} catch (err) {
  if (err instanceof ValidationError) {
    return res.status(422).json(err.toJSON())
  }
  throw err
}
```

For framework-wide handling — custom renderers, error reporting — see [Error Handling](/guide/error-handling).

## Coercion and defaults

Zod's `.default(...)`, `.optional()`, and `.coerce.*` work as expected. Use `z.coerce.number()` to accept string-encoded numbers from query strings:

```ts
const PaginationSchema = z.object({
  page:    z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(20),
})

const { page, perPage } = await validate(PaginationSchema, req)
```

## API reference

| Export | Description |
|---|---|
| `validate(schema, req)` | Validates merged params/query/body; throws `ValidationError` on failure |
| `validateWith(schema)` | Returns a middleware handler that validates the request |
| `FormRequest` | Base class — `rules()` required; optional hooks: `authorize`, `prepareForValidation`, `messages`, `after`, `passedValidation`, `failedValidation` |
| `ValidationError` | `Error` subclass with `errors: Record<string, string[]>` and `toJSON()` |
| `ValidationResponse` | Sentinel wrapping a Web `Response` returned from `failedValidation()` |
| `z` | Re-export of Zod's `z` namespace |

## Pitfalls

- **`validateWith()` doesn't attach to `req.body`.** Re-parse inside the handler with `validate()` to get the typed value, or use `FormRequest` if you only want to write the schema once.
- **Merge priority surprises.** `params` wins over `body` wins over `query`. If you have `:id` in the path *and* `id` in the body, the path value wins.
- **`authorize()` is sync.** Don't make it async — the result is read synchronously by `validate()`. For async authorization checks (DB lookup), do them in middleware before the validator runs.
- **`prepareForValidation()` is sync.** Async normalization (DB lookups, remote calls) belongs in middleware before validation runs — the hook is for in-memory mutation only.
- **`after()` returns an array of callbacks, not a single callback.** Each callback gets `{ data, req, addError }`. Returning a single function from `after()` is a type error; wrap it: `return [({ data, addError }) => …]`.
