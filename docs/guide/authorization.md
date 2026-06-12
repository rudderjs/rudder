# Authorization

Once a user is authenticated, **authorization** is the question of whether they're allowed to perform a specific action on a specific resource. Rudder ships two complementary tools: **gates** (for one-off abilities) and **policies** (for grouping abilities by resource type). Both live in `@rudderjs/auth`.

## Gates

A gate is a named ability with a check function that returns a boolean:

```ts
import { Gate } from '@rudderjs/auth'

// In a service provider's boot()
Gate.define('edit-post',   (user, post: Post) => user.id === post.authorId)
Gate.define('delete-post', (user, post: Post) => user.id === post.authorId || user.role === 'admin')
```

Use the gate in a handler:

```ts
import { Gate } from '@rudderjs/auth'

Route.put('/posts/:id', async (req) => {
  const post = await Post.find(req.params.id)
  await Gate.authorize('edit-post', post)        // throws AuthorizationError → 403

  return Post.update(post.id, req.body)
})
```

`Gate.authorize()` throws `AuthorizationError` (rendered as 403) if the check returns false. For non-throwing checks use `Gate.allows()` / `Gate.denies()`:

```ts
if (await Gate.allows('edit-post', post)) {
  // show the edit button
}
```

### Before hooks

`Gate.before(fn)` runs before any gate check — useful for an admin override:

```ts
Gate.before((user, ability) => user.role === 'admin' ? true : undefined)
```

Returning `true` short-circuits and authorizes; returning `undefined` (or nothing) lets the regular gate run; returning `false` denies.

### Scoping to a user

By default gates run against the current authenticated user. To check a specific user (impersonation, batch jobs) use `Gate.forUser(...)`:

```ts
const ok = await Gate.forUser(targetUser).allows('edit-post', post)
```

## Policies

A policy is a class whose method names match ability names — cleaner when one model has many abilities. Each method receives `(user, model)` and returns a boolean (or a promise of one):

```ts
import { Policy } from '@rudderjs/auth'
import type { Authenticatable } from '@rudderjs/auth'

class PostPolicy extends Policy {
  before(user: Authenticatable) {
    return user.role === 'admin' ? true : undefined
  }

  view(user: Authenticatable, post: Post)   { return post.published || user.id === post.authorId }
  create(user: Authenticatable)             { return user.emailVerifiedAt !== null }
  update(user: Authenticatable, post: Post) { return user.id === post.authorId }
  delete(user: Authenticatable, post: Post) { return user.id === post.authorId }
}
```

Register it in a provider:

```ts
import { Gate } from '@rudderjs/auth'
import { Post } from '../app/Models/Post.js'
import { PostPolicy } from './PostPolicy.js'

Gate.policy(Post, PostPolicy)
```

Once registered, the gate API resolves the right policy automatically based on the resource type:

```ts
await Gate.authorize('update', post)    // → PostPolicy.update(user, post)
await Gate.authorize('view', post)      // → PostPolicy.view(user, post)
```

You don't need a matching `Gate.define()` — the policy class registration is enough.

## Authorization errors

`Gate.authorize()` and policy denials throw `AuthorizationError`. The framework's exception handler renders this as 403 by default. Override the rendering for a custom shape:

```ts
// bootstrap/app.ts
import { AuthorizationError } from '@rudderjs/auth'

.withExceptions((e) => {
  e.render(AuthorizationError, (err, req) =>
    Response.json({ ok: false, reason: err.message }, { status: 403 }),
  )
})
```

For the broader exception model, see [Error Handling](/guide/error-handling).

## Composing with route middleware

Authorization usually pairs with `RequireAuth()` — first prove who the user is, then check what they can do:

```ts
Route.put('/posts/:id', updateHandler, [RequireAuth()])

async function updateHandler(req, res) {
  const post = await Post.find(req.params.id)
  await Gate.authorize('update', post)
  // ...
}
```

For pages where only the *display* changes based on permissions (showing / hiding an Edit button), call `Gate.allows()` inside the controller and pass the boolean as a prop.

## Where to put gate definitions

Most apps consolidate gate and policy registrations in a single `AuthServiceProvider`:

```ts
import { ServiceProvider } from '@rudderjs/core'
import { Gate } from '@rudderjs/auth'
import { Post } from '../Models/Post.js'
import { PostPolicy } from '../Policies/PostPolicy.js'

export class AuthServiceProvider extends ServiceProvider {
  async boot() {
    Gate.before((user, ability) => user.role === 'admin' ? true : undefined)
    Gate.policy(Post, PostPolicy)
    Gate.define('settings.edit', (user) => user.role === 'owner')
  }
}
```

Generate the stub with `pnpm rudder make:provider Auth`.

## Pitfalls

- **Defining gates outside `boot()`.** Defining at the top level of a route file works in dev but order is fragile. Put gate definitions in a provider's `boot()` so they're guaranteed to run before any request hits the gate.
- **`Gate.authorize()` not throwing.** The check returned a truthy value, or there's no registered gate / policy for the ability. `Gate.authorize()` denies (throws) only when the check explicitly returns falsy. Unknown abilities also deny.
- **Async checks.** Both gates and policy methods may return `Promise<boolean>` — the framework awaits them. Prefer sync checks when possible (less to mock in tests).
