---
"@rudderjs/contracts": minor
"@rudderjs/orm": minor
"@rudderjs/orm-prisma": minor
"@rudderjs/orm-drizzle": minor
---

Add atomic `increment` / `decrement` to the ORM. Final Tier 2 Eloquent parity item.

```ts
// Static — atomic SQL UPDATE, returns hydrated instance
await Post.increment(postId, 'viewCount')                              // +1
await Post.increment(postId, 'viewCount', 5)                           // +5
await User.decrement(userId, 'credits', 10, { lastSeen: new Date() })  // -10 + extras

// Instance — same SQL, merges new value back onto the instance
await post.increment('viewCount')
```

The QueryBuilder contract gains `increment(id, column, amount?, extra?)` and `decrement(id, column, amount?, extra?)`. Prisma maps to `{ increment: n }` / `{ decrement: n }` field updates; Drizzle to a `sql\`${col} + ${n}\`` expression. Both run as a single atomic SQL UPDATE — safe under concurrent writes, no read-modify-write race.

**Caveat — observers don't fire.** `increment` / `decrement` deliberately skip `updating` / `updated` / `saving` / `saved`. The observer payload would have to be either the delta (confusing) or the resolved value (would require a read, breaking atomicity). If you need observer hooks, read the row, compute the resolved value yourself, and call `Model.update()` instead.

Custom adapters: third-party `OrmAdapter` implementations must add `increment` / `decrement` methods to their QueryBuilder. The signature is the same as `update`, plus `column` and `amount` parameters.
