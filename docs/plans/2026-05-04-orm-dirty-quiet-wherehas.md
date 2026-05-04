# `@rudderjs/orm` — Dirty Tracking, Quiet Event Ops, `whereHas`

**Status:** PROPOSED — design + implementation contract.
**Author handoff:** filed by pilotiq for the next rudder agent. Self-contained.
**Scope:** three small, related Eloquent ergonomics gaps bundled together because they all touch the same Model-instance / QueryBuilder surfaces.

---

## Why bundle these three

Each is small on its own (a few methods, mechanical), but they share the same touchpoints:

- **A. Dirty tracking** + **B. Quiet event ops** both modify `Model` instance internals (`_original` snapshot, `_eventsMuted` propagation through instance writes).
- **B. Quiet event ops** + **C. `whereHas`** both extend the consumer-facing chainable surface (instance methods / QueryBuilder methods).
- All three are additive — no consumer migration, no breaking changes — and each pairs a feature in `@rudderjs/orm` with at most a small adapter delta.

Splitting into three PRs is fine; the design is presented as one plan because review benefits from seeing the shared `_original` snapshotting + the shared event-mute propagation together. If you implement in three PRs, do them in order **A → B → C** — quiet ops use the original-snapshot from A as their reset point.

---

## Pitfalls reviewed up front

1. **Query results ARE Model instances** (CLAUDE.md root + `packages/orm/CLAUDE.md`). All three features must work on hydrated query results, not just `new Model()` constructions. The hydrating QueryBuilder Proxy at `index.ts:641` is the boundary — any per-instance state set during construction must also be set during hydration. **For dirty tracking that means: `Model.hydrate(record)` and the Proxy in `_hydratingQb` must capture the original snapshot.**
2. **`#`-private fields don't appear in `Object.entries`** (CLAUDE.md "Internal fields are `#`-private"). Use `#originalAttributes` not `_originalAttributes` so Prisma writes via `_toData()` stay clean. The `_toData()` filter at `index.ts:1027` strips `_`-prefixed enumerables but won't see `#` fields at all — better.
3. **`exactOptionalPropertyTypes` is on.** Optional fields hold a real value or are absent — never `undefined`. Use `?: T` and `delete` rather than assigning `undefined`.
4. **Static factory `this` constraint** (memory note `feedback_static_factory_this_constraint`). Anywhere we accept a Model class, type as `typeof Model` or `new (...args: any[]) => T`, never `unknown[]`.
5. **`whereHas` is adapter-dependent.** Prisma has native `some/none/every`. Drizzle does not — needs a correlated `EXISTS` subquery via `inArray(parent.id, db.select(...).from(...))`. The contract has to admit "subquery for relation X with these wheres" without leaking driver types.

---

# A. Dirty Tracking

Track per-instance attribute mutations relative to the last saved/loaded state. Pure-instance feature, no adapter changes, no observer changes.

## A.1 Public API

Six instance methods. All sync. All operate on **column attributes only** — `_`-prefixed and `#`-private internals are never reported.

```ts
class Model {
  /** True if any attribute (or the named attribute) has been changed since
   *  the last save / load / refresh. */
  isDirty(key?: string): boolean

  /** Inverse of isDirty. */
  isClean(key?: string): boolean

  /** True if the named attribute (or any attribute) was actually changed
   *  on the most recent save() — i.e. its value differs from what it
   *  was *before* that save. Stays true until the next save() or refresh(). */
  wasChanged(key?: string): boolean

  /** Snapshot value(s) as of the last save / load / refresh. With a key,
   *  returns that single original value; without, returns the full snapshot. */
  getOriginal<T = unknown>(key: string): T
  getOriginal(): Record<string, unknown>

  /** Diff map of attributes that changed during the most recent save(). */
  getChanges(): Record<string, unknown>

  /** Diff map of attributes currently dirty (unsaved). */
  getDirty(): Record<string, unknown>
}
```

## A.2 Implementation sketch (`packages/orm/src/index.ts`)

Add three private fields next to `#instanceHidden` (~ line 533):

```ts
/** @internal — snapshot of own enumerable column values as of last load/save.
 *  Set by hydrate(), Object.assign-after-save in save()/refresh(),
 *  and the constructor (empty {}). */
#original: Record<string, unknown> = {}

/** @internal — diff of attributes that changed on the most recent save().
 *  Populated by save() right before it Object.assigns persisted columns back.
 *  Empty until the first save(). */
#changes: Record<string, unknown> = {}
```

Then add a helper for "current column attributes" — same filter `_toData()` already uses, but exported at instance scope so dirty + data share one definition:

```ts
/** @internal — current own-property column attributes, with framework
 *  `_` keys + `undefined` placeholders dropped. Same set _toData()
 *  emits, kept in sync. */
private _currentAttrs(): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(this)) {
    if (k.startsWith('_')) continue
    if (v === undefined) continue
    out[k] = v
  }
  return out
}
```

Refactor `_toData()` to call `_currentAttrs()` (mechanical — same body).

Add the public methods after `replicate()` (~ line 1181):

```ts
isDirty(key?: string): boolean {
  const dirty = this.getDirty()
  return key === undefined ? Object.keys(dirty).length > 0 : key in dirty
}

isClean(key?: string): boolean { return !this.isDirty(key) }

wasChanged(key?: string): boolean {
  return key === undefined
    ? Object.keys(this.#changes).length > 0
    : key in this.#changes
}

getOriginal<T = unknown>(key?: string): T | Record<string, unknown> {
  if (key === undefined) return { ...this.#original }
  return this.#original[key] as T
}

getChanges(): Record<string, unknown> { return { ...this.#changes } }

getDirty(): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const current = this._currentAttrs()
  for (const k of new Set([...Object.keys(current), ...Object.keys(this.#original)])) {
    if (!_attrEqual(current[k], this.#original[k])) out[k] = current[k]
  }
  return out
}
```

Equality helper at file scope — explicit, no surprises:

```ts
/** @internal — value equality used by dirty tracking. Mirrors Eloquent's
 *  `originalIsEquivalent`: strict for primitives, structural-by-JSON for
 *  arrays/plain objects (covers `json`/`array` casts), Date-by-getTime,
 *  null/undefined collapsed. */
function _attrEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a == null && b == null) return true            // null/undefined collapse
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime()
  // Treat plain objects + arrays structurally; cheap JSON.stringify dodge
  // — same posture Laravel takes for `casts: array` / `casts: json` fields.
  if (typeof a === 'object' && typeof b === 'object') {
    try { return JSON.stringify(a) === JSON.stringify(b) } catch { return false }
  }
  return false
}
```

## A.3 Snapshotting — every load / save / refresh path

Three places need to capture `#original` from the current attrs. A small private helper keeps them aligned:

```ts
/** @internal — capture the current attrs as the new "original" baseline.
 *  Called after hydrate, after save (with the persisted record), and
 *  after refresh. */
private _syncOriginal(): void {
  this.#original = this._currentAttrs()
}
```

Touchpoints:

| Where | What changes |
|---|---|
| `Model.hydrate()` (~ line 631) | After `Object.assign(instance, record)`, call `instance._syncOriginal()`. |
| `_hydratingQb()` (~ line 643) | Already calls `Model.hydrate.call(self, r)` for every wrap — covered transitively. **No extra change.** |
| `instance.save()` (~ line 1045) | After `Object.assign(this, persisted)`, compute changes vs `#original`, then `_syncOriginal()`. See snippet below. |
| `instance.refresh()` (~ line 1086) | After the in-place re-assign, call `_syncOriginal()`. Reset `#changes` to `{}` (refresh discards pending writes). |
| `instance.replicate()` (~ line 1162) | The clone is unsaved → `#original` should be `{}`, `#changes` `{}`. The `new Ctor()` already initializes both to `{}` via the field defaults. **No extra change.** |
| Class-field defaults | Constructor runs once per instance — `#original = {}` covers `new Model()` + `Object.create`-via-`hydrate`. |

`save()` change inside the existing body:

```ts
async save(): Promise<this> {
  const ctor = this.constructor as typeof Model
  const data = this._toData()
  const id   = this._getKey()
  const persisted = id === undefined
    ? await Model._doCreate.call(ctor, data)
    : await Model._doUpdate.call(ctor, id, data)
  Object.assign(this, persisted)

  // ── New: compute changes vs prior baseline, then re-baseline. ─────
  const next: Record<string, unknown> = this._currentAttrs()
  const diff: Record<string, unknown> = {}
  for (const k of new Set([...Object.keys(next), ...Object.keys(this.#original)])) {
    if (!_attrEqual(next[k], this.#original[k])) diff[k] = next[k]
  }
  this.#changes  = diff
  this.#original = next
  return this
}
```

## A.4 Edge cases (A)

- **JSON / array casts** — values arrive as objects (post `castGet`). `_attrEqual`'s JSON-stringify fallback handles these. Caveat: key-order-sensitive — `{a:1,b:2}` vs `{b:2,a:1}` will compare unequal under JSON.stringify. Acceptable trade-off (mirrors Laravel); the README must document it.
- **Date casts** — `castGet` returns `Date` instances; `_attrEqual` short-circuits via `getTime()`. No surprises.
- **Encrypted casts** — decrypted values may not round-trip equal under JSON.stringify if the underlying value is a complex object. Document in README; acceptable.
- **Class-field `id!: number`** — declared field is `undefined` at construction, filtered out of `#original` by `_currentAttrs()`. After `save()`, the persisted `id` lands and is captured. So `isDirty('id')` is correctly `false` post-save.
- **Direct property assignment then `refresh()`** — refresh discards pending writes; explicitly re-set `#changes = {}` in the helper above so `getChanges()` is empty after refresh.
- **`forceFill()` / `fill()` / direct property writes** — all just set own enumerables; no special handling. `#original` remains the last-saved baseline; `getDirty()` will reflect the new values immediately.
- **Counter columns via `instance.increment()`** — increments `Object.assign` the persisted record back. Run `_syncOriginal()` at the bottom of `instance.increment()` and `instance.decrement()` so the new counter value becomes the baseline (otherwise the next `isDirty()` would treat the bumped column as dirty).

## A.5 Tests (A)

`packages/orm/src/dirty.test.ts` (new file, follow `morph.test.ts` style):

| Scenario | Assert |
|---|---|
| `new Model()` then property set | `isDirty()` true; `isDirty('name')` true; `getDirty()` shape. |
| `Model.hydrate(record)` no mutation | `isDirty()` false; `getOriginal()` matches input. |
| Hydrated row mutated | `isDirty('email')` true; `getOriginal('email')` is pre-mutation value. |
| `await instance.save()` after mutation | `isDirty()` false; `wasChanged('email')` true; `getChanges()` populated. |
| Second save without mutation | `wasChanged()` false; `getChanges()` empty. |
| `await Model.find(id)` then mutate then `refresh()` | `isDirty()` false; `getChanges()` empty. |
| JSON cast — same object identity | `isDirty()` false. |
| JSON cast — same content, different reference | `isDirty()` false (structural equality). |
| Date cast — same epoch | `isDirty()` false. |
| `instance.increment('viewCount')` | `isDirty('viewCount')` false after the call (baseline updated). |
| `replicate()` clone | `isDirty()` true (clone has values, no `#original`); `getOriginal()` empty. |

---

# B. Quiet Event Ops

Three instance-side variants that mute observers + listeners for the duration of one operation, building on the existing `Model.withoutEvents(fn)` (`index.ts:852`).

## B.1 Public API

```ts
class Model {
  /** Persist this instance without firing observer / listener events.
   *  Equivalent to `await Model.withoutEvents(() => instance.save())`. */
  saveQuietly(): Promise<this>

  /** Delete this instance without firing observer / listener events. */
  deleteQuietly(): Promise<void>

  /** Restore this soft-deleted instance without firing observer / listener events. */
  restoreQuietly(): Promise<this>
}
```

## B.2 Implementation sketch (`packages/orm/src/index.ts`)

All three are one-liners delegating to `withoutEvents`:

```ts
async saveQuietly(): Promise<this> {
  const ctor = this.constructor as typeof Model
  return ctor.withoutEvents(() => this.save())
}

async deleteQuietly(): Promise<void> {
  const ctor = this.constructor as typeof Model
  await ctor.withoutEvents(() => this.delete())
}

async restoreQuietly(): Promise<this> {
  const ctor = this.constructor as typeof Model
  const id = this._getKey()
  if (id === undefined) {
    throw new Error(`[RudderJS ORM] Cannot restore a ${ctor.name} without a primary key.`)
  }
  await ctor.withoutEvents(async () => {
    const restored = await (ctor as typeof Model & {
      restore(i: string | number): Promise<Model>
    }).restore(id)
    Object.assign(this, restored)
  })
  // Re-baseline original after silent restore so dirty tracking is consistent.
  this._syncOriginal()
  return this
}
```

`restore` has no instance-method counterpart today (the static `Model.restore()` exists, but no `instance.restore()`). Add a public `instance.restore()` for symmetry:

```ts
async restore(): Promise<this> {
  const ctor = this.constructor as typeof Model
  const id = this._getKey()
  if (id === undefined) {
    throw new Error(`[RudderJS ORM] Cannot restore a ${ctor.name} without a primary key.`)
  }
  const restored = await (ctor as typeof Model & {
    restore(i: string | number): Promise<Model>
  }).restore(id)
  Object.assign(this, restored)
  this._syncOriginal()
  return this
}
```

`restoreQuietly` then collapses to `ctor.withoutEvents(() => this.restore())`. (`_syncOriginal` runs inside the silent `restore()`, so it lands before `withoutEvents` exits.)

## B.3 Edge cases (B)

- **Cascading observers** — `Model.withoutEvents` mutes only the *current* class. If your `UserObserver.deleted` cascades to `Comment.delete()`, the `Comment` class still fires its own observers. **This is intentional** — same semantics as Eloquent's `saveQuietly`. Document explicitly so users know quiet ops are per-class, not "for the whole tree."
- **Concurrent quiet calls on the same class** — `_eventsMuted` is a single class-level boolean. `Model.withoutEvents`'s `try/finally` already handles nested calls (`previous` is captured), so two concurrent quiet ops cooperate correctly: outer sees true through inner's finally.
- **Errors inside the quiet op** — `withoutEvents`'s `finally` restores the previous value. Quiet ops surface the original error.
- **`restoreQuietly` on a non-soft-deleted record** — same behavior as `Model.restore()`: writes `deletedAt: null` (a no-op for already-restored rows). No special handling.

## B.4 Tests (B)

Add to existing `index.test.ts` (alongside the `withoutEvents` test if one exists, or as a new `describe`):

| Scenario | Assert |
|---|---|
| `instance.saveQuietly()` after dirty mutation | Observer's `saving` / `saved` not invoked; row IS persisted. |
| `instance.deleteQuietly()` | Observer's `deleting` / `deleted` not invoked; row removed (or soft-deleted). |
| `instance.restoreQuietly()` on soft-deleted row | Observer's `restoring` / `restored` not invoked; `deletedAt` cleared; instance reflects fresh row. |
| `saveQuietly()` then non-quiet `save()` | Second save fires observers normally — mute does not leak. |
| Nested quiet ops on the same class | Both silent; inner's finally restores outer-true. |
| Quiet op observer cascades to child class | Child class's observers DO fire (per-class isolation). |
| `instance.restore()` non-quiet | Standard observer flow — used as a sanity check that the new instance method works. |

---

# C. `whereHas` / `whereDoesntHave` / `withWhereHas` / `whereBelongsTo`

Filter a query by a relation predicate. The Eloquent surface that closes the largest remaining "I miss this from Laravel" gap.

## C.1 Public API

```ts
class Model {
  /** Filter rows where the named relation has at least one matching row.
   *  The optional callback receives a sub-QueryBuilder scoped to the
   *  related model — chain `where()` etc. on it to narrow further. */
  static whereHas<T extends typeof Model>(
    this: T,
    relation: string,
    constrain?: (q: QueryBuilder<Model>) => void,
  ): QueryBuilder<InstanceType<T>>

  /** Inverse — rows where the named relation has zero matching rows. */
  static whereDoesntHave<T extends typeof Model>(
    this: T,
    relation: string,
    constrain?: (q: QueryBuilder<Model>) => void,
  ): QueryBuilder<InstanceType<T>>

  /** whereHas + with — filter by the relation predicate AND eager-load
   *  the matching rows under the same constraint. Sugar for the common
   *  pair, mirrors Laravel 9+. */
  static withWhereHas<T extends typeof Model>(
    this: T,
    relation: string,
    constrain?: (q: QueryBuilder<Model>) => void,
  ): QueryBuilder<InstanceType<T>>

  /** Filter rows whose belongsTo relation points at the given parent
   *  instance. Sugar for `where(localKey, parent.primaryKeyValue)`,
   *  resolves the local key from the relation declaration. */
  static whereBelongsTo<T extends typeof Model>(
    this: T,
    parent: Model,
    relation?: string,
  ): QueryBuilder<InstanceType<T>>
}
```

The same four methods are also chainable on `QueryBuilder`:

```ts
interface QueryBuilder<T> {
  whereHas(relation: string, constrain?: (q: QueryBuilder<unknown>) => void): this
  whereDoesntHave(relation: string, constrain?: (q: QueryBuilder<unknown>) => void): this
  withWhereHas(relation: string, constrain?: (q: QueryBuilder<unknown>) => void): this
  whereBelongsTo(parent: { constructor: typeof Model } & Record<string, unknown>, relation?: string): this
}
```

## C.2 Adapter contract change (`packages/contracts/src/index.ts`)

The QueryBuilder needs three new methods. They take the adapter information needed to express a relation existence predicate without leaking ORM-package types:

```ts
export interface RelationExistencePredicate {
  /** Relation name on the *parent* model (the one being queried). Adapter uses
   *  this only for clearer error messages; the structural fields below carry
   *  the actual join data. */
  relation:        string
  /** Polarity. */
  exists:          boolean
  /** Related table name (already resolved by Model). */
  relatedTable:    string
  /** Column on the parent table joined against `relatedColumn`. */
  parentColumn:    string
  /** Column on the related table joined against `parentColumn`. */
  relatedColumn:   string
  /** Where clauses to AND into the relation subquery. Built by chaining
   *  `where()` on the constrain callback's QueryBuilder. */
  constraintWheres: WhereClause[]
  /** Optional second AND filter — used by morph relations (`type` discriminator)
   *  and by belongsToMany (pivot side). Both are simple equality predicates so
   *  a flat object suffices; if/when we need richer predicates here, widen to
   *  `WhereClause[]`. */
  extraEquals?:    Record<string, unknown>
  /** For belongsToMany / morphToMany — pivot is a separate table the relation
   *  passes through. When set, the subquery is two-step: pivot-table where
   *  parent_id = parent.col AND <extras>, returning related_id, then the related
   *  table is filtered to `WHERE related.pk IN (...)` AND constraintWheres.
   *  When undefined, the subquery is a single direct EXISTS. */
  through?: {
    pivotTable:      string
    foreignPivotKey: string  // column = parent.col
    relatedPivotKey: string  // column projected for the inner select
  }
}

export interface QueryBuilder<T> {
  // ...existing methods...

  /**
   * Add an EXISTS / NOT EXISTS subquery filter representing a relation predicate.
   * Adapters translate this into their native shape (Prisma → some/none filter,
   * Drizzle → correlated subquery via `inArray`/`notInArray`).
   */
  whereRelationExists(predicate: RelationExistencePredicate): this

  /**
   * Eager-load the named relation, optionally constrained to rows matching the
   * supplied where clauses. Pairs with `with()` semantics — adapters that don't
   * support a constrained include (Drizzle today) may apply the filter in JS or
   * throw a clear `not yet supported on this adapter` error.
   */
  withConstrained?(relation: string, constraintWheres: WhereClause[]): this
}
```

Why a structural `RelationExistencePredicate` and not raw "relation name" passed through to the adapter? Adapters **don't know about Model relations** — `RelationDefinition` lives in `@rudderjs/orm`. Resolving the join, table name, FK, and pivot data has to happen in the Model layer; the adapter sees a generic "subquery against table X joined on cols Y/Z with these wheres."

## C.3 Implementation sketch — Model side

Add at static-methods region (after `where`, ~ line 800):

```ts
static whereHas<T extends typeof Model>(
  this: T,
  relation: string,
  constrain?: (q: QueryBuilder<Model>) => void,
): QueryBuilder<InstanceType<T>> {
  return _attachWhereHas(this, Model._q(this), relation, true, constrain)
}

static whereDoesntHave<T extends typeof Model>(
  this: T,
  relation: string,
  constrain?: (q: QueryBuilder<Model>) => void,
): QueryBuilder<InstanceType<T>> {
  return _attachWhereHas(this, Model._q(this), relation, false, constrain)
}

static withWhereHas<T extends typeof Model>(
  this: T,
  relation: string,
  constrain?: (q: QueryBuilder<Model>) => void,
): QueryBuilder<InstanceType<T>> {
  const q = _attachWhereHas(this, Model._q(this), relation, true, constrain)
  // Eager-load. Constrained-eager goes through withConstrained when available;
  // when unavailable, drop to plain with() and document the gap.
  const wheres = _captureConstraintWheres(this, relation, constrain)
  if (wheres.length > 0 && (q as unknown as { withConstrained?: unknown }).withConstrained) {
    return (q as unknown as { withConstrained: QueryBuilder<InstanceType<T>>['with'] })
      .withConstrained(relation, wheres) as QueryBuilder<InstanceType<T>>
  }
  return q.with(relation)
}

static whereBelongsTo<T extends typeof Model>(
  this: T,
  parent: Model,
  relation?: string,
): QueryBuilder<InstanceType<T>> {
  // Find the matching belongsTo declaration. If `relation` is omitted, look for
  // a single belongsTo to `parent.constructor`; throw if 0 or 2+.
  const ParentCtor = parent.constructor as typeof Model
  const def = _resolveBelongsToFor(this as typeof Model, ParentCtor, relation)
  const Related = def.model() as typeof Model
  const fk = def.foreignKey ?? `${_camelHead(Related.name)}Id`
  const parentVal = (parent as unknown as Record<string, unknown>)[ParentCtor.primaryKey]
  if (parentVal === undefined || parentVal === null) {
    throw new Error(`[RudderJS ORM] whereBelongsTo: parent.${ParentCtor.primaryKey} is unset.`)
  }
  return Model._q(this).where(fk, parentVal)
}
```

`_attachWhereHas` builds the `RelationExistencePredicate` from the relation definition by mirroring `Model.related()`'s join logic, calls `q.whereRelationExists(predicate)`, and returns the chain. `_captureConstraintWheres` runs the constrain callback against a recording-only sub-QueryBuilder (records `where()` calls into a `WhereClause[]`, every other method is a no-op chainable) and returns the captured array — same trick `morph.test.ts` uses for assertion.

The function dispatches by relation type:

| Relation | parentColumn / relatedColumn / through |
|---|---|
| `hasMany` / `hasOne` | parent: `localKey ?? primaryKey` ; related: `foreignKey ?? camel(parent.name) + 'Id'` ; no through. |
| `belongsTo` | parent: `foreignKey ?? camel(related.name) + 'Id'` ; related: `Related.primaryKey` ; no through. |
| `belongsToMany` | through: pivot table + foreignPivotKey + relatedPivotKey ; parent: `parentKey ?? primaryKey` ; related: `relatedKey ?? Related.primaryKey`. |
| `morphMany` / `morphOne` | parent: `localKey ?? primaryKey` ; related: `{morphName}Id` ; `extraEquals: { '{morphName}Type': discriminator }`. |
| `morphToMany` / `morphedByMany` | through: pivot ; `extraEquals` carries the discriminator on the pivot. |
| `morphTo` | **Not supported.** Throw a clear "morphTo cannot be used with whereHas — the related table is dynamic." |

## C.4 Implementation sketch — Prisma adapter

Prisma has native `some` / `none` filters. Map directly:

```ts
whereRelationExists(p: RelationExistencePredicate): this {
  // Translate WhereClause[] → Prisma filter object using the existing
  // clauseToFilter() logic.
  const constraintFilter = this.combineWheres(p.constraintWheres)
  const extra = p.extraEquals ?? {}

  if (p.through) {
    // belongsToMany / morphToMany — pivot-mediated.
    // Approach: subquery via raw findMany of pivot table to get related ids,
    // then `WHERE pk IN (...)` AND constraint. Prisma doesn't expose `EXISTS`
    // for arbitrary tables without a defined relation, so we run a 2-step
    // query at adapter boundary. Same posture deleteAll() takes.
    this._wheres.push({
      column: '__relation_exists__',
      operator: '=',
      value: { ...p, polarity: p.exists ? 'in' : 'notIn' },
    })
    return this
  }

  // hasMany / hasOne / belongsTo / morphMany / morphOne — Prisma `some`/`none`.
  // Requires the relation to be declared on the Prisma schema with the same name.
  // Map the relation name to Prisma's nested filter:
  //   { posts: { some: { ...constraint, ...extra } } }
  // For `none`: `{ posts: { none: { ... } } }`
  this._wheres.push({
    column: p.relation,
    operator: '=',
    value: { [p.exists ? 'some' : 'none']: { ...constraintFilter, ...extra } },
  })
  return this
}
```

`buildWhere()` recognises the special-shape values via instanceof check or a sentinel and skips the `clauseToFilter` branch for them.

**Caveat for Prisma + pivot relations:** Prisma's M2M models the pivot as an implicit relation. If the user declares `belongsToMany` against an explicit pivot table (the common case in our ORM), Prisma's schema still needs an `@relation` declared between Parent and Related. Document: "whereHas through belongsToMany requires the relation to be declared in `schema.prisma`." If Prisma can't resolve the relation by name, the query fails at runtime with Prisma's own error — surface it; don't wrap.

## C.5 Implementation sketch — Drizzle adapter

Drizzle has no native `some/none` shorthand — use a correlated `EXISTS` subquery:

```ts
whereRelationExists(p: RelationExistencePredicate): this {
  // Build inner select: select <related.relatedColumn> from related where <constraints>
  const RelatedTable = DrizzleTableRegistry.get(p.relatedTable)
    ?? this._resolveTableFromConfig(p.relatedTable)
  if (!RelatedTable) throw new Error(
    `[RudderJS ORM Drizzle] whereHas: no table schema registered for "${p.relatedTable}".`
  )

  const parentCol  = this.col(p.parentColumn) as Column
  const relCol     = (RelatedTable as Record<string, unknown>)[p.relatedColumn] as Column

  let inner = this.db.select({ id: relCol }).from(RelatedTable)

  const innerExprs: SQL[] = [eq(relCol, parentCol) as SQL]
  for (const w of p.constraintWheres) innerExprs.push(_clauseToExprOn(RelatedTable, w))
  for (const [k, v] of Object.entries(p.extraEquals ?? {})) {
    innerExprs.push(eq((RelatedTable as Record<string, unknown>)[k] as Column, v) as SQL)
  }
  inner = inner.where(and(...innerExprs))

  if (p.through) {
    // Pivot-mediated — replace the inner select shape:
    // SELECT pivot.relatedPivotKey FROM pivot WHERE pivot.foreignPivotKey = parent.col [AND extras]
    // then nest a second EXISTS into related table for constraintWheres.
    // Implementation: use exists() if drizzle exposes it; fall back to inArray
    // with the two-step build. See adapter task list below.
  }

  // Add `EXISTS (inner)` or `NOT EXISTS (inner)` to outer wheres.
  // Drizzle's `exists()` helper is the cleanest path.
  const expr = (p.exists ? exists(inner) : notExists(inner)) as SQL
  this._extraExprs.push(expr)  // new array merged into buildConditions()
  return this
}
```

`_clauseToExprOn(table, w)` is `clauseToExpr` parameterised by the table object (the existing one always uses `this.table`). Refactor to share.

`_extraExprs: SQL[]` is a new private field; `buildConditions()` merges it into `andExprs` before combining.

## C.6 Edge cases (C)

- **Nested constraints** — the constrain callback receives a real-ish QueryBuilder that records `.where()` chains. Nested `whereHas` inside the constraint is **deferred to v2** — would require recursive predicate building. v1 throws if a nested `whereHas` is invoked inside the constrain callback.
- **`whereDoesntHave` with constraints** — Eloquent's nuance: "doesn't have any matching the constraint" vs "doesn't have any at all." Our impl matches the constraint-aware variant — `NOT EXISTS (inner WHERE constraint)`.
- **`withWhereHas` constraint applied to eager-load** — Prisma supports nested `where` inside `include`. Drizzle does not (relational query API has its own `with(..., { where })` shape we don't currently surface). Drizzle path: throw a clear `not supported on @rudderjs/orm-drizzle yet — call .with() and filter in code` until we wire it up.
- **`whereBelongsTo` with an unsaved parent** — throws (parent has no PK).
- **`whereBelongsTo` ambiguous when no relation name** — Class has two belongsTo to the same parent (rare but real). Throw with the candidate names listed.
- **`morphTo` parent in `whereHas`** — explicitly unsupported; the predicate has no fixed related table. Document.
- **Soft deletes inside the relation predicate** — the `whereRelationExists` predicate runs against the *adapter's* table. Soft-delete filtering on the related side is the constrain callback's responsibility; document `q.where('deletedAt', null)` as the explicit pattern. (Auto-applying soft-delete scopes inside the predicate would require knowing the related Model class on the adapter side — out of scope for v1.)

## C.7 Tests (C)

`packages/orm/src/whereHas.test.ts` (new):

| Scenario | Assert |
|---|---|
| `User.whereHas('posts')` with no constraint | `whereRelationExists` called once with `{ exists: true, relation: 'posts', relatedTable: 'posts', parentColumn: 'id', relatedColumn: 'userId', constraintWheres: [] }`. |
| `User.whereHas('posts', q => q.where('published', true))` | constraintWheres has one clause. |
| `whereDoesntHave` | predicate `exists: false`. |
| `withWhereHas` calls `with()` AND `whereRelationExists` | both fire (or `withConstrained` if adapter supports it). |
| `whereHas` over `belongsToMany` | predicate `through` populated; pivot table + columns set. |
| `whereHas` over `morphMany` | predicate `extraEquals` carries discriminator. |
| `whereHas` over `morphTo` | throws with helpful message. |
| `whereBelongsTo(post, 'author')` | adds equality `where('authorId', post.id)`. |
| `whereBelongsTo(post)` with single inferred relation | resolves automatically. |
| `whereBelongsTo(post)` with multiple candidate relations | throws ambiguity error listing names. |
| `whereBelongsTo` with unsaved parent | throws. |
| Nested `whereHas` inside constrain callback | throws v1-deferred error. |

Adapter-level tests for `orm-prisma` and `orm-drizzle`: `packages/orm-prisma/src/whereHas.test.ts` + `packages/orm-drizzle/src/whereHas.test.ts`. Each runs against a small in-memory schema (Prisma adapter test uses the existing Prisma client mock; Drizzle uses `better-sqlite3` in-memory `:memory:` like other adapter tests). Smoke matrix: hasMany, belongsTo, belongsToMany, morphMany, morphToMany, polarity true/false, with/without constraint.

---

## Out of scope (this plan)

- **Nested `whereHas` inside constraint callbacks.** Throws v1-deferred error.
- **`has(...)` / `doesntHave(...)`** Eloquent shorthands — sugar over `whereHas` with no constraint. Trivially adds; defer until requested.
- **Counting relations** — `withCount('posts')`, `whereHas('posts', q => q.count('>=', 5))`. Separate plan; needs aggregate predicate support in the adapter contract.
- **Auto soft-delete scoping inside the relation predicate.** Constrain callback can do it manually.
- **`morphTo` in `whereHas`.** Throws; would need adapter-level UNION across all listed types — separate plan if/when demand exists.
- **Drizzle constrained eager-load.** `withWhereHas` falls back to plain `with()` on Drizzle for v1; plumb `withConstrained` in a follow-up.
- **Dirty tracking for relations** (e.g. `isDirty('posts')` on a hydrated `with(...)` result). Eloquent doesn't track relation arrays as dirty; we won't either.
- **`getRawOriginal()`** — Eloquent's pre-cast snapshot accessor. Defer; `getOriginal()` returns post-cast values which is what 99% of consumers want.

---

## Implementation tasks

### Task 1 — Dirty tracking (A)
- Add `#original` + `#changes` private fields, `_currentAttrs()`, `_syncOriginal()`, equality helper.
- Wire `_syncOriginal()` into `Model.hydrate`, `instance.save()`, `instance.refresh()`, `instance.increment/decrement`.
- Add the six public methods.
- Tests: `packages/orm/src/dirty.test.ts`.
- README: new "Dirty Tracking" subsection between "Querying" and "Soft Deletes". Document JSON-equality caveat.

### Task 2 — Quiet event ops (B)
- Add `instance.restore()` (new symmetry method).
- Add `saveQuietly`, `deleteQuietly`, `restoreQuietly`.
- Tests: extend `index.test.ts`.
- README: short "Quiet Events" subsection inside "Observers".

### Task 3 — `whereHas` adapter contract (C — contracts)
- Widen `QueryBuilder<T>` with `whereRelationExists` + optional `withConstrained`.
- Add `RelationExistencePredicate` interface.
- Build + typecheck root.

### Task 4 — `whereHas` Model side (C — orm)
- Implement `_attachWhereHas`, `_resolveBelongsToFor`, `_captureConstraintWheres`.
- Add the four static methods + matching mirror chainable methods on the hydrating QueryBuilder Proxy.
- Tests: `packages/orm/src/whereHas.test.ts`.

### Task 5 — Prisma adapter (C — orm-prisma)
- Implement `whereRelationExists` using `some`/`none` for direct relations and the two-step pivot fallback.
- Implement `withConstrained` mapping to nested `include: { rel: { where: ... } }`.
- Tests: `packages/orm-prisma/src/whereHas.test.ts`.

### Task 6 — Drizzle adapter (C — orm-drizzle)
- Add `_extraExprs: SQL[]`, refactor `clauseToExpr` to take a table param.
- Implement `whereRelationExists` using `exists()` / `notExists()` for direct, and 2-step inArray for pivot.
- Throw clear error for `withConstrained` (deferred).
- Tests: `packages/orm-drizzle/src/whereHas.test.ts`.

### Task 7 — README + CHANGELOG + CLAUDE.md
- `packages/orm/README.md` — new subsections (dirty, quiet, whereHas).
- `packages/orm/CHANGELOG.md` — minor (additive only).
- `packages/orm-prisma/CHANGELOG.md` — minor (new method).
- `packages/orm-drizzle/CHANGELOG.md` — minor (new method).
- `packages/contracts/CHANGELOG.md` — minor (interface widening; structural — no breaking change for existing adapter implementations because the new method is required, but only `@rudderjs/orm` calls it; document in CHANGELOG that out-of-tree adapters need to add a method).
- `packages/orm/CLAUDE.md` — extend the relations section with the whereHas behaviour and the morphTo limitation.

### Task 8 — Changesets
```bash
pnpm changeset
# Minor: @rudderjs/orm, @rudderjs/orm-prisma, @rudderjs/orm-drizzle, @rudderjs/contracts
```

---

## File touch list (final)

- `packages/orm/src/index.ts` — dirty fields + helpers + 6 dirty methods, instance.restore + 3 quiet ops, 4 whereHas statics + helpers.
- `packages/orm/src/dirty.test.ts` — new
- `packages/orm/src/whereHas.test.ts` — new
- `packages/orm/src/index.test.ts` — quiet-ops describe block
- `packages/orm/README.md` — dirty + quiet + whereHas subsections
- `packages/orm/CHANGELOG.md` — minor
- `packages/orm/CLAUDE.md` — relations section update
- `packages/contracts/src/index.ts` — `RelationExistencePredicate` + 2 QueryBuilder methods
- `packages/contracts/CHANGELOG.md` — minor
- `packages/orm-prisma/src/index.ts` — `whereRelationExists`, `withConstrained`
- `packages/orm-prisma/src/whereHas.test.ts` — new
- `packages/orm-prisma/CHANGELOG.md` — minor
- `packages/orm-drizzle/src/index.ts` — `whereRelationExists`, `_extraExprs`, refactor `clauseToExpr`
- `packages/orm-drizzle/src/whereHas.test.ts` — new
- `packages/orm-drizzle/CHANGELOG.md` — minor
- `.changeset/<random>.md` — generated by `pnpm changeset`

Estimated: 1.5 days. A is mechanical (~ 2 hours including tests). B is trivial (~ 1 hour). C is the bulk — half-day each for Model side + Prisma + Drizzle, plus tests.

---

## Open questions for the implementer

1. **Should `getOriginal()` return cast or raw values?** Plan above returns post-`Object.assign` values, which means **as-stored after the persisted record came back from the adapter** — i.e. whatever shape the adapter gives us. For SQLite + Prisma that's already-decoded JSON for `Json` columns and `Date` for `DateTime`, matching what `castGet` would produce. Confirm by spot-checking a JSON column round-trip in the test.
2. **Does `wasChanged()` survive a refresh?** Plan: refresh resets `#changes` to `{}`. Eloquent keeps `wasChanged` populated even after a refresh until the next save. We diverge intentionally — refresh is "throw away pending state, re-read from DB" and pending changes don't make sense to retain. Worth a one-line README mention.
3. **`withWhereHas` SQL semantics on Prisma's pivot path.** Prisma's nested-include `where` works for explicit-relation models; for our `belongsToMany` pivot pattern (no Prisma `@relation`), the constraint can't be applied to the include directly. Falls back to plain `with()` + an unrelated `whereRelationExists` filter on the parent. Document the gap.
4. **Drizzle `exists()` import surface.** `drizzle-orm` exports `exists` and `notExists` from the root barrel as of 0.30+; pin the orm-drizzle minor dep accordingly. If we're below that, bump.
