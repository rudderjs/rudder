# @boostkit/validation

Zod-powered request validation primitives with form-request and middleware helpers.

## Installation

```bash
pnpm add @boostkit/validation
```

## Usage

```ts
import { FormRequest, validateWith, z } from '@boostkit/validation'

class CreateUserRequest extends FormRequest {
  rules() {
    return z.object({ email: z.string().email(), name: z.string().min(1) })
  }
}

const requireCreateUser = validateWith(
  z.object({ email: z.string().email(), name: z.string().min(1) })
)
```

## API Reference

- `ValidationError`
- `FormRequest<T extends ZodType>`
- `validate(schema, req)`
- `validateWith(schema)`
- `z` (re-export)

## Configuration

This package has no runtime config object.

## Notes

- `FormRequest.validate()` merges `body`, `query`, and `params` before parsing.
- `authorize()` can be overridden to block validation with an auth error.
