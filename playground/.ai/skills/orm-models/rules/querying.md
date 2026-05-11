# Querying

## Single-row reads

```ts
const user = await User.find(1)              // by primary key
const first = await User.first()             // first row
const total = await User.count()             // SELECT count(*)
```

## Filtered reads

```ts
const admins = await User.where('role', 'admin').all()
const recent = await User.where('createdAt', '>', oneWeekAgo).orderBy('createdAt', 'desc').limit(10).all()
const page   = await User.paginate(1, 15)
// { data, total, page, perPage, lastPage }
```

`where` accepts `(column, value)` (defaults to `=`), `(column, op, value)`, or a callback for grouped predicates.

## Eager loading

```ts
const posts = await Post.with('author', 'comments').all()
const user  = await User.with({ posts: q => q.where('isPublished', true) }).find(1)
```

Whole-row eager loading is handled natively by the adapter (Prisma `include`, Drizzle `with`).

## Aggregate eager loading

Stays portable across adapters:

```ts
const users   = await User.withCount('posts').all()                     // posts_count column
const authors = await Post.withSum('viewCount', 'views').all()          // posts_sum_views
const post    = await Post.find(1).then(p => p.loadCount('comments'))   // per-instance
```

`withCount` on `belongsTo` and `morphTo` throws — you can't count something there's exactly one of (or whose target table is dynamic).

## Scopes

```ts
export class Post extends Model {
  static globalScopes = {
    published: (q) => q.where('isPublished', true),    // ALWAYS applied
  }

  static scopes = {
    byAuthor: (q, authorId: number) => q.where('authorId', authorId),
    recent:   (q) => q.orderBy('createdAt', 'desc').limit(10),
  }
}

const posts    = await Post.query().scope('byAuthor', 1).scope('recent').all()
const allPosts = await Post.query().withoutGlobalScope('published').all()
```

## Relation predicates (`whereHas`)

```ts
// Users who have at least one published post
const authors = await User.query()
  .whereHas('posts', q => q.where('isPublished', true))
  .all()

// Users who have no comments
const lurkers = await User.query().whereDoesntHave('comments').all()

// Eager-load with the same constraint
const data = await User.query()
  .withWhereHas('posts', q => q.where('isPublished', true))
  .all()
```

## Pitfalls

❌ **Don't** use `eq(col, null)` for null checks:

```ts
// drizzle-orm
qb.where(eq(users.deletedAt, null))   // never matches anything
```

✅ **Do** use `isNull` / `isNotNull`:

```ts
qb.where(isNull(users.deletedAt))
qb.where(isNotNull(users.deletedAt))
```

❌ **Don't** assume `assert.deepStrictEqual(result, plainObject)` holds since hydration shipped:

```ts
const user = await User.find(1)
assert.deepStrictEqual(user, { id: 1, name: 'Alice' })   // ❌ prototype mismatch
```

✅ **Do** compare via spread or assert `instanceof`:

```ts
assert.deepStrictEqual({ ...user }, { id: 1, name: 'Alice' })
assert.ok(user instanceof User)
```

❌ **Don't** use `morphTo` with `whereHas` — the related table is dynamic.

✅ **Do** filter on the morph columns directly:

```ts
await Comment.query()
  .where('commentableType', 'Post')
  .where('commentableId', 1)
  .all()
```
