# Provider Setup

## Install dependencies

```bash
pnpm add @rudderjs/auth @rudderjs/session @rudderjs/hash
```

Both `@rudderjs/session` and `@rudderjs/hash` are **required peer dependencies**.

## Configure (`config/auth.ts`)

```ts
import { User } from '../app/Models/User.js'
import type { AuthConfig } from '@rudderjs/auth'

export default {
  defaults: {
    guard: 'web',
  },
  guards: {
    web: {
      driver:   'session',
      provider: 'users',
    },
  },
  providers: {
    users: {
      driver: 'eloquent',
      model:  User,
    },
  },
} satisfies AuthConfig
```

## Register the provider (`bootstrap/providers.ts`)

`AuthProvider` is auto-discovered via `defaultProviders()` — nothing manual to add:

```ts
import { defaultProviders } from '@rudderjs/core'

export default [
  ...(await defaultProviders()),
  // … your app providers
]
```

## Make the User model authenticatable

```ts
import { Model, Hidden } from '@rudderjs/orm'
import type { Authenticatable } from '@rudderjs/auth'

export class User extends Model implements Authenticatable {
  static fillable = ['name', 'email', 'password']

  @Hidden password = ''

  getAuthIdentifier(): string  { return String(this.id) }
  getAuthPassword():   string  { return this.password }
  getRememberToken(): string | null { return null }
  setRememberToken(_t: string): void {}
}
```

The `@Hidden` decorator keeps `password` out of `toJSON()` output. The `EloquentUserProvider` calls `hashCheck()` (from `@rudderjs/hash`) on `getAuthPassword()`.

## Pitfalls

❌ **Don't** register `AuthProvider` before `HashProvider` / `SessionProvider`:

```ts
export default [
  AuthProvider,       // boots before HashProvider — throws on first hash check
  HashProvider,
  SessionProvider,
]
```

✅ **Do** use `defaultProviders()` — it orders the foundation/infrastructure stages correctly:

```ts
export default [...(await defaultProviders())]
```

❌ **Don't** add `AuthMiddleware` globally via `m.use()`:

```ts
.withMiddleware((m) => {
  m.use(AuthMiddleware())   // crashes api routes — no session context
})
```

✅ **Do** let `AuthProvider.boot()` auto-install it on the `web` group only:

```ts
// Nothing to do — AuthProvider handles it. For api auth, use RequireBearer()
// + scope(...) from @rudderjs/passport per-route.
```

❌ **Don't** cache `SessionGuard` instances inside `AuthManager` (legacy `_guards` Map):

The manager is a DI singleton; cached guards leak `_user` across requests. The fix is already in place — don't reintroduce.
