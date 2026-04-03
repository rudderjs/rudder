# Validation

RudderJS provides Zod-powered request validation through `@rudderjs/core`. You can validate inline with `validate()`, use middleware factories with `validateWith()`, or extend `FormRequest` for class-based validation.

## Quick Inline Validation

```ts
import { validate, z } from '@rudderjs/core'
import type { AppRequest, AppResponse } from '@rudderjs/contracts'

router.post('/api/users', async (req: AppRequest, res: AppResponse) => {
  const data = await validate(
    z.object({
      name:  z.string().min(1),
      email: z.string().email(),
    }),
    req
  )

  // data is fully typed: { name: string; email: string }
  const user = await User.create(data)
  return res.status(201).json({ data: user })
})
```

`validate()` merges `req.params`, `req.query`, and `req.body` (in that priority order — params wins ties) before parsing. It throws a `ValidationError` if the data is invalid.

## `validateWith()` Middleware

Create reusable validation middleware:

```ts
import { validateWith, z } from '@rudderjs/core'

const requireCreateUser = validateWith(
  z.object({
    name:  z.string().min(1),
    email: z.string().email(),
    role:  z.enum(['admin', 'user']).default('user'),
  })
)

// Use as route middleware
router.post('/api/users', requireCreateUser, async (req, res) => {
  // Validation already passed — parse body again to get typed/coerced data
  const data = await validate(schema, req)
  const user = await User.create(data)
  return res.status(201).json({ data: user })
})
```

> `validateWith()` validates the request and throws `ValidationError` on failure. It does **not** attach parsed data to `req.body` — the original body is left unchanged.

## Class-Based `FormRequest`

For complex validation with authorization logic, extend `FormRequest`:

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
    // Return false to reject with a 403-equivalent error
    const user = (this.req as any).user
    return user?.role === 'admin'
  }
}
```

Use it in a route — pass `req` to `.validate()`:

```ts
router.post('/api/users', async (req, res) => {
  const data = await new CreateUserRequest().validate(req)

  // data: { name: string; email: string; role: 'admin' | 'user' }
  const user = await User.create(data)
  return res.status(201).json({ data: user })
})
```

## Handling Validation Errors

`validate()` and `FormRequest.validate()` throw a `ValidationError` on failure. Catch it to return a structured error response:

```ts
import { validate, ValidationError, z } from '@rudderjs/core'

router.post('/api/users', async (req, res) => {
  try {
    const data = await validate(schema, req)
    // ...
  } catch (err) {
    if (err instanceof ValidationError) {
      return res.status(422).json(err.toJSON())
      // → { message: 'Validation failed', errors: { email: ['Invalid email'] } }
    }
    throw err
  }
})
```

### `ValidationError` shape

```ts
class ValidationError extends Error {
  name:    'ValidationError'
  message: 'Validation failed'
  errors:  Record<string, string[]>  // field name → error messages

  toJSON(): { message: string; errors: Record<string, string[]> }
}
```

Field paths from nested objects are joined with `.` (e.g. `address.city`). Top-level schema errors (when the schema isn't an object) use the key `'root'`. Authorization failures use `'auth'`.

## Using Zod Directly

`@rudderjs/core` re-exports `z` from Zod — no separate `zod` install needed:

```ts
import { z } from '@rudderjs/core'

const UserSchema = z.object({
  id:    z.string().cuid(),
  name:  z.string(),
  email: z.string().email(),
  role:  z.enum(['admin', 'user']),
})

type User = z.infer<typeof UserSchema>
```

## Generating Form Requests

```bash
pnpm rudder make:request CreateUser
# → app/Http/Requests/CreateUserRequest.ts
```

## API Reference

| Export | Description |
|--------|-------------|
| `validate(schema, req)` | Validates merged params/query/body, throws `ValidationError` on failure |
| `validateWith(schema)` | Returns a middleware handler that validates the request; does not mutate `req.body` |
| `FormRequest` | Base class with `rules()` (required) and `authorize()` (optional, sync) |
| `ValidationError` | Error with `errors: Record<string, string[]>` and `toJSON()` |
| `z` | Re-export of Zod's `z` namespace |

## Notes

- Merge priority: `params` > `query` > `body` — route params win key conflicts
- `authorize()` is synchronous and returns `boolean`; defaults to `true`
- `validateWith()` does **not** attach parsed/coerced data to `req.body`
- `ValidationError.errors` is already a `Record<string, string[]>` — no transformation needed
