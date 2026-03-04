# Validation

BoostKit provides Zod-powered request validation through `@boostkit/validation`. You can validate inline with `validate()`, use middleware factories with `validateWith()`, or extend `FormRequest` for class-based validation.

## Quick Inline Validation

```ts
import { validate, z } from '@boostkit/validation'
import type { AppRequest, AppResponse } from '@boostkit/contracts'

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

`validate()` merges `req.body`, `req.query`, and `req.params` before parsing. It throws a `ValidationError` if the data is invalid.

## `validateWith()` Middleware

Create reusable validation middleware:

```ts
import { validateWith, z } from '@boostkit/validation'

const requireCreateUser = validateWith(
  z.object({
    name:  z.string().min(1),
    email: z.string().email(),
    role:  z.enum(['admin', 'user']).default('user'),
  })
)

// Use as route middleware
router.post('/api/users', requireCreateUser, async (req, res) => {
  // req.body is already validated
  const user = await User.create(req.body as any)
  return res.status(201).json({ data: user })
})
```

## Class-Based `FormRequest`

For complex validation with authorization logic, extend `FormRequest`:

```ts
// app/Http/Requests/CreateUserRequest.ts
import { FormRequest } from '@boostkit/validation'
import { z } from 'zod'

export class CreateUserRequest extends FormRequest {
  rules() {
    return z.object({
      name:  z.string().min(2).max(100),
      email: z.string().email(),
      role:  z.enum(['admin', 'user']).default('user'),
    })
  }

  async authorize(): Promise<boolean> {
    // Return false to reject with a 403-equivalent error
    const user = (this.req as any).user
    return user?.role === 'admin'
  }
}
```

Use it in a route:

```ts
router.post('/api/users', async (req, res) => {
  const formRequest = new CreateUserRequest(req)
  const data = await formRequest.validate()

  // data: { name: string; email: string; role: 'admin' | 'user' }
  const user = await User.create(data)
  return res.status(201).json({ data: user })
})
```

## Handling Validation Errors

`validate()` and `FormRequest.validate()` throw a `ValidationError` on failure. Catch it to return a structured error response:

```ts
import { validate, ValidationError, z } from '@boostkit/validation'

router.post('/api/users', async (req, res) => {
  try {
    const data = await validate(schema, req)
    // ...
  } catch (err) {
    if (err instanceof ValidationError) {
      return res.status(422).json({
        message: 'Validation failed',
        errors: err.errors,  // ZodError issues array
      })
    }
    throw err
  }
})
```

### `ValidationError` shape

```ts
class ValidationError extends Error {
  errors: ZodIssue[]   // full Zod error issues
  flatten(): { fieldErrors: Record<string, string[]> }
}
```

## Using Zod Directly

`@boostkit/validation` re-exports `z` from Zod, so you don't need a separate Zod import:

```ts
import { z } from '@boostkit/validation'

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
pnpm artisan make:request CreateUser
# → app/Http/Requests/CreateUserRequest.ts
```

## API Reference

| Export | Description |
|--------|-------------|
| `validate(schema, req)` | Validates merged body/query/params, throws on failure |
| `validateWith(schema)` | Returns a middleware handler that validates the request |
| `FormRequest` | Base class for class-based validation with `rules()` and `authorize()` |
| `ValidationError` | Error thrown when validation fails; contains Zod issues |
| `z` | Re-export of Zod's `z` namespace |

## Notes

- `FormRequest.validate()` merges `body`, `query`, and `params` before parsing — you don't need to pick them manually
- `authorize()` defaults to `true` — override it to implement per-request authorization
- `ValidationError.errors` is the raw `ZodIssue[]` array; use `.flatten()` for field-keyed error maps
