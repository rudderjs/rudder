# @boostkit/support

Shared utility primitives for collections, env access, config lookup, and helper functions.

## Installation

```bash
pnpm add @boostkit/support
```

## Usage

```ts
import { Collection, Env, defineEnv, pick, omit } from '@boostkit/support'
import { z } from 'zod'

const users = new Collection([{ id: 1 }, { id: 2 }])
const ids = users.map(u => u.id).toArray()

const port = Env.getNumber('PORT', 3000)
const env = defineEnv(z.object({ APP_ENV: z.string() }))

const safe = pick({ id: 1, name: 'A', secret: 'x' }, ['id', 'name'])
const redacted = omit({ id: 1, secret: 'x' }, ['secret'])
```

## API Reference

- `Collection<T>`
- `Env`
- `sleep`, `ucfirst`, `toSnakeCase`, `toCamelCase`, `isObject`, `deepClone`, `pick`, `omit`, `tap`
- `ConfigRepository`, `setConfigRepository`, `config`
- `resolveOptionalPeer`
- `defineEnv`
- `z` — import directly from `zod`; `defineEnv` accepts any `ZodRawShape`

## Configuration

This package has no runtime config object.

## Notes

- `defineEnv` validates `process.env` against a Zod schema and throws on invalid values.
- `resolveOptionalPeer()` resolves optional package integrations from the app root.
