# Gates and Policies

`Gate` is the imperative authorization API; `Policy` classes group abilities per model.

## Define abilities

```ts
import { Gate } from '@rudderjs/auth'

Gate.define('manage-settings', (user) => user.role === 'admin')
Gate.define('edit-post',       (user, post) => post.authorId === user.getAuthIdentifier())
```

## Check in route handlers

```ts
// Returns boolean
if (await Gate.allows('manage-settings')) { /* ... */ }
if (await Gate.denies('edit-post', post)) { /* ... */ }

// Throws 403 on denial
await Gate.authorize('edit-post', post)
```

`authorize` throws `AuthorizationError` which the framework maps to a `403` response.

## Before callback

Runs before every gate check — useful for super-admins:

```ts
Gate.before((user, ability) => {
  if (user.role === 'super-admin') return true   // allow everything
  return null                                     // fall through to normal checks
})
```

Return `true` to allow, `false` to deny, `null` to fall through.

## Model policies

```ts
import { Policy } from '@rudderjs/auth'
import type { Authenticatable } from '@rudderjs/auth'

class PostPolicy extends Policy {
  before(user: Authenticatable) {
    if ((user as { role?: string }).role === 'admin') return true
    return null
  }

  view(user: Authenticatable, post: Post) {
    return post.isPublished || post.authorId === user.getAuthIdentifier()
  }

  update(user: Authenticatable, post: Post) {
    return post.authorId === user.getAuthIdentifier()
  }

  delete(user: Authenticatable, post: Post) {
    return post.authorId === user.getAuthIdentifier()
  }
}

Gate.policy(Post, PostPolicy)
```

Method names on the policy class match ability names. `Gate.authorize('update', post)` looks up `PostPolicy.update(user, post)`.

## Pitfalls

❌ **Don't** call `Gate.authorize` outside an auth context expecting it to throw 401:

```ts
// In a job — no auth context, user is null, gate throws AuthorizationError as 403
await Gate.authorize('edit-post', post)
```

✅ **Do** check authentication first or scope the gate explicitly:

```ts
await Gate.forUser(user).authorize('edit-post', post)
```

❌ **Don't** rely on policy autoloading from disk:

```ts
// Putting app/Policies/PostPolicy.ts on disk does NOT auto-register it
```

✅ **Do** register policies in a service provider's `boot()`:

```ts
// app/Providers/AppServiceProvider.ts
boot() {
  Gate.policy(Post, PostPolicy)
}
```

❌ **Don't** return non-boolean from a `define` callback expecting it to count:

```ts
Gate.define('edit-post', (user, post) => post.authorId)   // truthy number, but not boolean
```

✅ **Do** return a boolean explicitly:

```ts
Gate.define('edit-post', (user, post) => post.authorId === user.getAuthIdentifier())
```
