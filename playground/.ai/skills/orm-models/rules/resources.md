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

      // Include only when the attribute is present (partial-select hydration)
      email: this.whenHas('email'),

      // Include only when the relation was eager-loaded
      posts: this.whenLoaded('posts', PostResource.collection(this.resource.posts)),

      // Include only when withCount('posts') stamped it (a loaded 0 is included)
      postsCount: this.whenCounted('posts'),

      // Generalized aggregate: reads postsSumViews from withSum('posts', 'views')
      totalViews: this.whenAggregated('posts', 'sum', 'views'),

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

res.json(await UserResource.collection(users).toResponse())
// { data: [...] }
```

For a paginated query, pass the paginator result directly — `meta` is derived:

```ts
res.json(await UserResource.collection(await User.paginate(1, 15)).toResponse())
// { data: [...], meta: { total, page, perPage, lastPage } }

res.json(await UserResource.collection(await User.cursorPaginate(15)).toResponse())
// { data: [...], meta: { perPage, nextCursor, prevCursor, hasMore } }
```

An explicit `meta` second argument merges over the derived values. Don't hand-build meta from the paginator fields — `collection(page.data, { total: page.total, ... })` is the old pattern; passing the paginator itself replaces it.

## Envelopes — `toResponse()` / `additional()`

`toResponse()` wraps a single resource as `{ data: ... }` (async-safe — `JSON.stringify(resource)` throws if `toArray()` is async). `additional()` merges extra TOP-LEVEL keys alongside `data`/`meta` on both single resources and collections:

```ts
res.json(await new UserResource(user).additional({ status: 'ok' }).toResponse())
// { status: 'ok', data: { ... } }
```

## Binding — `static resourceClass` + `toResource()`

```ts
class User extends Model {
  static resourceClass = UserResource
}

res.json(await user.toResource().toResponse())              // ≡ new UserResource(user)
res.json(await user.toResource(AdminUserResource).toResponse())  // explicit wins

const users = ModelCollection.wrap(await User.all())
res.json(await users.toResourceCollection().toResponse())
```

Unbound + no class argument throws a pointer error. Keep the resource file's model import **type-only** (`import type { User }`) so the model's runtime import of the resource stays cycle-free.

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
