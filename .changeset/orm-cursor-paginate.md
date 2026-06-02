---
"@rudderjs/orm": minor
---

feat(orm): `Model.query().cursorPaginate(perPage?, cursor?)` — keyset pagination (Laravel parity)

Adds cursor (keyset) pagination alongside the existing offset `paginate()`. Instead of `OFFSET`, it filters `WHERE (orderCols) > lastSeenValues` against the query's `orderBy` columns and fetches `LIMIT perPage + 1` (the probe row tells it whether another page exists) — so paging stays O(1) regardless of depth, the right tool for infinite scroll and large API list endpoints.

```ts
const page = await Post.query().orderBy('createdAt', 'desc').cursorPaginate(20)
//   { data, perPage, nextCursor, prevCursor, hasMore }
const next = await Post.query().orderBy('createdAt', 'desc').cursorPaginate(20, page.nextCursor)
```

- Returns a `CursorPaginator` — `{ data, perPage, nextCursor, prevCursor, hasMore }` (+ `toJSON()`). The cursor is an opaque base64url-encoded JSON of the boundary row's order-column values; decoded on input, encoded on output. `encodeCursor` / `decodeCursor` are exported too.
- **Requires at least one `orderBy()`** (keyset needs a deterministic sort) — throws a clear error otherwise. The primary key is appended as a tiebreaker when it isn't already an order column, giving a stable total order.
- **Multi-column orderBy is supported** — compound keyset via the lexicographic `(a, b) > (?, ?)` expansion, composed so it `AND`s correctly with any pre-existing `where()` clauses.
- `Model.cursorPaginate(perPage?, cursor?)` (static) defaults to ordering by the primary key.
- **Forward-only in v1** — `nextCursor` advances; `prevCursor` is always `null` (backward navigation deferred).

Built entirely at the Model layer on the existing `where` / `orderBy` / `limit` / `get` primitives — no adapter, contract, or native-engine changes — so it works identically across the native engine, Drizzle, and Prisma.
