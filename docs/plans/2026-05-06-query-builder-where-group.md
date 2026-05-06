# Plan: `QueryBuilder.whereGroup` — nested AND/OR groups

**Filed:** 2026-05-06 by Claude Opus 4.7
**Driver:** pilotiq
**Status:** Done (PR #252, merged 2026-05-06)

---

## Why

Pilotiq ships a Filament-style `QueryBuilderFilter` (admin-side runtime
filter that lets end-users compose multi-condition queries through the
UI). v1 is AND-only because the rudder ORM `QueryBuilder` doesn't
expose any way to compose nested groups.

Pilotiq's parser already represents the tree — every node has
`operator: 'and' | 'or'` plus children — but `applyTreeToQuery` walks
it flat and chains every leaf via `.where(...)`. The OR branch is
explicitly rejected (see `packages/pilotiq/src/filters/QueryBuilderFilter.ts:233-251`).
v2 needs to translate the tree into nested SQL groups:

```sql
WHERE (a = 1 AND b = 2) OR (c = 3 AND (d = 4 OR e = 5))
```

The runtime cost of supporting this is the only thing blocking a
useful subset of pilotiq's filter UX. No pilotiq workaround exists —
flat AND-only filters can't express "in state X OR over $1000".

---

## Current state — rudder

`packages/contracts/src/index.ts:135-143` defines:

```ts
export interface QueryBuilder<T> {
  where(column: string, value: unknown): this
  where(column: string, operator: WhereOperator, value: unknown): this
  orWhere(column: string, value: unknown): this
  orWhere(column: string, operator: WhereOperator, value: unknown): this
  // …
}
```

No callback-form `where(fn => …)`, no `whereGroup`, no `whereNested`.
Adapters (Prisma, Drizzle) translate flat `where`/`orWhere` chains
linearly — there's no notion of grouping today.

The closest existing precedent for a callback-style API is
`whereHas(relation: string, fn: (q: QueryBuilder) => QueryBuilder)` —
defined in the orm package and translated by adapters via
`whereRelationExists` (line 192 of contracts). Same pattern works for
`whereGroup`.

## Current state — pilotiq

`packages/pilotiq/src/filters/QueryBuilderFilter.ts`:
- `QueryBuilderTree` (~lines 34-37) declares `operator: 'and' | 'or'`
  and `rules: (QueryBuilderTree | QueryBuilderRule)[]`.
- `applyTreeToQuery(query, tree, constraints)` (~lines 101-252) walks
  rules; the OR path throws / falls back. Inline comment near line
  233 notes "v2 needs whereGroup".

Pilotiq memory: `project_pilotiq_query_builder.md` (in
`~/.claude/projects/-Users-sleman-Projects-pilotiq/memory/`) describes
what shipped and what's deferred to v2.

---

## Proposed API

Add two methods to `QueryBuilder<T>`:

```ts
/**
 * Wrap a chain of `where`/`orWhere` (and nested `whereGroup`s) in a
 * single AND-grouped clause. Composes with surrounding AND/OR like
 * any other where call.
 *
 * Example:
 *   q.where('status', 'active')
 *    .whereGroup(g => g.where('priority', 'high').orWhere('starred', true))
 *
 * SQL: WHERE status = 'active' AND (priority = 'high' OR starred = TRUE)
 */
whereGroup(fn: (q: QueryBuilder<T>) => QueryBuilder<T>): this

/** OR-rooted variant — inverse of whereGroup. */
orWhereGroup(fn: (q: QueryBuilder<T>) => QueryBuilder<T>): this
```

**Semantics:**
- The callback receives a fresh sub-builder. Calls inside it compose
  among themselves; nothing leaks out except the resulting grouped
  clause.
- Sub-builders can recurse — `whereGroup` inside `whereGroup` works.
- `where`/`orWhere` calls inside the sub-builder behave exactly like
  on the top-level builder (first call is implicitly AND with the
  group's outer connector).
- The sub-builder is the same `QueryBuilder<T>` interface — no
  reduced surface — so callers don't need to learn a second API.

---

## Implementation

### `packages/contracts/src/index.ts`

Add the two methods to the `QueryBuilder<T>` interface (after
`orWhere`, before `orderBy`).

### `packages/orm/src/adapters/prisma.ts` (and equivalent drizzle)

Translation strategy — both adapters already build a Prisma-style
`where: { AND: [...], OR: [...] }` shape internally (or an equivalent
Drizzle `and()/or()` tree). The new methods need to:

1. Allocate a sub-context that captures every `where`/`orWhere` call
   made on the inner builder.
2. Combine the captured calls into a nested `AND` / `OR` block.
3. Splice the block back into the parent context as a single clause.

For Prisma the output is a nested `AND: [...]` (for `whereGroup`) or
`OR: [...]` (for `orWhereGroup`) under the parent's connector.

For Drizzle it's a wrapped `and(...)` / `or(...)` expression appended
to the parent's clause list.

The sub-builder can be a thin proxy around a fresh `QueryBuilder`
instance whose terminal methods (`get`, `find`, `first`, etc.) are
disabled — only `where*`-family methods are valid. Throw a clear
error if a caller invokes a terminal method on the sub-builder.

### `packages/orm/src/index.ts`

`whereHas` already accepts a `(q: QueryBuilder) => QueryBuilder`
callback — mirror that style. No additional ORM-level helpers needed.

---

## Pilotiq downstream

`packages/pilotiq/src/filters/QueryBuilderFilter.ts:101-252` —
`applyTreeToQuery` becomes recursive. Pseudo:

```ts
function apply(q, tree) {
  if (tree.operator === 'or') {
    return q.whereGroup(g => {
      let inner = g
      for (const rule of tree.rules) {
        inner = isLeaf(rule)
          ? inner.orWhere(rule.column, rule.operator, rule.value)
          : inner.orWhereGroup(sub => apply(sub, rule))
      }
      return inner
    })
  }
  // tree.operator === 'and'
  for (const rule of tree.rules) {
    q = isLeaf(rule)
      ? q.where(rule.column, rule.operator, rule.value)
      : q.whereGroup(sub => apply(sub, rule))
  }
  return q
}
```

---

## Acceptance criteria

1. `QueryBuilder<T>` interface exposes `whereGroup` and `orWhereGroup`.
2. Both adapters (Prisma + Drizzle) produce SQL/Prisma-shape that
   correctly groups conditions — verified by snapshot tests on the
   compiled query.
3. Nesting works arbitrarily deep — at least one test that exercises
   3-level nesting (`(A AND (B OR (C AND D)))`).
4. Sub-builder terminals (`get`/`find`/`first`/...) throw a clear
   error: "Sub-builder is for `where*` chaining only — call `get()`
   on the parent builder."
5. Empty group is a no-op — `q.whereGroup(g => g)` produces no
   additional WHERE clause.
6. Existing `where`/`orWhere` chains keep their current behavior
   unchanged (regression coverage).

---

## Test plan

- New file: `packages/orm/__tests__/where-group.test.ts` — covers
  both adapters via the existing dual-driver test harness.
- Cases: single group, OR-rooted group, nested group (3 deep), empty
  group, terminal-method-on-sub-builder error, mix with `whereHas`.
- Pilotiq integration test (in pilotiq repo): update
  `QueryBuilderFilter.test.ts` to drop the OR-rejection assertion and
  add positive coverage for OR + nested-group queries.

---

## Out of scope

- `havingGroup` (aggregate filtering) — pilotiq has no consumer.
- Raw-SQL escape hatch for groups — Filament's
  `whereRaw('(a = ? OR b = ?)', [...])` style. Not needed; the
  callback API covers every realistic case.
- Prisma's `NOT` connector — pilotiq's tree uses `not: boolean` per
  leaf today, which compiles to an inverted operator. Re-evaluate if
  v3 wants tree-level `NOT` groups.

---

## Files to modify

- `packages/contracts/src/index.ts` — interface
- `packages/orm/src/adapters/prisma.ts` — Prisma translator
- `packages/orm/src/adapters/drizzle*.ts` — Drizzle translators (per dialect)
- `packages/orm/__tests__/where-group.test.ts` — new test file

---

## Files for reference (pilotiq side, do NOT modify in this rudder PR)

- `~/Projects/pilotiq/packages/pilotiq/src/filters/QueryBuilderFilter.ts`
- `~/Projects/pilotiq/packages/pilotiq/src/filters/QueryBuilderFilter.test.ts`
