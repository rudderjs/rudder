---
name: orm-models
description: Creating Eloquent-style models, queries, relationships, casts, factories, and API resources in RudderJS
---

# ORM Models

## When to use this skill

Load this skill when you need to create or modify ORM models, write database queries, define casts/accessors/mutators, build model factories for testing, or create JSON API resources.

## Key concepts

- **Model base class**: All models extend `Model` from `@rudderjs/orm`. The ORM is adapter-based -- `ModelRegistry.set(adapter)` plugs in the actual DB driver (e.g. Prisma).
- **Table naming**: Defaults to lowercase class name + `'s'` (e.g. `User` -> `users`). Override with `static table = 'my_table'`.
- **Primary key**: Defaults to `'id'`. Override with `static primaryKey = 'uuid'`.
- **Soft deletes**: Set `static softDeletes = true` to make `delete()` set `deletedAt` instead of removing the row.
- **Decorators**: `@Hidden`, `@Visible`, `@Appends`, `@Cast` configure serialization on instance properties.
- **Adapter pattern**: The ORM has no runtime DB dependency. The adapter (Prisma, Drizzle, etc.) is registered at boot time.

## Step-by-step

### 1. Define a model

```ts
import { Model, Hidden, Cast, Attribute } from '@rudderjs/orm'

export class Post extends Model {
  static table = 'posts'
  static fillable = ['title', 'body', 'authorId']
  static hidden = ['internalNotes']

  static casts = {
    isPublished: 'boolean' as const,
    publishedAt: 'datetime' as const,
    metadata:    'json' as const,
  }

  static attributes = {
    excerpt: Attribute.make({
      get: (_, attrs) => String(attrs['body'] ?? '').slice(0, 200),
    }),
  }

  static appends = ['excerpt']
}
```

### 2. Use decorator syntax (alternative)

```ts
import { Model, Hidden, Cast, Appends, Attribute } from '@rudderjs/orm'

export class User extends Model {
  static fillable = ['name', 'email', 'password']

  @Hidden password = ''
  @Cast('boolean') isAdmin = false
  @Cast('date') createdAt = new Date()
  @Appends fullName = ''

  static attributes = {
    fullName: Attribute.make({
      get: (_, attrs) => `${attrs['firstName']} ${attrs['lastName']}`,
    }),
    password: Attribute.make({
      set: async (v) => {
        const { hash } = await import('bcrypt')
        return hash(String(v), 10)
      },
    }),
  }
}
```

### 3. Query the database

```ts
// Basic queries
const user = await User.find(1)
const users = await User.all()
const first = await User.first()
const total = await User.count()

// Filtered queries
const admins = await User.where('isAdmin', true).all()
const page = await User.paginate(1, 15) // { data, total, page, perPage, lastPage }

// Chained query builder
const results = await User.query()
  .where('role', 'admin')
  .where('active', true)
  .orderBy('createdAt', 'desc')
  .limit(10)
  .all()

// Eager loading
const posts = await Post.with('author', 'comments').all()
```

### 4. CRUD operations

```ts
// Create -- triggers creating/created observers
const post = await Post.create({ title: 'Hello', body: 'World', authorId: 1 })

// Update -- triggers updating/updated observers
const updated = await Post.update(post.id, { title: 'Updated' })

// Delete -- triggers deleting/deleted observers
await Post.delete(post.id)

// Soft delete (when softDeletes = true)
await Post.delete(post.id)          // sets deletedAt
await Post.restore(post.id)         // clears deletedAt
await Post.forceDelete(post.id)     // permanent removal
```

### 5. Scopes

```ts
export class Post extends Model {
  static globalScopes = {
    published: (q) => q.where('isPublished', true),
  }

  static scopes = {
    byAuthor: (q, authorId: number) => q.where('authorId', authorId),
    recent: (q) => q.orderBy('createdAt', 'desc').limit(10),
  }
}

// Usage
const posts = await Post.query().scope('byAuthor', 1).scope('recent').all()
const allPosts = await Post.query().withoutGlobalScope('published').all()
```

### 6. Observers

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

// Or inline listeners
Post.on('creating', (data) => { data['slug'] = slugify(data['title']); return data })
```

### 7. Custom casts

```ts
import type { CastUsing } from '@rudderjs/orm'

class MoneyCast implements CastUsing {
  get(key: string, value: unknown): number {
    return Number(value) / 100  // stored as cents
  }
  set(key: string, value: unknown): number {
    return Math.round(Number(value) * 100)
  }
}

class Product extends Model {
  static casts = { price: MoneyCast }
  // Or decorator: @Cast(MoneyCast) price = 0
}
```

### 8. Model factories

```ts
import { ModelFactory, sequence } from '@rudderjs/orm'

class UserFactory extends ModelFactory<{ name: string; email: string; role: string }> {
  protected modelClass = User

  definition() {
    return {
      name:  'Alice',
      email: sequence(i => `user${i}@example.com`),
      role:  'user',
    }
  }

  protected states() {
    return {
      admin: () => ({ role: 'admin' }),
    }
  }
}

// Usage
const user = await UserFactory.new().create()
const admin = await UserFactory.new().state('admin').create()
const users = await UserFactory.new().create(5)           // 5 persisted
const dtos = await UserFactory.new().make(3)               // 3 in-memory only
const custom = await UserFactory.new().with(() => ({ name: 'Bob' })).create()
```

### 9. API resources

```ts
import { JsonResource, ResourceCollection } from '@rudderjs/orm'

class UserResource extends JsonResource<User> {
  toArray() {
    return {
      id:    this.resource.id,
      name:  this.resource.name,
      email: this.resource.email,
      admin: this.when(this.resource.role === 'admin', true),
      posts: this.whenLoaded('posts', PostResource.collection(this.resource.posts)),
      ...this.mergeWhen(this.resource.isAdmin, {
        permissions: this.resource.permissions,
      }),
    }
  }
}

// Single resource
res.json(new UserResource(user).toArray())

// Collection with pagination
const collection = UserResource.collection(users, { total: 100, page: 1, perPage: 15 })
res.json(await collection.toResponse())
// -> { data: [...], meta: { total: 100, page: 1, perPage: 15 } }
```

### 10. Instance serialization controls

```ts
const user = await User.find(1)
user.makeVisible('password')        // show normally-hidden field
user.makeHidden('email')            // hide for this instance
user.setVisible(['id', 'name'])     // allowlist override

// On collections
const collection = ModelCollection.wrap(await User.all())
collection.makeHidden(['email'])
collection.modelKeys()              // [1, 2, 3]
collection.find(2)                  // user with id 2
collection.except([1])              // all except id 1
```

## Examples

See `playground/app/Models/User.ts` for a working model and `playground/routes/console.ts` for seeding with factories.

## Common pitfalls

- **No adapter registered**: `ModelRegistry.getAdapter()` throws if no database provider is in the provider list. Ensure `DatabaseServiceProvider` boots before any model usage.
- **Observers vs query builder**: `Model.create()` / `Model.update()` / `Model.delete()` fire observer events. Using `Model.query().create()` directly bypasses observers.
- **Built-in casts**: Available types are `'string'`, `'integer'`, `'float'`, `'boolean'`, `'date'`, `'datetime'`, `'json'`, `'array'`, `'collection'`, `'encrypted'`, `'encrypted:array'`, `'encrypted:object'`. Encrypted casts require `@rudderjs/crypt`.
- **Visible vs hidden**: When `visible` is set (allowlist), `hidden` is ignored. Only one should be used per model.
- **sequence() in factories**: The `sequence()` helper returns a callable. Inside `definition()`, return it directly -- the factory resolves callables automatically.
- **Prisma schema**: Models map to Prisma models. Run `pnpm exec prisma generate` after schema changes and `pnpm exec prisma db push` to sync the DB.
