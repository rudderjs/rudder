---
'@rudderjs/orm': minor
---

feat(orm): `withDefault` on belongsTo / hasOne relations (Laravel parity)

A `belongsTo` / `hasOne` relation can now return a null-object default instead
of `null` when it resolves to no row — mirroring Laravel's `->withDefault()`:

```ts
static relations = {
  author: { type: 'belongsTo', model: () => Author, withDefault: true },              // empty instance
  author: { type: 'belongsTo', model: () => Author, withDefault: { name: 'Guest' } }, // with attributes
  author: { type: 'belongsTo', model: () => Author,
            withDefault: (author, post) => { author.name = `by ${post.id}` } },       // callback
}
```

Applies on both reads and is pure Model-layer (no adapter or contract change),
so all three adapters honour it:

- **lazy** — `post.related('author').first()` yields the default (and survives a
  `.where(...)` chain); for `belongsTo`, a null FK no longer throws when
  `withDefault` is set.
- **eager** — `Post.with('author')` substitutes the default after the terminal
  returns, for any parent whose relation came back null.

`withDefault` is ignored on `hasMany` (an empty list is already its own
null-object). The `RelationDefault` type is exported.
