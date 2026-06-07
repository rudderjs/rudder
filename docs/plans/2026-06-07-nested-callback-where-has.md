# Nested `whereHas` inside constrain callbacks — design plan

**Status:** ✅ ALL SHIPPED. PR A (contracts + orm capture + native) = #980; PR B (Drizzle) + PR C
(Prisma) followed. §4 answers: Q1 = union widening; Q2 = **v1 throw** (Suleiman, 2026-06-08) — Prisma
composes all-direct chains as nested `some`/`none`, allows a non-direct level only OUTERMOST, throws the
mixed-chain error deeper (the innermost-first hybrid stays a demand-gated follow-up); Q3 = fixed
separately in #979; Q4 = out of scope (consistent with the `orWhere` rejection).
**Scope:** `whereHas('posts', q => q.whereHas('comments', c => …))` — the callback-nested form, which today throws
`"Nested whereHas inside a whereHas constrain callback is not supported — use the dot-path form instead"`
(`packages/orm/src/relations/where-has.ts`, `captureConstraintWheres`).
**Prereq:** the through-relations PR (#974) — its predicate generalizations are assumed below.

## 1. Why the dot-path form doesn't already cover this

`whereHas('posts.comments', cb)` shipped with Laravel `hasNested` semantics: outer levels are PLAIN existence —
empty `constraintWheres`, no count — and the callback applies to the **deepest** level only. The callback-nested
form is strictly more expressive:

```ts
// "users with a PUBLISHED post that has an APPROVED comment"
User.whereHas('posts', q => q.where('published', true)
                             .whereHas('comments', c => c.where('approved', true)))
```

Constraints at *every* level (not just the deepest), `whereDoesntHave` at inner levels
("posts with NO flagged comments"), and sibling branches
(`q.whereHas('comments').whereHas('tags')`) have no dot-path equivalent.

## 2. Key observation: the contract already recurses — only the *builder* is restricted

`RelationExistencePredicate.nested` (added for dot-paths) is a full recursive predicate, and the native
compiler (`compileExists`) already compiles a `nested` child **with that child's own `constraintWheres`,
`exists` flag, and `through` block** at every level — the "outer levels are plain existence" rule is purely how
`buildNestedRelationPredicate` *populates* the chain, not a compiler limitation. So the native engine needs
almost nothing new; the work is in the **capture layer** and the **other two adapters' posture**.

## 3. Proposed design

### 3.1 Predicate shape (contracts) — `nested` becomes a list

```ts
nested?: RelationExistencePredicate | RelationExistencePredicate[]
```

- Sibling nested calls inside one callback need N children; today's field is singular.
- Union (rather than a new `nestedAll` field) keeps dot-path emitters and any existing consumers untouched;
  the native compiler normalizes with `Array.isArray` at one site.
- Each child carries its own `exists` (inner `whereDoesntHave` works), `constraintWheres`, `through`,
  `extraEquals`, and (recursively) `nested`.
- **Not** supported on children in v1, throw clearly: `count` (`has(rel, op, n)` inside a callback),
  `boolean: 'OR'` (`orWhereHas` inside a callback — same reason `orWhere` is rejected there: the AND/OR
  round-trip shape doesn't exist in the flat capture), `withWhereHas` (eager semantics inside a filter
  callback are incoherent).

### 3.2 Capture layer (orm) — give the recorder a model context

`captureConstraintWheres(constrain)` records flat `WhereClause[]` against an anonymous recorder; it cannot
resolve `'comments'` on the related model. Change (internal API only):

```ts
captureConstraints(Related: typeof Model, constrain): { wheres: WhereClause[]; children: RelationExistencePredicate[] }
```

- The recorder's `whereHas(name, cb)` / `whereDoesntHave(name, cb)` resolve `name` on `Related.relations`
  (same validation as the top level: unknown relation throws, `morphTo` throws) and recursively build the
  child predicate via the existing `buildRelationPredicate` + a recursive capture for the child's callback.
- Every relation type is legal at any level (direct, pivot, morph, through — the through PR made
  `buildRelationPredicate` total except `morphTo`).
- Depth: no hard limit (recursion is structural); circular protection unnecessary (each level consumes a
  declared relation; cycles like posts→comments→post→comments are legal SQL and Laravel allows them).
  Document that deep chains are O(depth) correlated subqueries.
- `buildRelationPredicate` attaches `children` (when non-empty) to the predicate it returns; the dot-path
  builder keeps emitting the singular form unchanged.

### 3.3 Adapter matrix

| Adapter | Posture | Notes |
|---|---|---|
| **native** | REAL | `compileExists` already recurses; change = normalize `nested` to an array and append one `EXISTS` per child (both in the direct body and the pivot/fan-out branches). SQL pins for: constraints at two levels, inner NOT EXISTS, siblings, pivot/through level in the middle of a chain. |
| **Drizzle** | ✅ SHIPPED (PR B) | Symmetric recursion (`_relationExistsExpr`) with `exists()/notExists()` + `eq()`. All referenced tables (every level's related + pivot/intermediate) must be registered; clear error names the missing table at any depth. The `supportsNestedRelationPredicates` marker landed with it — Drizzle gained dot-paths for free (both forms E2E-tested). |
| **Prisma** | ✅ SHIPPED (PR C, v1-throw) — all-direct chains real; non-direct only outermost; mixed chains throw | For a chain where EVERY level is a schema-declared direct relation, Prisma is the *easiest* adapter: nested `some`/`none` composes naturally — `{ posts: { some: { published: true, comments: { some: { approved: true } } } } }`. For chains containing a pivot/morph/through level, resolve **innermost-first** via the existing deferred 2-step machinery (each child reduces to an `IN (...)` clause folded into its parent's filter). v1 fallback option if the hybrid is too hairy: all-direct chains real, mixed chains throw with a pointer. |

### 3.4 Semantics to pin in tests (all adapters)

1. Constraints apply at their own level (published on posts, approved on comments).
2. Inner `whereDoesntHave`: "users with a post that has NO flagged comments" — and its interaction with
   outer `whereDoesntHave` (`NOT EXISTS(posts AND NOT EXISTS(comments))` — De Morgan traps).
3. Sibling branches AND together.
4. Equivalence: `whereHas('a', q => q.whereHas('b'))` ≡ `whereHas('a.b')` when no mid-level constraints.
5. Through/pivot levels mid-chain (fan-out rules from #974 hold at every level).
6. `morphTo`, `orWhere`, `orWhereHas`, `has(op,n)` inside callbacks throw clear errors.
7. Dot-path behavior is byte-identical before/after (regression pins).

### 3.5 Slicing (separate PRs, native-first)

1. **PR A — contracts + orm capture + native**: `nested` union widening, `captureConstraints`, native
   array-normalization, full test matrix on sqlite + gated live pg/mysql. Drizzle/Prisma keep throwing
   (message updated to drop the "use the dot-path form" wording where the callback now works on native).
2. **PR B — Drizzle**: recursion + marker (gains dot-paths too).
3. **PR C — Prisma**: nested some/none for all-direct chains; hybrid or documented throw for mixed chains.

Changesets: A = minor contracts + orm + database; B/C = minor each adapter.

## 4. Open questions for review

1. **`nested` union vs new field** (§3.1) — union keeps the surface small; a separate `children?: []` field
   would avoid `Array.isArray` checks but duplicates the concept. Preference?
2. **Prisma mixed-chain posture** (§3.3) — hybrid innermost-first resolution, or v1 throw for chains with a
   non-direct level? The hybrid is sound but is the only genuinely new algorithmic surface in the plan.
3. **Should the recorder also accept `whereIn`/`whereNull`/… sugar?** Today the capture recorder silently
   no-ops every non-`where` chainable — a `whereIn` inside ANY constrain callback (nested or not) is
   silently dropped today, which is arguably a separate latent footgun worth its own fix (throw or record).
   In scope here or separate issue?
4. **OR forms inside callbacks** — stay out of scope (consistent with the existing `orWhere` rejection), or
   should the predicate gain a grouped/boolean clause tree while we're touching the capture layer anyway?

## 5. Explicitly out of scope

- `withWhereHas` with nested constraints (eager side unchanged).
- Count comparisons at inner levels.
- Relation-existence inside `whereGroup` callbacks (different recorder).
