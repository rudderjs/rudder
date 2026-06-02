---
"@rudderjs/orm-drizzle": minor
---

feat(orm-drizzle): real joins + structured `select()`

`join` / `leftJoin` / `rightJoin` / `crossJoin` and `select(...)` now work on the Drizzle adapter (previously they threw). They build on Drizzle's native `.innerJoin()` / `.leftJoin()` / `.rightJoin()` / `.crossJoin()`.

- Referenced tables must be registered (via `tables: {...}` config or `DrizzleTableRegistry`), same requirement as `whereHas`.
- With a join and no explicit `select(...)`, the projection defaults to the base table's columns so each row still hydrates as the base model (the join filters / fans out rows). `select('users.name', 'posts.title')` overrides the projection.
- Simple form `join('posts', 'posts.userId', '=', 'users.id')` and callback form `join('posts', j => j.on(...).where(...))`.

`groupBy` / `having` / `union` / `distinct` still throw on Drizzle (separate follow-ups) — use the native engine or the `DB` facade for those.
