# `@rudderjs/orm` — Polymorphic Relations (`morphTo / morphMany / morphOne`)

**Status:** PROPOSED — design + implementation contract.
**Author handoff:** filed by pilotiq for the next rudder agent. Self-contained.
**Scope:** v1 = `morphTo / morphMany / morphOne`. M2M polymorphic (`morphToMany / morphedByMany`) deferred.

---

## Why this reverses a deliberate OOS decision

`packages/orm/CLAUDE.md` line 23 currently says:

> Polymorphic relations stay out of scope (every Prisma feature we don't shim becomes a gap).

That wording predates pilotiq's `RelationManager`. The blocker today is concrete:

`@pilotiq/pilotiq` `RelationManager` auto-detects the relation shape by reading `parentModel.relations[name].type` (rudder ORM convention). Without an ORM-level entry for polymorphic relations, pilotiq's manager has nowhere to dispatch — the comment in `packages/pilotiq/src/RelationManager.ts:53` reads `polymorphic shapes (morphMany / morphedByMany) are still gated on ORM support`.

The "reach for the adapter directly" escape hatch the OOS rationale points at doesn't apply: pilotiq's auto-wiring contract (`ModelLike.relations[name]`) is the *only* surface the manager sees, by design — pilotiq has zero runtime dep on `@rudderjs/orm`. Asking pilotiq users to drop into Prisma per-resource defeats the auto-wiring.

`hasOne / hasMany / belongsTo / belongsToMany` are already declared even though Prisma+Drizzle handle their reads — same justification applies here: the *declaration* unlocks downstream tools (admin panels, search, replication helpers). The fluent `instance.related(name)` is a side benefit, not the load-bearing reason.

CLAUDE.md note will be updated as part of this plan.

---

## Scope (v1)

| Type | What it does |
|---|---|
| `morphTo` | The "child" side. `comment.commentable()` → `Post` or `Video` depending on `commentable_type`. |
| `morphMany` | The "parent" side, many. `post.comments()` → all comments where `commentable_type='Post' AND commentable_id=post.id`. |
| `morphOne` | The "parent" side, single. `user.image()` → first image where `imageable_type='User' AND imageable_id=user.id`. |

**Deferred to v2** (gated on real demand, mirroring `belongsToMany v1 limitations`):
- `morphToMany` / `morphedByMany` — pivot table with `{morph}_type` + `{morph}_id` + related FK.
- `morphPivot` columns surfaced on read.
- Polymorphic eager-load via fluent API (Prisma's adapter still works).

**Out of scope permanently:** Laravel's `morphMap` global table. We use a per-relation `types: () => [...]` list (see Design § "Type discriminator").

---

## Convention

Two columns on the polymorphic side, named `{morphName}_type` + `{morphName}_id`:

```prisma
model Comment {
  id              Int     @id @default(autoincrement())
  body            String
  commentable_id  Int
  commentable_type String
  // no Prisma relation arrays — same convention as @rudderjs/orm belongsToMany
}

model Post  { id Int @id @default(autoincrement()); title String }
model Video { id Int @id @default(autoincrement()); url   String }
```

`{morph}_type` stores the discriminator string. Default = the related class's `Class.name` (`'Post'`, `'Video'`). Override per-class via:

```ts
class Post extends Model {
  static override morphAlias = 'post'   // optional — column stores 'post' instead of 'Post'
}
```

When set, both reads and writes use the alias. When unset, both use `Class.name`. No global map — keeps the design self-contained, dodges Laravel's morphMap-as-config pitfalls.

---

## Design

### 1. `RelationDefinition` — three new variants

In `packages/orm/src/index.ts` near the existing union (line 161):

```ts
export type RelationDefinition =
  | { type: 'hasOne' | 'hasMany' | 'belongsTo'; model: () => typeof Model; foreignKey?: string; localKey?: string }
  | { type: 'belongsToMany'; model: () => typeof Model; pivotTable: string; foreignPivotKey?: string; relatedPivotKey?: string; parentKey?: string; relatedKey?: string }
  | {
      type:       'morphMany' | 'morphOne'
      /** Lazy reference to the related (child) model class. */
      model:      () => typeof Model
      /** Polymorphic relation name — drives `{morphName}_id` + `{morphName}_type` column names.
       *  E.g. `morphName: 'commentable'` → columns `commentable_id` / `commentable_type`. */
      morphName:  string
      /** Override the resolved type-discriminator value stored in `{morphName}_type`.
       *  Defaults to `Parent.morphAlias ?? Parent.name`. */
      morphType?: string
      /** Override the parent column joined against `{morphName}_id`. Default: `Parent.primaryKey`. */
      localKey?:  string
    }
  | {
      type:       'morphTo'
      /** Polymorphic relation name — drives `{morphName}_id` + `{morphName}_type` column names. */
      morphName:  string
      /** Allowed target classes. Lazy thunk to dodge circular imports.
       *  Required: `morphTo` resolution looks up the class whose `morphAlias ?? name`
       *  matches the value in `{morphName}_type`. Listing the closed set here
       *  keeps the lookup deterministic and doesn't depend on `ModelRegistry.register`
       *  having been called eagerly for the target. */
      types:      () => Array<typeof Model>
    }
```

### 2. `Model.related(name)` — branches

In `Model.related()` (`index.ts:1137`), add three branches **before** the existing `belongsTo` / `hasOne|hasMany` fallthroughs:

```ts
if (def.type === 'morphTo') {
  // Read both columns off this instance, look up the matching target class.
  const idCol   = `${def.morphName}_id`
  const typeCol = `${def.morphName}_type`
  const idVal   = (this as unknown as Record<string, unknown>)[idCol]
  const typeVal = (this as unknown as Record<string, unknown>)[typeCol]
  if (idVal == null || typeVal == null) {
    throw new Error(`[RudderJS ORM] Cannot resolve morphTo "${name}" on ${ctor.name} — ${idCol}/${typeCol} unset.`)
  }
  const Target = def.types().find(C => (C.morphAlias ?? C.name) === String(typeVal))
  if (!Target) {
    throw new Error(`[RudderJS ORM] morphTo "${name}" on ${ctor.name}: unknown ${typeCol} = ${JSON.stringify(typeVal)}. Allowed: ${def.types().map(C => C.morphAlias ?? C.name).join(', ')}`)
  }
  return Target.where(Target.primaryKey, idVal) as QueryBuilder<Model>
}

if (def.type === 'morphMany' || def.type === 'morphOne') {
  // Parent side. Filter related table by both polymorphic columns.
  const Related = def.model() as typeof Model
  const idCol    = `${def.morphName}_id`
  const typeCol  = `${def.morphName}_type`
  const localCol = def.localKey ?? ctor.primaryKey
  const localVal = (this as unknown as Record<string, unknown>)[localCol]
  const typeVal  = def.morphType ?? ctor.morphAlias ?? ctor.name
  if (localVal == null) {
    throw new Error(`[RudderJS ORM] Cannot resolve "${name}" on ${ctor.name} — ${localCol} is unset.`)
  }
  return Related.where(idCol, localVal).where(typeCol, typeVal) as QueryBuilder<Model>
}
```

`morphOne` and `morphMany` share the same query — the difference is consumer expectation (`first()` vs `get()`). No separate code path needed.

### 3. `Model` static — `morphAlias`

Add alongside the existing `static table` / `static primaryKey` (around line 271):

```ts
/**
 * Discriminator value written to `{morph}_type` columns by polymorphic
 * relations. Defaults to `Class.name`. Override to decouple persisted
 * discriminator from the JS class name (rename-safe storage).
 *
 * @example
 * class BlogPost extends Model {
 *   static override morphAlias = 'post'   // stores 'post', not 'BlogPost'
 * }
 */
static morphAlias?: string
```

Optional, undefined by default — the resolution code uses `Class.morphAlias ?? Class.name` everywhere.

### 4. Writes — convenience helper

Authors writing children typically need to fill both columns. Add a sibling to `Model.belongsToMany` (around line 1195) so the write surface is symmetric:

```ts
/**
 * Build the `{name}_id + {name}_type` payload for a polymorphic write.
 *
 * @example
 * await Comment.create({
 *   body: 'Nice post',
 *   ...Model.morph('commentable', post),
 * })
 * // → { body, commentable_id: post.id, commentable_type: 'Post' }
 */
static morph(name: string, parent: Model): Record<string, unknown> {
  const ctor = parent.constructor as typeof Model
  const pk   = (parent as unknown as Record<string, unknown>)[ctor.primaryKey]
  if (pk == null) {
    throw new Error(`[RudderJS ORM] Model.morph("${name}", parent): parent.${ctor.primaryKey} is unset.`)
  }
  return {
    [`${name}_id`]:   pk,
    [`${name}_type`]: ctor.morphAlias ?? ctor.name,
  }
}
```

Pure helper — no adapter contract change, no observer hooks, no validation.

### 5. Type discriminator — column-name convention

`{morphName}_id` + `{morphName}_type` (snake_case). Matches Laravel + the `belongsToMany` pivot column convention already in use (`pivotTable: 'role_user'`).

**Not exposing a column-name override in v1.** If a user needs `morphedById` / `morphedByType`, they can drop to the adapter — same posture as `belongsToMany`'s deferred overrides. Cheap to add later if requested.

### 6. `ModelLike` contract (`@rudderjs/contracts`)

`ModelLike` already exposes `static relations: Record<string, RelationDefinition>` structurally — no widening needed. The `RelationDefinition` type widening above flows through automatically because the contract uses the same `RelationDefinition` import.

Verify with the existing compile-time line at the bottom of `index.ts`:

```ts
const _modelSatisfiesContract: ModelLike = Model
```

This will catch any missed `morphAlias` field if `ModelLike` ends up needing it surfaced (it doesn't — `morphAlias` is read off the *target* `Model` subclass, not the abstract contract).

### 7. Adapter requirements — none

Resolution uses existing `where()` chains. No new `QueryBuilder` method, no new adapter contract. Mirrors the `hasMany / belongsTo` story, not the `belongsToMany` story.

---

## Implementation tasks

Each task is independently committable.

### Task 1 — Type definitions + `morphAlias` field
- Widen `RelationDefinition` union with the three new variants.
- Add `static morphAlias?: string` to `Model`.
- Update doc comment on `static relations` (`index.ts:322`) — add the polymorphic types to the supported list, drop the OOS sentence.
- Build + typecheck. No behavior change yet.

### Task 2 — `Model.related()` branches
- Add the `morphTo` and `morphMany|morphOne` branches before the existing `belongsTo` / `hasOne|hasMany` fallthroughs.
- Reuse the `(this as unknown as Record<string, unknown>)[col]` pattern from existing branches.

### Task 3 — `Model.morph()` write helper
- Implement as shown in Design § 4.
- Export alongside `Model.belongsToMany`.

### Task 4 — Tests
Add `packages/orm/src/morph.test.ts` (sibling of `index.test.ts`):

| Scenario | Assert |
|---|---|
| `morphMany` read with default morphType | Adapter receives `where('commentable_id', pk)` + `where('commentable_type', 'Post')`. |
| `morphMany` read with `morphAlias` set on parent | type column value = alias, not class name. |
| `morphMany` read with `morphType` override on the relation | overrides the class-level alias. |
| `morphOne` shape identical to morphMany | (smoke — same builder produced). |
| `morphTo` read resolves to correct class | Returns `Target.where(pk_col, id)` builder for the right target. |
| `morphTo` rejects unknown `_type` value | Throws with the allowed-list in the message. |
| `morphTo` rejects null `_id` or `_type` | Throws with the column names. |
| `morphMany` with null parent PK | Throws. |
| `Model.morph('x', parent)` returns correct shape | `{ x_id: pk, x_type: 'ClassName' }`. |
| `Model.morph('x', parent)` honors `morphAlias` | Uses alias. |
| `Model.morph('x', parent)` throws on null pk | Clear message. |

Mirror the test style in `index.test.ts` — use the existing in-memory adapter mock (mock `ModelRegistry.set()` with a query stub that records the chain, like the belongsToMany tests do).

### Task 5 — README + CHANGELOG
- `packages/orm/README.md` line 141: change `Supported types: hasOne, hasMany, belongsTo, belongsToMany.` → add the three morph types. Add a short polymorphic example after the `belongsToMany` block.
- `packages/orm/README.md` line 143: extend the v1-limitations paragraph to also note `morphToMany / morphedByMany` deferred (parallel to existing M2M deferrals).
- `packages/orm/CHANGELOG.md`: new entry — minor bump (additive only).
- `packages/orm/CLAUDE.md` line 23: rewrite the polymorphic sentence — drop OOS framing, add a sentence describing the three supported types + the `morphAlias` convention. Keep the "every Prisma feature we don't shim becomes a gap" caution scoped to `morphToMany`.

### Task 6 — Cut a changeset
```bash
pnpm changeset
# minor bump for @rudderjs/orm. additive only — no consumer migration.
```

Body should mention pilotiq's RelationManager as the unlock motivator.

---

## Pilotiq follow-up (separate plan, not this one)

Once this lands and rudder publishes a minor:

1. Update `packages/pilotiq/src/RelationManager.ts:53` — drop the "polymorphic shapes still gated on ORM support" caveat.
2. Update `packages/pilotiq/src/RelationManager.ts:83` — extend supported scope.
3. Widen `RelationMode` from `'hasMany' | 'belongsToMany'` to add `'morphMany' | 'morphTo'` (morphOne falls under morphMany like hasOne does today).
4. `getRelationType()` in `routes.ts` and `pageData.relationManagerData` — add the morph branches.
5. New `Action.relationMorphAttach` factory (or just rely on regular create + write the morph columns via `ctx.parent` — design call).
6. Playground demo: `Comment` model + `Post / Video` parents with `commentsManager`.

That's a 2–3 day pilotiq follow-up. **Not** this plan's responsibility.

---

## What this plan deliberately doesn't do

- **No `morphMap` global table.** Per-class `morphAlias` covers the rename-safe-storage case; a global table is Laravel ergonomics that don't pull their weight.
- **No `morphToMany` / `morphedByMany`.** v2 once a real consumer hits it. Same posture as `belongsToMany v1` deferred features.
- **No fluent eager-load (`User.with('comments.commentable')`).** Adapter native (`Prisma.include`) still works for eager. Fluent stays lazy-only.
- **No `morphPivot` reads.** Same as `belongsToMany` v1.
- **No automatic constraint setup.** Schema is the user's responsibility. Document the convention; let migrations be migrations.
- **No new `QueryBuilder` adapter contract.** Everything composes from `where()`.

---

## Open questions for the implementer

1. **`morphTo` empty types list** — what's the failure mode? Currently the find-by-name lookup would silently return `undefined`, then the throw in Design § 2 fires. Probably fine. Worth a test.
2. **`morphTo` listing a non-Model class** — TypeScript catches at compile time via the `Array<typeof Model>` constraint. Runtime: trust TS, no extra guard.
3. **Class name collisions** — two registered Models named `'Post'` (different namespaces) would collide on the discriminator. The per-relation `types: () => [Post]` list dodges this for `morphTo`; for `morphMany`, the class storing the value is unambiguous (it's `this`). Document the collision risk in the README polymorphic section.
4. **Soft-deleted polymorphic targets** — `morphTo` resolution goes through `Target.where(...)`, which already honors `Model.softDeletes`. No special handling needed.

---

## File touch list (final)

- `packages/orm/src/index.ts` — type widening + `static morphAlias` + 3 `related()` branches + `Model.morph()` helper
- `packages/orm/src/morph.test.ts` — new
- `packages/orm/README.md` — Relations section
- `packages/orm/CHANGELOG.md` — minor entry
- `packages/orm/CLAUDE.md` — line 23 rewrite
- `.changeset/<random>.md` — generated by `pnpm changeset`

Estimated: half a day for impl + tests + docs. The widening is mechanical; the cleverness already exists in the `belongsToMany` template.
