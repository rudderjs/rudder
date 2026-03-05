# @boostkit/validation

Zod-powered request validation for BoostKit — inline helpers, middleware factories, and class-based form requests.

## Installation

```bash
pnpm add @boostkit/validation
```

## Usage

### Inline validation

```ts
import { validate, z } from '@boostkit/validation'

const data = await validate(
  z.object({ name: z.string().min(1), age: z.coerce.number().int() }),
  req
)
// data: { name: string; age: number }
```

### Middleware factory

```ts
import { validateWith, z } from '@boostkit/validation'

const mw = validateWith(z.object({ email: z.string().email() }))

router.post('/api/users', mw, handler)
```

`validateWith()` throws `ValidationError` on invalid input; it does **not** mutate `req.body`.

### Class-based form request

```ts
import { FormRequest, z } from '@boostkit/validation'

class CreateUserRequest extends FormRequest {
  rules() {
    return z.object({
      name:  z.string().min(2),
      email: z.string().email(),
    })
  }

  override authorize(): boolean {
    return (this.req as any).user?.role === 'admin'
  }
}

// In a route handler:
const data = await new CreateUserRequest().validate(req)
```

### Handling errors

```ts
import { validate, ValidationError, z } from '@boostkit/validation'

try {
  const data = await validate(schema, req)
} catch (err) {
  if (err instanceof ValidationError) {
    res.status(422).json(err.toJSON())
    // → { message: 'Validation failed', errors: { email: ['Invalid email'] } }
  }
}
```

## API Reference

### `validate(schema, req)`

Merges `req.params`, `req.query`, and `req.body` (params take priority) and parses against `schema`. Returns typed data or throws `ValidationError`.

### `validateWith(schema)`

Returns a `MiddlewareHandler` that runs `validate()` and calls `next()` on success. Does not attach parsed data to `req.body`.

### `FormRequest`

Abstract base class. Extend and implement `rules()`:

| Method | Signature | Description |
|--------|-----------|-------------|
| `rules()` | `abstract rules(): ZodType` | Define the validation schema |
| `authorize()` | `(): boolean` | Authorization check (default: `true`) |
| `validate(req)` | `async (req: AppRequest): Promise<z.infer<T>>` | Run authorization + validation |

`this.req` is available inside `rules()` and `authorize()` after `validate()` is called.

### `ValidationError`

| Property | Type | Description |
|----------|------|-------------|
| `name` | `'ValidationError'` | Error name |
| `message` | `'Validation failed'` | Human-readable message |
| `errors` | `Record<string, string[]>` | Field → error messages map |
| `toJSON()` | `() => { message, errors }` | Serializable shape |

Nested paths are joined with `.` (e.g. `address.city`). Top-level schema errors use `'root'`. Auth failures use `'auth'`.

### `z`

Re-export of Zod's `z` namespace — no separate `zod` import needed.
