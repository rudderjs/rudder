# Defining Models

## Basic shape

```ts
import { Model } from '@rudderjs/orm'

export class Post extends Model {
  static table    = 'posts'
  static fillable = ['title', 'body', 'authorId']
  static hidden   = ['internalNotes']

  static casts = {
    isPublished: 'boolean'  as const,
    publishedAt: 'datetime' as const,
    metadata:    'json'     as const,
  }
}
```

Table defaults to lowercase class name + `'s'`. Override with `static table = 'my_table'`.
Primary key defaults to `'id'`. Override with `static primaryKey = 'uuid'`.

## Decorator syntax (alternative)

```ts
import { Model, Hidden, Cast, Appends } from '@rudderjs/orm'

export class User extends Model {
  static fillable = ['name', 'email', 'password']

  @Hidden               password   = ''
  @Cast('boolean')      isAdmin    = false
  @Cast('date')         createdAt  = new Date()
  @Appends              fullName   = ''
}
```

Pick **one style per model** — mixing decorators and `static` config for the same fields is confusing.

## Accessors and mutators

```ts
import { Model, Attribute } from '@rudderjs/orm'

export class User extends Model {
  static attributes = {
    fullName: Attribute.make({
      get: (_v, attrs) => `${attrs['firstName']} ${attrs['lastName']}`,
    }),
    password: Attribute.make({
      set: async (v) => (await import('bcrypt')).hash(String(v), 10),
    }),
  }

  static appends = ['fullName']   // include in toJSON output
}
```

Mutators (`set`) run on `Model.create` / `Model.update` / `instance.fill`. Accessors (`get`) run on serialization. Appended attributes need a matching `get` definition, otherwise the field is missing from output.

## Custom casts

For domain types (money, vectors, custom serialization):

```ts
import type { CastUsing } from '@rudderjs/orm'

class MoneyCast implements CastUsing {
  get(_key: string, value: unknown): number { return Number(value) / 100 }
  set(_key: string, value: unknown): number { return Math.round(Number(value) * 100) }
}

class Product extends Model {
  static casts = { price: MoneyCast }
  // or decorator: @Cast(MoneyCast) price = 0
}
```

## Soft deletes

```ts
export class Post extends Model {
  static softDeletes = true
}

await Post.delete(id)                                    // sets deletedAt
await Post.restore(id)                                   // clears deletedAt
await Post.forceDelete(id)                               // hard delete
await Post.query().withTrashed().all()                   // include soft-deleted
await Post.query().onlyTrashed().all()                   // only soft-deleted
```

## Pitfalls

❌ **Don't** set `static visible` AND `static hidden` on the same model:

```ts
static visible = ['id', 'name']
static hidden  = ['password']   // silently ignored when `visible` is set
```

✅ **Do** pick one. `visible` is a strict allowlist; `hidden` is a denylist.

❌ **Don't** type a relation field that shadows the runtime-installed accessor:

```ts
class Post extends Model {
  tags!: () => string[]   // class field shadows the prototype method
}
```

✅ **Do** type the explicit override:

```ts
class Post extends Model {
  tags() { return Model.morphToMany(this, 'tags') }
}
```

❌ **Don't** assume the SQL table name is the Prisma delegate:

```ts
class OAuthClient extends Model {
  static table = 'oauth_clients'   // wrong — that's the @@map'd SQL name
}
```

✅ **Do** use the Prisma client delegate (camelCase of model name):

```ts
class OAuthClient extends Model {
  static table = 'oAuthClient'     // the Prisma delegate
}
```

Error: `[RudderJS ORM] Prisma has no delegate for table "oauth_clients"` means you used the SQL name by mistake.
