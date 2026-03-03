# @forge/validation

Zod-powered request validation with FormRequest and middleware helpers.

```bash
pnpm add @forge/validation
```

---

## Usage

There are three ways to validate incoming requests in Forge. All three use Zod schemas and throw a `ValidationError` on failure.

### 1. validate(schema, req)

Validate a request inline inside a route handler. Merges `body`, `query`, and `params` before validating.

```ts
import { validate, z } from '@forge/validation'
import { router } from '@forge/router'

router.post('/api/users', async (req, res) => {
  const data = await validate(
    z.object({
      name:  z.string().min(2),
      email: z.string().email(),
      role:  z.enum(['admin', 'user']).default('user'),
    }),
    req,
  )

  // data is fully typed: { name: string; email: string; role: 'admin' | 'user' }
  const user = await User.create(data)
  return res.status(201).json({ data: user })
})
```

### 2. validateWith(schema)

Returns a `MiddlewareHandler` that validates the request and attaches the parsed data to `req.body`. Use this when you want validation as a reusable middleware step.

```ts
import { validateWith, z } from '@forge/validation'
import { router } from '@forge/router'

const validateCreateUser = validateWith(
  z.object({
    name:  z.string().min(2),
    email: z.string().email(),
  }),
)

router.post('/api/users', handler, [validateCreateUser])
```

### 3. FormRequest

`FormRequest` encapsulates validation logic and optional authorisation in a class. This is the recommended approach for complex input with reuse across controllers.

```ts
import { FormRequest, z } from '@forge/validation'
import type { ForgeRequest } from '@forge/contracts'

export class CreateUserRequest extends FormRequest {
  rules() {
    return z.object({
      name:  z.string().min(2),
      email: z.string().email(),
      role:  z.enum(['admin', 'user']).default('user'),
    })
  }

  async authorize(req: ForgeRequest): Promise<boolean> {
    // Return false to reject the request with 403 before validation runs.
    // Defaults to true if not overridden.
    return true
  }
}
```

```ts
import { router } from '@forge/router'
import { CreateUserRequest } from '../Requests/CreateUserRequest.js'

router.post('/api/users', async (req, res) => {
  const request = new CreateUserRequest()
  const data = await request.validate(req)

  const user = await User.create(data)
  return res.status(201).json({ data: user })
})
```

---

## API Reference

| Export | Kind | Description |
|---|---|---|
| `validate` | Function | `(schema: ZodSchema, req: ForgeRequest) => Promise<T>` — validates the merged request input and returns the parsed, typed data. |
| `validateWith` | Function | `(schema: ZodSchema) => MiddlewareHandler` — returns a middleware that validates and attaches `req.body`. |
| `FormRequest` | Abstract class | Base class for encapsulating validation rules and authorisation logic. |
| `ValidationError` | Class | Thrown when validation fails. Contains the raw Zod issues and a `flatten()` helper. |
| `z` | Re-export | Full Zod namespace — same as `import { z } from 'zod'`. Saves a separate Zod install for most cases. |

---

## ValidationError

`ValidationError` is thrown by `validate()`, `validateWith()`, and `FormRequest.validate()` when the input does not satisfy the schema. It extends `Error`.

```ts
import { ValidationError } from '@forge/validation'

try {
  const data = await validate(schema, req)
} catch (err) {
  if (err instanceof ValidationError) {
    // err.errors — ZodIssue[] — raw Zod issues
    // err.flatten() — { formErrors: string[], fieldErrors: Record<string, string[]> }
    return res.status(422).json({ errors: err.flatten().fieldErrors })
  }
  throw err
}
```

### ValidationError Shape

| Property / Method | Type | Description |
|---|---|---|
| `errors` | `ZodIssue[]` | The raw array of Zod validation issues. |
| `flatten()` | `() => { formErrors: string[], fieldErrors: Record<string, string[]> }` | Formats issues into a flat structure suitable for API error responses. |

---

## Notes

- `validate()` and `FormRequest.validate()` merge `req.body`, `req.query`, and `req.params` into a single object before running the schema. This means you can validate path parameters and query strings in the same schema as the request body.
- `FormRequest.authorize()` defaults to returning `true`. Override it to add permission checks. When `authorize()` returns `false`, a `403 Forbidden` error is raised before validation even runs.
- The re-exported `z` is the same Zod instance as a direct `import { z } from 'zod'`. There is no version conflict.
- `sideEffects: false` — fully tree-shakable.
