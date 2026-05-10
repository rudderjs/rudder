---
"@rudderjs/ai": minor
"@rudderjs/orm-prisma": minor
"@rudderjs/contracts": patch
---

**B7 Phase 2.5 — `scope` callback on `similaritySearch` + chained `.where()` lift in `whereVectorSimilarTo`.** Tenant / publication / soft-delete filtering for RAG agents, no over-fetching, no user-side post-filtering. The chain pre-filters in SQL.

```ts
import { similaritySearch } from '@rudderjs/ai'
import { Document } from './app/Models/Document.js'

class KnowledgeAgent extends Agent {
  tools() {
    return [
      similaritySearch({
        model:     Document,
        column:    'embedding',
        embedWith: 'openai/text-embedding-3-small',
        limit:     10,
        scope: (q) =>
          q.where('tenantId', currentTenant)
           .where('published', true),
      }),
    ]
  }
}
```

`@rudderjs/orm-prisma`:

- `_getViaVector` composes flat `.where()` / `.orWhere()` chains into the vector SQL via a new `clauseToSql(clause, params[])` helper. Operators: `=`, `!=`, `>`, `>=`, `<`, `<=`, `LIKE`, `NOT LIKE`, `IN`, `NOT IN`. `null` values on `=` / `!=` map to `IS NULL` / `IS NOT NULL`. Empty `IN` short-circuits to `FALSE`; empty `NOT IN` to `TRUE` (Postgres rejects empty IN-lists).
- User-supplied values bind through positional `$N` placeholders to `$queryRawUnsafe(sql, ...params)` — defense-in-depth against SQL injection. Vector min-similarity stays inlined (numeric, safe).
- Polymorphic / pivot relation predicates (resolved via `_resolveDeferred`) flow through as flat `IN` / `NOT IN` clauses transparently.
- Soft-delete scoping (`withTrashed` / `onlyTrashed`) flows into the SQL alongside user wheres.
- **Still throws (out of scope for 2.5):** `.with()` (eager load), `whereGroup` / `orWhereGroup` (sub-builders pre-flatten to Prisma filter objects so the original `WhereClause[]` is lost), direct `whereHas` / `whereDoesntHave`, aggregates, redundant `.orderBy()`. Documented in the throw messages.

`@rudderjs/ai`:

- `similaritySearch({ scope })` accepts an optional `(q: SimilaritySearchQueryBuilder<T>) => SimilaritySearchQueryBuilder<T>` callback that runs before `whereVectorSimilarTo` attaches.
- `SimilaritySearchQueryBuilder<T>` widened with `where(col, op?, val)` / `orWhere(...)` / `withTrashed?()` / `onlyTrashed?()` overloads so the scope callback gets autocomplete. Main entry still has zero `@rudderjs/contracts` runtime dep — types only.
- New exported `SimilaritySearchWhereOperator` alias mirrors contracts' `WhereOperator` so apps writing scope callbacks don't have to import `@rudderjs/contracts`.

`@rudderjs/contracts`:

- JSDoc on `QueryBuilder.whereVectorSimilarTo` updated to reflect the lifted restriction. No surface change.

Plan: `docs/plans/2026-05-10-b7-vector-storage.md` (Phase 2.5 marked in flight).
