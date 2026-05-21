# Framework ORM correctness fixes

**Status:** OPEN 2026-05-21
**Scope:** `@rudderjs/orm`, `@rudderjs/orm-prisma`, `@rudderjs/orm-drizzle`
**Source:** Senior-engineer code review pass, 2026-05-21
**Severity:** 5 findings — 1 cross-tenant data leak risk, 1 hardcoded-PK design flaw, 1 adapter divergence codified by tests, 1 MySQL-breaks-Drizzle, 1 deferred-pivot Proxy race

This is the most surgical of the four framework plans because the fixes affect a public API used by every app. Several phases will need careful migration paths.

---

## Phase 1 — `find(id)` composes wheres / scopes / soft-deletes 🚨

**Severity:** high — cross-tenant data leak by default; `User.where('tenantId', t).find(5)` returns rows across tenants
**Effort:** ~1h + tests on both adapters

### The bug

`packages/orm-prisma/src/index.ts:837-844` — `find(id)` calls `delegate.findUnique({ where: { id }, include })` directly, bypassing:
- `buildWhere()` — all accumulated `_wheres` from the query chain
- `_softDeletes` — `softDeletes: true` models don't exclude trashed rows on `find(id)`
- `_resolveDeferred()` — global scopes registered via `Model.addGlobalScope()` are silently dropped

Drizzle (`orm-drizzle/src/index.ts`) does honor soft-delete on `find(id)` but ignores everything else — both adapters diverge from Eloquent and from each other.

### Fix

**Prisma adapter**:

```ts
async find(id: unknown, include?: unknown): Promise<unknown> {
  const where = this.buildWhere()  // builds from this._wheres + softDelete
  const delegate = this.prisma[this.table]
  return delegate.findFirst({
    where: { AND: [{ [this.primaryKey]: id }, where] },
    include,
  })
}
```

(Note: `findUnique` is restricted to a single unique field; `findFirst` is the right primitive once we're composing wheres.)

**Drizzle adapter**: AND the existing `buildConditions()` with the PK eq.

```ts
async find(id: unknown, include?: unknown): Promise<unknown> {
  const conditions = this.buildConditions()
  const pkEq = eq(this.table[this.primaryKey], id)
  const where = conditions.length ? and(pkEq, ...conditions) : pkEq
  return this.db.select().from(this.table).where(where).limit(1)
}
```

### Regression test

Add to both adapters:

```ts
it('find(id) composes with prior wheres', async () => {
  await User.create({ id: 1, tenantId: 'a' })
  await User.create({ id: 2, tenantId: 'b' })
  const result = await User.where('tenantId', 'a').find(2)
  assert.equal(result, null)  // currently returns the cross-tenant row
})

it('find(id) honors soft-delete scope', async () => {
  await SoftDeletedModel.create({ id: 1, deletedAt: new Date() })
  const result = await SoftDeletedModel.find(1)
  assert.equal(result, null)  // currently returns the trashed row on Prisma
})

it('find(id) honors global scopes', async () => {
  Tenant.addGlobalScope('current', q => q.where('tenantId', currentTenant.id))
  const otherTenant = await User.create({ tenantId: 'other' })
  const result = await User.find(otherTenant.id)
  assert.equal(result, null)
})
```

---

## Phase 2 — Thread `primaryKey` through the adapter contract

**Severity:** high — every Model with `static primaryKey = 'uuid'` is broken on Prisma; Drizzle is per-adapter-global (still wrong for mixed-PK models)
**Effort:** ~2h + adapter migrations + Model._q wiring

### The bug

`packages/orm-prisma/src/index.ts:840,894,902,908,913,940,948` — every CRUD op writes `{ where: { id } }`. The string `'id'` is hardcoded.

Drizzle takes a `primaryKey` config option at adapter construction time but it's global — every model uses the same PK column. A monorepo with `users.id` + `subscriptions.uuid` can't ship correctly on Drizzle either.

The contract is the real culprit: `OrmAdapter.query<T>(table)` carries no `primaryKey` parameter.

### Fix

Widen the contract:

```ts
interface OrmAdapter {
  query<T>(table: string, opts?: { primaryKey?: string }): QueryBuilder<T>
}
```

Pipe `ModelClass.primaryKey` from `Model._q()`:

```ts
static _q<T extends typeof Model>(this: T): QueryBuilder<InstanceType<T>> {
  return getAdapter().query<InstanceType<T>>(this.table, {
    primaryKey: this.primaryKey,
  })
}
```

Then every adapter callsite that wrote `where: { id }` reads `this.primaryKey` from the builder.

### Migration

Existing adapters (Prisma, Drizzle) need the threading. Third-party adapters via the published contract get a compat shim that defaults `primaryKey` to `'id'` if not threaded — log a one-time deprecation warning at boot suggesting they update.

### Regression test

```ts
class UuidModel extends Model {
  static override table     = 'uuidThings'
  static override primaryKey = 'uuid'
}

it('respects non-default primaryKey on find', async () => {
  const row = await UuidModel.create({ uuid: 'x-1', name: 'foo' })
  const result = await UuidModel.find('x-1')
  assert.equal(result.name, 'foo')
})

it('respects non-default primaryKey on update', async () => {
  const row = await UuidModel.create({ uuid: 'x-2', name: 'a' })
  row.name = 'b'
  await row.save()
  assert.equal((await UuidModel.find('x-2')).name, 'b')
})
```

---

## Phase 3 — Resolve `where + orWhere` precedence divergence

**Severity:** high — queries silently change meaning when porting between adapters; tests codify the divergent behavior as expected
**Effort:** ~2h + decision + both adapter migrations + test rewrite

### The bug

`packages/orm-drizzle/src/index.ts:610-618` evaluates as `OR(AND(...wheres), OR(...orWheres))`.

`packages/orm-prisma/src/index.ts:583-595` evaluates as `{ ...andSpread, OR: [...orWheres] }` which Prisma interprets as `AND(wheres, OR(orWheres))`.

The Drizzle test at `where-group.test.ts:133-143` explicitly asserts the OR "leaks" past the AND. The Prisma test at `where-group.test.ts:175-187` asserts the opposite. Both pass — the framework currently ships two incompatible query semantics.

Example:

```ts
Post.where('status', 'active').where('priority', 'high').orWhere('priority', 'low').get()

// Prisma:  WHERE status='active' AND priority='high' AND priority='low' [no rows]
//          (because the orWhere is constrained by the prior AND)
// Drizzle: WHERE (status='active' AND priority='high') OR priority='low'
//          (matches any priority='low' regardless of status)
```

### Fix

**Decision required**: Eloquent's behavior is left-associative — `A AND B OR C` parses as `(A AND B) OR C`. Drizzle matches Laravel; Prisma doesn't.

Recommended path: **make Prisma match Drizzle's Laravel-parity behavior**. Update the Prisma adapter's `buildWhere()` to emit:

```ts
// where AND chain + orWhere OR chain → (AND chain) OR (each orWhere ANDed with nothing)
{
  OR: [
    { AND: andClauses },   // accumulated .where(...) chain
    ...orWhereClauses,     // each .orWhere(...) as a top-level OR alternative
  ]
}
```

Update `where-group.test.ts` on the Prisma side to assert the new (Laravel-parity) behavior. Add a `CHANGELOG` entry calling out the breaking semantics change.

If consumers depend on the current Prisma behavior, this is a major version bump on `@rudderjs/orm-prisma`. Otherwise patch.

### Regression test

Single shared test file `where-group-parity.test.ts` that runs the same query on both adapters and asserts identical results:

```ts
const adapters = ['prisma', 'drizzle']
for (const adapterName of adapters) {
  describe(`where+orWhere on ${adapterName}`, () => {
    it('orWhere is top-level OR with the preceding AND chain', async () => {
      const result = await Post
        .where('status', 'active')
        .where('priority', 'high')
        .orWhere('priority', 'low')
        .get()
      // Should include all priority='low' rows + status='active' priority='high' rows
      assert.ok(result.find(r => r.priority === 'low' && r.status !== 'active'))
    })
  })
}
```

---

## Phase 4 — Drizzle `increment` / `deleteAll` / `updateAll` on MySQL

**Severity:** high — `increment` throws on MySQL; `prune --mass` exits after one chunk
**Effort:** ~1h + MySQL CI coverage

### The bug

`packages/orm-drizzle/src/index.ts:912-914`:

```ts
const result = await awaitReturningOrPlain(...)
if (!result[0]) throw new Error('… returned no rows.')
```

MySQL doesn't support `RETURNING`, so `awaitReturningOrPlain` returns `[]`. Every `Model.increment()` / `Model.decrement()` call throws on Drizzle+MySQL.

Same path drives `deleteAll`/`updateAll` returning `0` — silently breaks the `prune --mass` chunk loop:

```ts
while (deleted === chunk) { /* iterate */ }
// On MySQL: deleted is always 0, loop exits after one iteration, partial prune.
```

### Fix

Branch on driver capability:

```ts
async increment(column: string, by = 1): Promise<unknown> {
  const conditions = this.buildConditions()

  if (this.dialect === 'mysql') {
    // No RETURNING — execute update, then re-fetch the row
    await this.db.update(this.table)
      .set({ [column]: sql`${this.table[column]} + ${by}` })
      .where(and(...conditions))
    const after = await this.db.select().from(this.table).where(and(...conditions)).limit(1)
    if (!after[0]) throw new Error('Increment target row not found')
    return after[0]
  }

  // Postgres / SQLite: RETURNING works
  const result = await this.db.update(this.table)
    .set({ [column]: sql`${this.table[column]} + ${by}` })
    .where(and(...conditions))
    .returning()
  if (!result[0]) throw new Error('… returned no rows.')
  return result[0]
}
```

For `deleteAll` / `updateAll` row count: MySQL's driver exposes `affectedRows` on the result metadata — read that instead of `.length`.

```ts
async updateAll(values: Record<string, unknown>): Promise<number> {
  const conditions = this.buildConditions()
  const result = await this.db.update(this.table).set(values).where(and(...conditions))

  if (this.dialect === 'mysql') return (result as { affectedRows: number }).affectedRows
  return result.length  // Postgres/SQLite with RETURNING
}
```

### Regression test

`orm-drizzle/src/mysql.test.ts` (new file, gated on MySQL connection env):

1. Increment a counter — assert row updated.
2. `deleteAll` matching 50 rows — assert returns 50.
3. `prune --mass` with chunk=10 against 35 rows — assert all 35 deleted, not 10.

CI portability matrix should pick this up (memory: PR #530 + #531 shipped phases 1+2 of CI matrix; MySQL might still be deferred — see `project_ci_portability_matrix_shipped.md`).

---

## Phase 5 — Deferred-pivot Proxy race + unsupported-method swallow

**Severity:** medium — concurrent terminals on the same builder corrupt pivot rows; silent `whereHas` swallow is a footgun
**Effort:** ~1h + tests

### The bug

`packages/orm/src/relations/pivot-deferred.ts:195-218` (and morph siblings) capture `lastPivotRows` in a closure shared across terminal calls. `Promise.all([qb.get(), qb.get()])` interleaves `buildResolved()` / `postProcess()`, and the second terminal's `stampPivotOnResult` reads pivot rows from the first call.

Same Proxy at lines 40-42 only whitelists a fixed `CHAIN_METHODS` set. Calling `parent.related('tags').whereHas(...)` returns `undefined` from the `get` trap (unknown property) — chained `.whereHas` / `.withCount` / `.whereGroup` silently no-op.

### Fix

**Race fix**: pass pivot rows through `postProcess` per call instead of capturing in closure:

```ts
async function buildResolved(this: PivotProxy) {
  const pivotRows = await fetchPivotRows(...)
  const result = await innerBuild(...)
  return postProcess(result, pivotRows)  // pass per-call
}
```

**Silent-swallow fix**: add an explicit unknown-property throw in the `get` trap:

```ts
get(target, prop, receiver) {
  if (typeof prop === 'string' && !CHAIN_METHODS.has(prop) && !TERMINAL_METHODS.has(prop)) {
    // Unknown chain method called on a deferred pivot builder
    if (typeof prop === 'string' && prop.startsWith('where') || prop === 'withCount') {
      throw new Error(`@rudderjs/orm: ${prop}() not supported on deferred pivot relations (use raw builder)`)
    }
  }
  return Reflect.get(target, prop, receiver)
}
```

### Regression test

```ts
it('concurrent .get() calls do not corrupt pivot rows', async () => {
  const post = await Post.create(...)
  await post.tags().attach([1, 2, 3])

  const [a, b] = await Promise.all([
    post.tags().withPivot('createdAt').get(),
    post.tags().withPivot('createdAt').get(),
  ])

  assert.deepEqual(a.map(t => t.pivot.tagId), b.map(t => t.pivot.tagId))
})

it('throws on unsupported chain method', async () => {
  await assert.rejects(
    async () => post.tags().whereHas('parent').get(),
    /whereHas\(\) not supported on deferred pivot/,
  )
})
```

---

## Notable (yellow — not in this sweep)

- **`with()` is silent no-op on Drizzle** (`orm-drizzle/src/index.ts:290`). Documented in code comment only. Should throw at runtime with a clear "use the relational query API" pointer.
- **`whereBelongsTo` + custom `localKey`** (`relations/where-has.ts:305-313`) — `localCol` semantics mis-applied. Probably correct in practice; verify with a test.
- **`Model.refresh()` is racey for non-`id` PKs** — at `index.ts:1608` calls `ctor.find(id)` which hardcodes `id` until Phase 2. Refresh of a `primaryKey = 'uuid'` model fails.
- **`sync()` is not transactional** (`relations/pivot-accessors.ts:230-289`) — attach + detach + per-id updatePivot are independent awaits. No `transaction()` primitive on `OrmAdapter`. Adding one is a bigger plan.
- **`firstOrCreate` / `updateOrCreate` TOCTOU** (`index.ts:1274-1311`) — no upsert primitive on the contract. Map to native upsert per adapter.
- **`cast.ts` uses `require('@rudderjs/crypt')`** (line 203) — hits the ESM-only peer `require()` bug from memory. Use `resolveOptionalPeer`.
- **`saved` / `created` / `updated` observer return values silently dropped** vs `creating` / `saving` which mutate payload. Either document the asymmetry or honor returns.
- **`fill()` does not apply casts** (`index.ts:1580-1585`). Cast/mutator only fires on `save()`. Footgun for in-memory inspection.
- **`loadMissing` always assigns an array** (`aggregate.ts:494-501`) even for `hasOne` / `belongsTo` / `morphOne`. Doesn't match Eloquent.

---

## Suggested PR order

Phases 1 and 2 are coupled — Phase 1 needs Phase 2's `primaryKey` threading to work for non-`id` PK models.

1. **Phase 2 first** — `feat(orm): thread primaryKey through adapter contract` (changeset minor on `@rudderjs/orm` + patch on both `orm-prisma` and `orm-drizzle`)
2. **Phase 1** — `fix(orm): find(id) composes wheres / scopes / soft-deletes` (changeset patch on all three packages)
3. **Phase 4** — `fix(orm-drizzle): MySQL support for increment / deleteAll row count` (changeset patch)
4. **Phase 5** — `fix(orm): deferred-pivot proxy race + unsupported method throws` (changeset patch)
5. **Phase 3 last** — `fix(orm-prisma): Laravel-parity where+orWhere precedence` (changeset major on `@rudderjs/orm-prisma` — breaking semantics)

Phase 3 is the most contentious — it changes meaning of existing user queries. Land it with a long deprecation window in CHANGELOG + docs. Phases 1-2-4-5 can ship in normal cadence.

---

## Strengths noted (context)

- The 3-tier model (`Model` → hydrating Proxy → adapter) is well-factored. Aggregate normalization and predicate building are clean and reusable.
- Module-graph-safe via `Symbol.for('rudderjs.orm.aggregates')` and `globalThis['__rudderjs_orm_registry__']` — the documented multi-realm trap is handled.
- Mass-assignment, dirty tracking, soft-delete, observer events have clear semantics with explicit bypass paths (`forceFill`, `forceDelete`, `withoutEvents`, `saveQuietly`). The `_doCreate`/`_doUpdate` indirection to skip the filter on `save()` is tidy.
- Polymorphic eager-loading at the Model layer (vs forcing each adapter to handle it) is the right call — avoids two divergent implementations.
- Defensive guards on `morphTo` (closed `types: () => [...]`, duplicate discriminator check in dev) prevent the most common production footguns.
- 7K LOC of tests — when divergent behavior is found, it's almost always codified in a test, which is exactly the layer where the decision should be made.
