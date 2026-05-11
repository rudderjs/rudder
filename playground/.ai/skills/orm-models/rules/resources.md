# API Resources

`JsonResource` is the controller-friendly way to shape model output for an HTTP response — without leaking columns that shouldn't reach the client.

## Single resource

```ts
import { JsonResource } from '@rudderjs/orm'

class UserResource extends JsonResource<User> {
  toArray() {
    return {
      id:    this.resource.id,
      name:  this.resource.name,
      email: this.resource.email,
    }
  }
}

// In a route handler
res.json(new UserResource(user).toArray())
```

## Conditional fields

```ts
class UserResource extends JsonResource<User> {
  toArray() {
    return {
      id:    this.resource.id,
      name:  this.resource.name,

      // Include only when condition is true
      admin: this.when(this.resource.role === 'admin', true),

      // Include only when the relation was eager-loaded
      posts: this.whenLoaded('posts', PostResource.collection(this.resource.posts)),

      // Merge multiple fields conditionally
      ...this.mergeWhen(this.resource.isAdmin, {
        permissions: this.resource.permissions,
        lastLogin:   this.resource.lastLoginAt,
      }),
    }
  }
}
```

`whenLoaded` is the canonical guard against N+1 — the field stays absent if the caller didn't `.with('posts')`.

## Collections

```ts
const users = await User.with('posts').all()

const collection = UserResource.collection(users, {
  total:   100,
  page:    1,
  perPage: 15,
})

res.json(await collection.toResponse())
// {
//   data: [...],
//   meta: { total: 100, page: 1, perPage: 15 }
// }
```

For a paginated query:

```ts
const page = await User.paginate(1, 15)
const collection = UserResource.collection(page.data, {
  total:    page.total,
  page:     page.page,
  perPage:  page.perPage,
  lastPage: page.lastPage,
})
```

## Pitfalls

❌ **Don't** assume `whenLoaded` works without `.with()`:

```ts
const user = await User.find(1)        // posts NOT loaded
const res  = new UserResource(user).toArray()
// res.posts is omitted — that's correct, but the caller may have expected it
```

✅ **Do** eager-load when the resource needs the relation:

```ts
const user = await User.with('posts').find(1)
const res  = new UserResource(user).toArray()
// res.posts is present
```

❌ **Don't** use `when` for relations:

```ts
posts: this.when(this.resource.posts !== undefined, PostResource.collection(this.resource.posts))
```

✅ **Do** use `whenLoaded` — it's the relation-aware variant:

```ts
posts: this.whenLoaded('posts', PostResource.collection(this.resource.posts))
```

❌ **Don't** mutate `this.resource` inside `toArray()` — observers / mutators won't fire and you risk a stale state on the next access. Compute derived values and return them; don't write to the model.
