# CRUD and Observers

## Create / update / delete

```ts
// Create — triggers creating / created observer events
const post = await Post.create({ title: 'Hello', body: 'World', authorId: 1 })

// Update — triggers updating / updated
const updated = await Post.update(post.id, { title: 'Hello v2' })

// Delete — triggers deleting / deleted
await Post.delete(post.id)
```

Mass assignment (`fillable` / `guarded`) filters keys on all three. To bypass: `instance.forceFill(data)` or set properties directly and call `instance.save()`.

## firstOrCreate / updateOrCreate

```ts
const tag = await Tag.firstOrCreate({ name: 'rust' }, { description: 'systems language' })
// SELECT, then INSERT if not found

const user = await User.updateOrCreate({ email }, { name, lastSeenAt: new Date() })
// SELECT, then INSERT or UPDATE
```

⚠️ Lookup keys (the first arg) go through `create()`, so they need to be **fillable** too — otherwise the lookup column isn't set on the new row.

## Atomic counters

For columns that change in concurrent writes (view counts, balances):

```ts
await Post.increment(postId, 'viewCount')           // viewCount = viewCount + 1
await Post.decrement(postId, 'stock', 5)            // stock     = stock     - 5

// Instance variant merges the resolved value back
await post.increment('viewCount')                   // post.viewCount reflects the update
```

**Observers do NOT fire** on increment/decrement — they're pure data-plane. If you need observer hooks, read the row, set the resolved value, and call `Model.update()` instead.

## Observers

```ts
import type { ModelObserver } from '@rudderjs/orm'

class PostObserver implements ModelObserver {
  creating(data: Record<string, unknown>) {
    data['slug'] = slugify(String(data['title']))
    return data
  }

  deleted(id: string | number) {
    console.log(`Post ${id} was deleted`)
  }
}

Post.observe(PostObserver)
```

Inline listeners are also supported:

```ts
Post.on('creating', (data) => {
  data['slug'] = slugify(String(data['title']))
  return data
})
```

Events fired by lifecycle: `retrieved`, `creating` → `created`, `updating` → `updated`, `saving` → `saved` (on both create + update), `deleting` → `deleted`, `restoring` → `restored`.

## Soft delete + restore

```ts
class Post extends Model { static softDeletes = true }

await Post.delete(id)         // sets deletedAt
await Post.restore(id)        // clears deletedAt — fires restoring / restored
await Post.forceDelete(id)    // hard delete — fires deleting / deleted with no soft-delete
```

## Pitfalls

❌ **Don't** rely on observers firing for `query().create()`:

```ts
await Post.query().create({ title })   // bypasses observers
```

✅ **Do** use the static method for observer-aware writes:

```ts
await Post.create({ title })           // fires creating / created
```

❌ **Don't** expect observers on counter updates:

```ts
class Post extends Model {
  static observe = class {
    updated(post: Post) { /* won't fire for increment() */ }
  }
}
```

✅ **Do** read + write through `update()` if you need hooks:

```ts
const post = await Post.find(id)
await Post.update(id, { viewCount: post.viewCount + 1 })   // fires updating / updated
```

❌ **Don't** rely on lookup keys being set if they're not fillable:

```ts
class Tag extends Model {
  static fillable = ['description']    // no 'name'
}
await Tag.firstOrCreate({ name: 'rust' }, { description: 'lang' })   // name dropped → new row missing name
```

✅ **Do** include lookup keys in `fillable`:

```ts
class Tag extends Model {
  static fillable = ['name', 'description']
}
```
