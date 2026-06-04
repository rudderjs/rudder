# Query Builder

Every Model query chain is a full SQL query builder. Beyond `where()` /
`orderBy()` / `limit()` (covered in [Models](/guide/database/models#querying)),
the builder speaks joins, grouping, set operations, common table expressions,
EXISTS subqueries, row locking, and keyset pagination — with every value bound
and every identifier validated and quoted.

Feature breadth depends on the engine. The **native engine** implements
everything on this page; the **Drizzle adapter** implements most of it; the
**Prisma adapter** intentionally routes builder-shaped SQL to
[`DB.select(sql, bindings)`](/guide/database#the-db-facade) instead (its
structured client can't map arbitrary projections back to a model). Anything
unsupported throws a clear error naming the alternative — never a silent no-op.

| Feature | Native | Drizzle | Prisma |
|---|:---:|:---:|:---:|
| `select()` / `selectRaw()` / `distinct()` | ✅ | ✅ (`selectRaw` → `DB.select`) | `DB.select` |
| Joins | ✅ | ✅ | `DB.select` |
| `groupBy` / `having` / `havingRaw` | ✅ | ✅ | `DB.select` |
| `union` / `unionAll` | ✅ | ✅ | `DB.select` |
| CTEs (`withExpression`) | ✅ | `DB.select` | `DB.select` |
| `whereExists` / `whereNotExists` | ✅ | `DB.select` | `DB.select` |
| `whereColumn` | ✅ | ✅ | `DB.select` |
| Date helpers (`whereDate` …) | ✅ | ✅ | `DB.select` |
| JSON paths (`meta->lang`, contains, length, updates) | ✅ | ✅ | `DB.select` |
| `cursorPaginate` / `chunk` / `lazy` | ✅ | ✅ | ✅ |
| `lockForUpdate` / `sharedLock` | ✅ | ✅ | raw transaction |

## Projection — `select`, `selectRaw`, `distinct`

`select(...columns)` replaces the default `*` projection. Qualified
`table.column` names are supported and identifier-quoted; `selectRaw` adds raw
fragments (with `?` bindings) for computed columns:

```ts
const rows = await Order.query()
  .select('orders.id', 'orders.total')
  .selectRaw('total * ? AS taxed', [1.17])
  .get()

const cities = await User.query().distinct().select('city').get()
```

`distinct().count()` counts distinct rows (the builder wraps the DISTINCT body
in a subquery — a bare `COUNT(DISTINCT *)` isn't valid SQL).

## Joins

`join` / `leftJoin` / `rightJoin` / `crossJoin` sit between FROM and WHERE.
The simple form takes two columns; the callback form builds a compound ON
clause:

```ts
// Simple: users joined to their orders
const rows = await User.query()
  .join('orders', 'users.id', '=', 'orders.userId')
  .select('users.name', 'orders.total')
  .get()

// Compound ON — `on`/`orOn` compare columns, `where` compares a column to a value
await User.query()
  .leftJoin('orders', j => j.on('users.id', 'orders.userId').where('orders.total', '>', 100))
  .get()
```

With a join and no explicit `select()`, rows still hydrate as the base model
(the join filters or fans out; the row shape stays the model's). `RIGHT JOIN`
on SQLite needs 3.39+.

::: tip Relations first
For relation-shaped joins, prefer [`whereHas`](/guide/database/models#querying-parents-by-related-rows)
and [eager loading](/guide/database/models#relations) — joins are for shapes no
declared relation describes (CTE references, reporting projections, pivots on
non-relation keys).
:::

## Grouping — `groupBy`, `having`, `havingRaw`

```ts
const byCity = await User.query()
  .select('city')
  .selectRaw('COUNT(*) AS total')
  .groupBy('city')
  .havingRaw('COUNT(*) > ?', [10])
  .get()
```

`count()` and `paginate()` of a grouped query count the number of **groups**
(Laravel parity), not per-group rows. `having('alias', …)` on a SELECT alias
works on SQLite/MySQL but not Postgres — use `havingRaw` for portability.

## Combining queries — `union` / `unionAll`

```ts
const recent  = Post.query().where('publishedAt', '>', lastWeek)
const pinned  = Post.query().where('pinned', true)

const feed = await recent.unionAll(pinned).orderBy('publishedAt', 'DESC').limit(20).get()
```

The **base** query's `orderBy` / `limit` / `offset` apply to the combined
result; member queries' own are dropped. Members must be native queries
(`Model.query()` chains).

## Common table expressions — `withExpression` / `withRecursiveExpression`

A CTE prepends a named subquery (`WITH name AS (…)`) the main query can
reference — typically via `join('name', …)`; the FROM stays the model's table.
The body is another query chain, or a raw SQL string with `?` placeholders:

```ts
// Builder-backed body
const reports = await Employee.query()
  .withExpression('reports', Employee.where('managerId', 1))
  .join('reports', 'employees.id', '=', 'reports.id')
  .get()

// Recursive bodies are raw SQL — they reference the CTE's own name
const subtree = await Employee.withRecursiveExpression(
  'subtree',
  `SELECT id FROM employees WHERE id = ?
   UNION ALL
   SELECT e.id FROM employees e JOIN subtree s ON e.managerId = s.id`,
  { bindings: [rootId], columns: ['id'] },
)
  .join('subtree', 'employees.id', '=', 'subtree.id')
  .get()
```

`opts.columns` emits the explicit column list (`tree (id)`); one recursive
member marks the whole `WITH` list `RECURSIVE`. CTEs apply to the read path —
`get` / `first` / `find` / `count` / `paginate`.

## EXISTS subqueries — `whereExists` / `whereNotExists`

An arbitrary `[NOT] EXISTS (…)` predicate. Correlate a builder body to the
outer table with qualified `whereColumn` refs, or pass raw SQL + bindings:

```ts
// Users with at least one order (no relation declaration needed)
const buyers = await User.whereExists(
  Order.query().whereColumn('orders.userId', '=', 'users.id'),
).get()

// Raw body
const bigSpenders = await User.query()
  .whereExists('SELECT 1 FROM orders WHERE orders.userId = users.id AND total > ?', [500])
  .get()

const inactive = await User.whereNotExists(
  Order.query().whereColumn('orders.userId', '=', 'users.id'),
).get()
```

`orWhereExists` / `orWhereNotExists` compose with prior clauses and inside
`whereGroup` callbacks. For relation-shaped checks, `whereHas` stays the right
tool — `whereExists` is the escape hatch when no declared relation describes
the subquery.

## Column comparisons — `whereColumn`

Compare two columns (both identifier-quoted — the reason this can't ride on
`whereRaw`, which leaves identifiers untouched):

```ts
await Task.query().whereColumn('completedAt', '>', 'dueAt').get()
await Order.query().whereColumn('orders.userId', '=', 'users.id') // qualified refs in subqueries
```

## Date helpers

`whereDate` / `whereTime` / `whereDay` / `whereMonth` / `whereYear`
(+ `orWhere*` forms) compare a date/time **component** of a column, with the
extraction compiled per dialect:

```ts
await Post.whereDate('publishedAt', '2026-06-01').get()
await Post.whereYear('publishedAt', 2026).whereMonth('publishedAt', 6).get()
await Event.whereTime('startsAt', '>=', '09:00:00').get()
```

A `Date` value is normalized to its **UTC** components.

## JSON paths

Arrow paths address values inside JSON columns — in `where()` (and everything
composed from it: groups, `whereNot`, `whereIn`/`whereNull` sugar, `whereHas`
constraint callbacks), in the dedicated predicates, and in `update()` payloads:

```ts
await User.where('meta->prefs->lang', 'en').get()
await User.whereNull('meta->nick').get()                  // missing key AND explicit json null
await User.whereJsonContains('meta->tags', ['php', 'js']).get()
await User.whereJsonLength('meta->tags', '>', 1).get()

await User.update(id, { 'meta->prefs->lang': 'de' })      // JSON_SET / jsonb_set — one path, not the whole column
```

Path segments are validated (quotes/backslashes/control characters rejected);
all-digit segments address array elements (`meta->items->0`). Null semantics
are Laravel-parity on every dialect — a missing key and an explicit JSON
`null` both count as null.

## Pagination — offset, cursor, and streaming

```ts
// Offset pagination — page metadata included
const page = await Post.query().latest().paginate(2, 25)
// { data, total, perPage, currentPage, lastPage, from, to }

// Keyset (cursor) pagination — stable under concurrent inserts, O(1) per page
const first = await Post.query().latest().cursorPaginate(25)
const next  = await Post.query().latest().cursorPaginate(25, first.nextCursor)
// { data, perPage, hasMore, nextCursor, prevCursor }
```

For memory-bounded iteration over large sets, use
[`chunk` / `lazy`](/guide/database/models#iterating-large-result-sets-chunk-lazy).

## Row locking — `lockForUpdate` / `sharedLock`

Pessimistic row locks for read-modify-write sections — only meaningful inside
a [`transaction()`](/guide/database#transactions):

```ts
await DB.transaction(async () => {
  const job = await Job.query().where('state', 'pending').lockForUpdate().first()
  if (job) await Job.update(job.id, { state: 'reserved' })
})
```

`FOR UPDATE` / `FOR SHARE` on Postgres and MySQL; a documented no-op on SQLite
(single-writer — no row locks). On Prisma the methods throw with a
raw-transaction pointer — a silent no-op would be a correctness bug for
queue-style reservations.

Both methods take an optional wait-behavior argument — mutually exclusive,
both set throws:

```ts
.lockForUpdate({ skipLocked: true })  // skip rows another worker holds (FOR UPDATE SKIP LOCKED)
.lockForUpdate({ noWait: true })      // fail immediately instead of blocking (NOWAIT)
```

`skipLocked` is *the* concurrent job-reservation pattern — each worker grabs
only unclaimed rows, no lock queueing. Native + Drizzle on Postgres/MySQL 8;
on SQLite the options are a no-op along with the lock itself. See
[Pessimistic locking](/guide/database#pessimistic-locking).

## Raw SQL escape hatches

`selectRaw` / `whereRaw` / `orWhereRaw` / `orderByRaw` accept raw fragments
with `?` placeholder bindings, and `DB.raw(...)` splices a verbatim expression
as a value — see [Raw SQL](/guide/database/models#raw-sql-selectraw-whereraw-orderbyraw-db-raw).
For statement-level raw queries outside any model, use the
[`DB` facade](/guide/database#the-db-facade)
(`DB.select` / `DB.statement` / `DB.transaction`).
