---
'@rudderjs/orm-prisma': major
---

fix(orm-prisma)!: Laravel-parity `where + orWhere` precedence — **breaking semantics**

ORM-correctness Phase 3 from the 2026-05-21 code-review sweep (`docs/plans/2026-05-21-framework-orm-correctness.md`). Resolves the cross-adapter precedence divergence that has been quietly shipping since the ORM was first released.

## The bug

`@rudderjs/orm-prisma`'s `buildWhere()` emitted

```ts
{ ...andSpread, OR: [...orFilters] }
```

which Prisma read as `andSpread AND (or1 OR or2 ...)`. Every `.orWhere()` / `.orWhereGroup()` was constrained by the prior AND chain — the opposite of Eloquent's left-associative behaviour and out of step with `@rudderjs/orm-drizzle`, which has always emitted Laravel-parity `or(andChain, ...orFilters)`.

Concrete example:

```ts
Post
  .where('status', 'active')
  .where('priority', 'high')
  .orWhere('priority', 'low')
  .get()
```

| Adapter | Pre-Phase-3 semantics | New semantics (Phase 3) |
|---|---|---|
| `@rudderjs/orm-drizzle` | `(status='active' AND priority='high') OR priority='low'` | **unchanged** |
| `@rudderjs/orm-prisma` | `status='active' AND priority='high' AND priority='low'` ← buggy | `(status='active' AND priority='high') OR priority='low'` |

The Prisma adapter's `where-group.test.ts` previously codified the buggy posture as expected behaviour — the tests passed but the query semantics didn't match Laravel or Drizzle.

## What changes

`buildWhere()` is restructured to emit `{ OR: [andSide, ...orItems] }` whenever a chain has both AND content and OR content:

```ts
// `.where('a').where('b').orWhere('c')` →
{ OR: [{ AND: [{ a }, { b }] }, { c }] }

// `.where('a').orWhere('b')` →   (AND collapses to a single flat object when there's one item)
{ OR: [{ a }, { b }] }

// `.where('a').where('b')` (no .orWhere) →
{ a, b }   // unchanged — legacy flat shape, AND-only queries are unaffected

// `.orWhere('a').orWhere('b')` (no .where) →
{ OR: [{ a }, { b }] }   // unchanged
```

The same fix is applied to the vector-search SQL builder (`searchVector()`), which had an identical bug — the AND chain and parenthesised OR block were joined with `AND` instead of being top-level alternatives.

Soft-delete scope (`_softDeletes`) stays in the AND chain (matching Drizzle's posture — `softExpr` is pushed into `andExprs`, not wrapped around the result). Apps that need the soft-delete filter to apply across `.orWhere()` alternatives should keep their where chains AND-only or wrap in a `whereGroup`. The plan flags this as a separate follow-up; this PR keeps Prisma's behaviour aligned with Drizzle's, which is the Phase-3 contract.

## Migration

If your app reaches for `.orWhere()` or `.orWhereGroup()` on Prisma and depends on the old "OR constrained by AND" reading, the query semantics change. Two paths:

1. **Adopt Laravel-parity** — your queries now match what the chain syntactically suggests (`a AND b OR c` reads as `(a AND b) OR c`). This is what the Drizzle adapter has always done; cross-adapter portable apps already needed this shape.

2. **Wrap with `whereGroup`** to recover the old constrained semantics:

   ```ts
   // Pre-Phase-3 Prisma behaviour:
   Post.where('a').where('b').orWhere('c').get()
   // → status='a' AND b AND c  (constrained)

   // Equivalent under Laravel parity — wrap the OR alternatives in a whereGroup:
   Post.where('a').where('b').whereGroup(g => g.orWhere('c')).get()
   //   ↑ but this no longer matches what you typically want.
   //
   // What you usually want is the new precedence — `(a AND b) OR c`.
   ```

There is **no compatibility flag** — the legacy shape was a bug. If you need the old behaviour for a specific query, restructure with explicit grouping.

## Tests

- 4 existing specs in `packages/orm-prisma/src/where-group.test.ts` updated to assert the new shapes (single AND-rooted group, single OR-rooted group, 3-level nesting, plain `where + orWhere`).
- 6 new specs added under `where + orWhere precedence (Laravel parity)`:
  - Plain `.where().orWhere()` → `OR: [{ a }, { b }]`
  - Multi-`.where()` AND chain + `.orWhere()` (column collisions survive via AND-array form)
  - Multiple `.orWhere()` calls each become top-level alternatives
  - `.orWhere()`-only chain emits a bare OR
  - AND-only chain keeps the legacy flat shape (regression guard)
  - Soft-delete scope joins the AND alternative (matches Drizzle)
- 1 existing spec in `packages/orm-prisma/src/vector.test.ts` updated to assert the new SQL precedence.
- 1 new spec added covering multi-`.where()` + `.orWhere()` in the vector-search path.

104 → 110 specs in the `orm-prisma` test suite. Downstream test suites (`orm`, `orm-drizzle`, `core`, `router`, `auth`, `passport`) pass unchanged. Full-repo typecheck across 93 packages clean.
