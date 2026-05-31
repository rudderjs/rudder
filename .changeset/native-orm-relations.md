---
"@rudderjs/orm": minor
---

Native engine Phase 3 — relations & aggregates at `@rudderjs/orm/native`.

Implements the relation/aggregate terminals on `NativeQueryBuilder` (previously throwing `NativeNotImplementedError`), compiling correlated subqueries via the existing pure `Dialect`/compiler + `Executor` seams:

- **`whereRelationExists`** (`whereHas` / `whereDoesntHave`) → correlated `EXISTS` / `NOT EXISTS`. Direct relations (hasMany/hasOne/belongsTo/morphMany/morphOne) compile to a single subquery; through-pivot relations (belongsToMany/morphToMany/morphedByMany) to a nested pivot→related `EXISTS`. `extraEquals` (morph discriminators) and constraint wheres are bound parameters; correlation references the outer table by qualified column.
- **`withAggregate`** (`withCount`/`withExists`/`withSum`/`withMin`/`withMax`/`withAvg`) → one correlated `(subselect) AS alias` per request in the SELECT list, including through-pivot joins, `extraEquals`, and related-model soft-delete scoping. `exists` wraps the count in `(… ) > 0`; `sum` coalesces to 0.
- **`_aggregate(fn, column?)`** → single-scalar terminal (`SELECT fn(col) FROM table WHERE …`) powering `instance.loadCount`/`loadSum`/etc. Empty-set semantics: count→0, sum→0, min/max/avg→null, exists→false.

This makes native's `whereHas` work with **no per-driver setup** — unlike orm-prisma (needs a declared `@relation`) and orm-drizzle (needs a table registry).

Every value is bound; identifiers are validated + quoted. Binding order is preserved across SELECT-list aggregate subselects and the WHERE.

**Known limitation (deferred):** direct (non-polymorphic) eager `with()` is not yet native — the current adapter contract passes relation names only, with no join shape, so a direct `with()` would silently return rows without the relation populated. Native now emits a one-time dev-mode warning instead of silently no-op'ing; polymorphic `with()` already works (resolved in the Model layer). Real native direct-eager-load is a contract-gap decision deferred to a later phase.
