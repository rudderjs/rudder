# API Resources

An API resource is a transformation layer between your models and the JSON your API returns — shape the payload per endpoint without leaking columns that should never reach the client. `JsonResource` and `ResourceCollection` ship in `@rudderjs/orm`; no extra package.

```ts
import { JsonResource } from '@rudderjs/orm'
import { Post } from 'App/Models/Post.js'

export class PostResource extends JsonResource<Post> {
  toArray() {
    return {
      id:    this.resource.id,
      title: this.resource.title,
    }
  }
}
```

Generate stubs with `pnpm rudder make:resource Post` — writes `app/Resources/PostResource.ts` with the model import inferred from the name.

## Single resources

`toArray()` is the bare payload; `toResponse()` is the opt-in `{ data: ... }` envelope:

```ts
Route.get('/api/posts/:id', async (req, res) => {
  const post = await Post.findOrFail(req.params.id)

  return res.json(new PostResource(post).toArray())
  // → { id: 1, title: '...' }

  return res.json(await post.toResource().toResponse())
  // → { data: { id: 1, title: '...' } }
})
```

## Collections and pagination

`Resource.collection()` accepts a plain array — or a paginator result directly, which derives the envelope `meta` for you:

```ts
// Plain array — no meta
res.json(await PostResource.collection(await Post.all()).toResponse())
// → { data: [...] }

// Offset pagination — meta derived from the paginator
res.json(await PostResource.collection(await Post.paginate(1, 15)).toResponse())
// → { data: [...], meta: { total, page, perPage, lastPage } }

// Cursor pagination
res.json(await PostResource.collection(await Post.cursorPaginate(15)).toResponse())
// → { data: [...], meta: { perPage, nextCursor, prevCursor, hasMore } }
```

An explicit `meta` second argument merges over (wins against) the derived values:

```ts
PostResource.collection(page, { page: clientPage, source: 'archive' })
```

## `additional()` — extra envelope keys

Merge extra top-level keys into the envelope — alongside `data`/`meta`, never inside them. Works on both single resources and collections; the envelope's own `data`/`meta` keys win on conflict:

```ts
res.json(
  await PostResource.collection(await Post.paginate(1, 15))
    .additional({ status: 'ok' })
    .toResponse(),
)
// → { status: 'ok', data: [...], meta: { ... } }
```

## Binding resources to models

Set `static resourceClass` once and wrap from the instance — mirrors how `static factoryClass` wires factories:

```ts
class Post extends Model {
  static resourceClass = PostResource
}

post.toResource()                      // ≡ new PostResource(post)
post.toResource(AdminPostResource)    // explicit class wins

import { ModelCollection } from '@rudderjs/orm'
const posts = ModelCollection.wrap(await Post.all())
res.json(await posts.toResourceCollection().toResponse())
```

Unbound and no class passed → a clear error pointing at both options. There is deliberately no name-convention auto-discovery.

## Conditional attributes

All helpers are `protected` — call them inside `toArray()`. Missing values resolve to `undefined`, which `JSON.stringify` drops from the output.

```ts
class PostResource extends JsonResource<Post> {
  toArray() {
    return {
      id:    this.resource.id,
      title: this.resource.title,

      // Include only when the condition is true
      editUrl: this.when(isAdmin, `/admin/posts/${this.resource.id}`),

      // Include only when the value is not null/undefined (fn receives it non-null)
      publishedAt: this.whenNotNull(this.resource.publishedAt, d => d.toISOString()),

      // Include only when the attribute is present on the instance —
      // covers partial-select hydration
      body: this.whenHas('body'),

      // Include only when the relation was eager-loaded (the N+1 guard)
      comments: this.whenLoaded('comments', CommentResource.collection(this.resource.comments as Comment[])),

      // Include only when withCount('comments') stamped it; a loaded 0 is included
      commentsCount: this.whenCounted('comments'),

      // Generalized: reads the deterministic alias stamped by withSum/withMin/…
      totalViews: this.whenAggregated('comments', 'sum', 'views'),   // reads commentsSumViews

      // Merge a block of keys conditionally — spread the result
      ...this.mergeWhen(isAdmin, {
        internalNotes: this.resource.internalNotes,
      }),
    }
  }
}
```

`whenCounted` / `whenAggregated` read the camelCase aliases the aggregate loader stamps (`commentsCount`, `commentsSumViews`, `commentsExists`) — see [aggregate eager loading](/guide/database/models#aggregate-eager-loading). Pass an `.as(...)` alias prefix as the relation name when the query used one.

> **`whenPivotLoaded`** (Laravel's pivot-column conditional) is not implemented — this ORM deliberately doesn't surface pivot columns on many-to-many reads in v1. It's gated on pivot-column reads landing first.

## Async `toArray()`

`toArray()` may be async — but then `JSON.stringify(resource)` (which calls `toJSON()`) throws with a pointer instead of serializing a pending Promise. Await explicitly:

```ts
class SignedResource extends JsonResource<Doc> {
  async toArray() {
    return { id: this.resource.id, url: await signUrl(this.resource.path) }
  }
}

res.json(await resource.toArray())      // bare payload
res.json(await resource.toResponse())   // { data: ... } envelope — also async-safe
```

Collections are always awaited — `collection(...).toResponse()` resolves every item's `toArray()` in parallel.
