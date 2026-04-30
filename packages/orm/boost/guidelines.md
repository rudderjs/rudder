# @rudderjs/orm

## Overview

Eloquent-inspired ORM for RudderJS. Provides a `Model` base class with static query methods, attribute casting, accessors/mutators, soft deletes, observers, scopes, API resources (`JsonResource`), model collections, and factories. The ORM is adapter-based -- the actual database driver (e.g. Prisma) is registered via `ModelRegistry.set(adapter)` in a service provider.

## Key Patterns

### Defining Models

```ts
import { Model, Attribute } from '@rudderjs/orm'

export class Post extends Model {
  static table = 'posts'
  static fillable = ['title', 'body', 'userId']
  static hidden = ['deletedAt']
  static softDeletes = true

  static casts = {
    isPublished: 'boolean',
    metadata:    'json',
    createdAt:   'datetime',
  } as const satisfies Record<string, CastDefinition>

  id!:          number
  title!:       string
  body!:        string
  userId!:      number
  isPublished!: boolean
  metadata!:    Record<string, unknown>
  createdAt!:   Date
  updatedAt!:   Date
  deletedAt!:   Date | null
}
```

Table name defaults to lowercase class name + `s` if `static table` is omitted.

### Relationships

Relationships are loaded via the query builder's `with()` method. The adapter resolves relation names to the underlying DB joins/includes.

```ts
const user = await User.with('posts', 'profile').find(1)
const posts = await Post.with('author', 'comments').where('isPublished', true).get()
```

### Querying

All query methods are static on the Model class and return a chainable `QueryBuilder`:

```ts
const user  = await User.find(1)                       // by primary key
const users = await User.all()                          // all records
const admin = await User.where('role', 'admin').first() // first match

// Chained queries
const recent = await Post
  .where('isPublished', true)
  .orderBy('createdAt', 'DESC')
  .limit(10)
  .get()

// Pagination
const page = await User.query().paginate(1, 15)
// => { data: [...], total, page, perPage, lastPage }

// Operators
const expensive = await Product.where('price', '>', 100).get()

// Soft deletes (when static softDeletes = true)
const withDeleted = await Post.query().withTrashed().get()
const onlyDeleted = await Post.query().onlyTrashed().get()
await Post.restore(id)
await Post.forceDelete(id)
```

### Hydrated instances

Every read path (`find`/`first`/`all`/`paginate`/`where(...).first()`/`where(...).get()`/`create`/`update`/`restore`/`firstOrCreate`/`updateOrCreate`) returns Model instances — not plain records. Instance methods you define on the class work directly:

```ts
class User extends Model {
  isAdmin() { return this.role === 'admin' }
}

const user = await User.find(id)
if (user?.isAdmin()) { /* ... */ }
```

The base Model ships with persistence + identity instance methods:

```ts
const user = await User.find(id)

user.fill({ name: 'New' })          // mass-assign without persisting (filtered by `fillable`)
user.forceFill({ role: 'admin' })   // mass-assign WITHOUT the filter (trusted source)
await user.save()                   // insert if no PK; otherwise update
await user.refresh()                // re-read row + replace fields in place
await user.delete()                 // soft-delete or hard-delete based on softDeletes
const draft = user.replicate()      // unsaved clone (drops PK + timestamps)
user.is(other)                      // identity by table + PK
user.trashed()                      // true if deletedAt is set
```

`Model.hydrate(record)` wraps a plain record (cached JSON, fixture) into a Model instance.

### Mass assignment

`static fillable` (allowlist) and `static guarded` (denylist; `['*']` locks all) are enforced on `Model.create()`, `Model.update()`, and `instance.fill()` — keys outside the policy are silently dropped. Both default to `[]` (no enforcement). `fillable` wins when both set.

```ts
class User extends Model {
  static fillable = ['name', 'email']
}

await User.create({ name: 'A', email: 'a@x.com', isAdmin: true })  // isAdmin dropped
```

Bypass paths:
- `instance.forceFill(data)` — skip the filter (factories, internal sync, fixtures).
- `instance.save()` after direct property assignment — `user.role = 'admin'; await user.save()` works regardless of `fillable`.

**Heads-up for `firstOrCreate(attrs, values)`:** `attrs` go through `create()` so lookup keys must be in `fillable` too — otherwise the lookup column won't be set on the new row.

### Counters: increment / decrement

For counter columns, use the atomic `increment`/`decrement` instead of read-modify-write:

```ts
await Post.increment(postId, 'viewCount')                            // +1, atomic SQL
await Post.increment(postId, 'viewCount', 5)                         // +5
await User.decrement(userId, 'credits', 10, { lastSeen: new Date() }) // with extras

// Instance variant — merges new value back so post.viewCount reflects it
await post.increment('viewCount')
```

**Caveat:** `increment`/`decrement` deliberately do NOT fire `updating`/`updated`/`saving`/`saved` observers. Counter updates are a pure data-plane operation. If you need observer hooks, read the row, compute the resolved value, and call `Model.update()` instead.

### firstOrCreate / updateOrCreate

```ts
// Find by email; if missing, create with attrs + values merged
const user = await User.firstOrCreate(
  { email: 'a@x.com' },
  { name: 'Alice', role: 'user' },
)

// Find by email; if found update with values, else create with merge
const user = await User.updateOrCreate(
  { email: 'a@x.com' },
  { name: 'Alice', role: 'admin' },
)
```

`firstOrCreate` filters by all keys in the first argument; the second is only used on create. `updateOrCreate` always writes the second argument. Both go through `Model.create()`/`Model.update()`, so `fillable` applies (lookup attrs must be fillable).

### Scopes

```ts
class Post extends Model {
  static scopes = {
    published: (query) => query.where('isPublished', true),
    byAuthor:  (query, userId: number) => query.where('userId', userId),
  }
  static globalScopes = {
    active: (query) => query.where('deletedAt', null),
  }
}

// Usage
const posts = await Post.query().scope('published').scope('byAuthor', 42).get()
const all   = await Post.query().withoutGlobalScope('active').get()
```

### Accessors & Casts

Built-in casts: `string`, `integer`, `float`, `boolean`, `date`, `datetime`, `json`, `array`, `encrypted`.

```ts
import { Attribute } from '@rudderjs/orm'

class User extends Model {
  static casts = { isAdmin: 'boolean', settings: 'json' }

  static attributes = {
    firstName: Attribute.make({
      get: (v) => String(v).charAt(0).toUpperCase() + String(v).slice(1),
    }),
    fullName: Attribute.make({
      get: (_, attrs) => `${attrs['firstName']} ${attrs['lastName']}`,
    }),
    password: Attribute.make({
      set: async (v) => await bcrypt.hash(String(v), 10),
    }),
  }

  static appends = ['fullName']
}
```

Decorators are also available: `@Hidden`, `@Visible`, `@Appends`, `@Cast('boolean')`.

### API Resources

```ts
import { JsonResource } from '@rudderjs/orm'

class UserResource extends JsonResource<User> {
  toArray() {
    return {
      id:    this.resource.id,
      name:  this.resource.name,
      email: this.resource.email,
      admin: this.when(this.resource.role === 'admin', true),
      posts: this.whenLoaded('posts'),
      ...this.mergeWhen(this.resource.role === 'admin', {
        permissions: this.resource.permissions,
      }),
    }
  }
}

// Single resource
res.json(new UserResource(user).toArray())

// Collection with pagination meta
res.json(await UserResource.collection(users, { total: 100, page: 1 }).toResponse())
```

### Factories

```ts
import { ModelFactory, sequence } from '@rudderjs/orm'

class UserFactory extends ModelFactory<{ name: string; email: string; role: string }> {
  protected modelClass = User

  definition() {
    return {
      name:  'Alice',
      email: sequence(i => `user${i}@example.com`)(),
      role:  'user',
    }
  }

  protected states() {
    return {
      admin: () => ({ role: 'admin' }),
    }
  }
}

const user  = await UserFactory.new().create()
const admin = await UserFactory.new().state('admin').create()
const users = await UserFactory.new().create(5)
const dto   = await UserFactory.new().make()  // no DB write
```

### Observers

```ts
class UserObserver {
  creating(data: Record<string, unknown>) {
    data['slug'] = slugify(data['name'] as string)
    return data
  }
  created(record: Record<string, unknown>) {
    console.log('User created:', record['id'])
  }
}

User.observe(UserObserver)

// Or inline event listeners
User.on('updating', (id, data) => { data['updatedAt'] = new Date() ; return data })
```

### ModelRegistry

Tracks registered Model classes for discovery by framework components (Telescope's model collector, etc).

```ts
import { ModelRegistry } from '@rudderjs/orm'

// Adapter registration (done by the database provider)
ModelRegistry.set(adapter)

// Eager model registration — preferred for models you want observed before
// the first query fires. Do this in AppServiceProvider.boot().
ModelRegistry.register(User)
ModelRegistry.register(Post)

// Lazy auto-registration — models are also registered on first query()
// or first find()/all()/first()/where()/count()/paginate() call.

// Iteration
for (const [name, ModelClass] of ModelRegistry.all()) { /* ... */ }

// Subscribe to future registrations (returns unsubscribe fn)
const stop = ModelRegistry.onRegister((name, cls) => { /* ... */ })
stop()
```

## Common Pitfalls

- **No adapter registered**: You must call `ModelRegistry.set(adapter)` in a service provider before using any Model. The `DatabaseServiceProvider` must come before providers that query models.
- **Forgotten `static table`**: Without it, table name is auto-derived as `lowercase(ClassName) + 's'` (e.g. `User` -> `users`). Set it explicitly if your table name differs.
- **Casts not applied on write**: Casts transform values in both directions. If you bypass `Model.create()`/`Model.update()` and write directly via the adapter, casts and mutators are skipped.
- **Appends without accessor**: Adding a field to `static appends` has no effect unless it also has a `get` function in `static attributes`.
- **`encrypted` casts need `@rudderjs/crypt`**: The `encrypted`, `encrypted:array`, and `encrypted:object` casts require `@rudderjs/crypt` as a peer dependency.

## Key Imports

```ts
import {
  Model,
  Attribute,
  JsonResource,
  ResourceCollection,
  ModelCollection,
  ModelFactory,
  sequence,
  ModelRegistry,
  Hidden,
  Visible,
  Appends,
  Cast,
} from '@rudderjs/orm'

import type {
  QueryBuilder,
  PaginatedResult,
  CastDefinition,
  CastUsing,
  ModelEvent,
  ModelObserver,
} from '@rudderjs/orm'
```
