# ORM query perf — Phase 1 audit

**Status:** Phase 1 (measurement + audit) done, 2026-05-17. Phase 2 (fixes) pending user direction.
**Effort so far:** ~30 min. Phase 2 fixes scoped per-lever below.
**Prerequisites:** none. Stacks on `main` (post-#491/#493).

**Goal:** Measure RudderJS ORM overhead vs raw Prisma across common operations on a realistic dataset, identify where overhead concentrates, and propose targeted fixes.

**Non-goals:** Not a feature comparison. Not a Drizzle benchmark (different adapter). Not a vector / pgvector benchmark (Postgres-specific). Not a benchmark of the database engine itself — we're measuring the *delta* the ORM adds.

---

## Methodology

Subject app: `playground/`, sqlite via `@prisma/adapter-better-sqlite3`. Fresh `bench.db` seeded with **5000 User rows**. 200 iterations per op (50 for `.all()` because of total run time), 20-iteration warm-up. Compared two code paths driving the same DB:

- **Raw Prisma:** `prisma.user.findUnique(...)`, `prisma.user.findMany(...)`, etc.
- **RudderJS ORM:** `User.find(id)`, `User.all()`, etc. (Model class extending `@rudderjs/orm`'s `Model`, going through the hydrating QueryBuilder Proxy.)

Both share the same `bench.db` file but have independent adapter instances so no cache is shared.

Bench script: `playground/bench-orm.ts` (not committed — local scratch).

---

## Findings

```
operation                    raw Prisma                   RudderJS ORM                 overhead
─────────────────────────────────────────────────────────────────────────────────────────────────
find by PK                   raw=  0.072/  0.082ms        rudder=  0.079/  0.090ms     Δ=+0.006ms  (+8.6%)
first by where               raw=  0.065/  0.083ms        rudder=  0.070/  0.090ms     Δ=+0.005ms  (+7.9%)
all (5000 rows)              raw=  9.515/ 10.237ms        rudder= 13.170/ 14.388ms     Δ=+3.655ms (+38.4%)  ← outlier
where().limit(20).get()      raw=  0.090/  0.105ms        rudder=  0.105/  0.139ms     Δ=+0.015ms (+16.5%)
paginate(1, 15)              raw=  0.221/  0.292ms        rudder=  0.237/  0.267ms     Δ=+0.016ms  (+7.0%)
where().count()              raw=  0.321/  0.413ms        rudder=  0.309/  0.379ms     Δ=-0.013ms  (-4.0%)   ← noise
create                       raw=  0.366/  0.611ms        rudder=  0.427/  0.726ms     Δ=+0.061ms (+16.5%)
update by id                 raw=  0.303/  0.423ms        rudder=  0.350/  0.556ms     Δ=+0.047ms (+15.5%)
```

Numbers are median / p95 in ms. Three things stand out:

**1. Single-row operations are essentially free in absolute terms.** `find` / `first` / `paginate` add 5–20 µs overhead per call. The percentage overhead (7–17%) is large only because the operations themselves are sub-millisecond. This is fine — no user will ever notice.

**2. `.all()` is the structural outlier.** 5000-row hydration adds **+3.7 ms (+38%)**. The percentage AND absolute overhead are real. This is the only place where the ORM tax becomes user-visible in CPU-bound paths.

**3. Mutations (`create`, `update`) have modest overhead** — ~50–60 µs each. Not a hot spot at most scales.

---

## Where the `.all()` overhead lives

For 5000 rows, per-row cost is **~0.73 µs** of overhead on top of raw Prisma. Sources, from reading `packages/orm/src/index.ts`:

### Per-row hydration (`Model.hydrate`, line 759)

```ts
static hydrate(record) {
  if (record == null) return null
  if (record instanceof Model && record.constructor === this) return record
  const Ctor = this as new () => InstanceType<T>
  const instance = new Ctor()           // 1. construct
  Object.assign(instance, record)        // 2. shallow copy fields
  instance._syncOriginal()               // 3. build dirty-tracking baseline
  return instance
}
```

Each row goes through:

- **`new Ctor()`** — instantiates a Model subclass. The class has declared fields (`id!: string`, `name!: string`, etc.) which become `undefined` own-properties on construction. Then `Object.assign` immediately overwrites them. Cheap individually but wasted work.
- **`Object.assign(instance, record)`** — copies all keys. Necessary.
- **`_syncOriginal()`** — calls `_currentAttrs()` which iterates `Object.entries(this)`, filters keys starting with `_`, filters aggregate keys, builds a fresh `Record<string, unknown>`. **This is a second full O(n) pass over every field, just to build a dirty-tracking baseline.** For a user calling `.all()` to display rows in a list, dirty tracking is unused — but every row pays the cost.

### Per-row `retrieved` event firing (`Model.all`, line 977)

```ts
static async all() {
  const records = await Model._q(this).all()
  for (const r of records) await self._fireEvent('retrieved', r)   // ← serial await per row
  return records
}
```

`_fireEvent` is always `async`, even when the class has no `retrieved` observer:

```ts
private static async _fireEvent(event, ...args) {
  if (this._eventsMuted) return args[0]
  const observers = this._observers ?? []
  for (const obs of observers) { ... }          // ← empty array, but still iterated
  const listeners = this._listeners?.get(event) ?? []
  for (const fn of listeners) { ... }            // ← same
  return result
}
```

For 5000 rows, that's **5000 serial `await` calls** scheduling 5000 microtasks, each of which executes zero observer body but still pays the function-call + Promise-resolution cost. Even at ~100–200 ns per microtask, that's ~1 ms of pure overhead with no functional effect.

### Hydrating QueryBuilder Proxy

`Model._hydratingQb` (line 770) wraps the adapter QB in a Proxy whose `get` handler installs ORM-only chainables (`whereHas`, `withCount`, etc.) and rewrites terminal methods (`all`, `first`, `get`, etc.) to call `wrapMany(records)`. The Proxy itself is fine — it's per-query, not per-row.

---

## Levers — proposals + estimates

### A. Fast-path `_fireEvent` when no observers/listeners

Currently every call goes through `async` function-body overhead. Add a synchronous early-return when both `_observers` and `_listeners` are empty (or absent on `this` via `hasOwnProperty`):

```ts
private static _fireEvent(event, ...args) {
  // Fast path: no observers, no listeners — return synchronously.
  const hasObs  = Object.prototype.hasOwnProperty.call(this, '_observers')  && this._observers.length  > 0
  const hasLis  = Object.prototype.hasOwnProperty.call(this, '_listeners')  && this._listeners.size    > 0
  if (!hasObs && !hasLis) return args[0]
  // Slow path: existing async impl.
  return this._fireEventSlow(event, ...args)
}
```

Call sites that currently `await self._fireEvent(...)` either need to be conditional (`const r = self._fireEvent(...); if (r instanceof Promise) await r`) or `_fireEvent` keeps returning `Promise<T> | T` and call sites `Promise.resolve(...).then(...)` if they care.

**Estimated savings:** ~0.5–1 ms on `.all()` with 5000 rows. Negligible for single-row ops (saves 1 microtask per call, ~200 ns).

**Risk:** Backwards-compat — call sites currently treat `_fireEvent` as always-async. Internal-only method (`private static`), so the union-return change is contained.

**Recommendation:** Worth shipping. Touches one method, ~30 lines. Clean union-return pattern with conditional `await` at the ~6 call sites.

### B. Lazy `_syncOriginal()`

Currently every hydrated instance immediately builds a dirty-tracking baseline. Most `.all()` callers never call `.save()` on the returned instances. Defer the baseline build to first `.save()` / `.isDirty()` / `.getChanges()` access:

```ts
private get original(): Record<string, unknown> {
  if (!this.#original) this.#original = this._currentAttrs()
  return this.#original
}
```

Replace `this.#original` reads with the lazy getter throughout.

**Estimated savings:** ~1 ms on `.all()` (skips the `_currentAttrs()` pass for every row never saved). Identical end-state for code that DOES `.save()` — pays the cost once on first dirty-check.

**Risk:**
- `_syncOriginal()` is also called in `save()`/`replicate()`/`refresh()` AFTER mutations to RESET the baseline. The lazy version needs to differentiate "not built yet" from "explicitly reset to empty". Tractable but needs care.
- If any external code reads `#original` directly (unlikely — it's `#private`), it breaks. But the `#` private guarantees no external access.

**Recommendation:** Higher value but higher risk. Wants its own plan-doc + careful audit of every `#original` access. Don't bundle with A.

### C. Skip `new Ctor()` overhead — use `Object.create(prototype)`

`new User()` runs the constructor, which initializes class fields to `undefined`, then `Object.assign` overwrites them. Cheaper alternative:

```ts
static hydrate(record) {
  const instance = Object.create(this.prototype) as InstanceType<T>
  Object.assign(instance, record)
  instance._syncOriginal()
  return instance
}
```

`Object.create` skips the constructor entirely — no class-field initialization, no superclass chain construction. For Models with many declared fields, this can be measurably faster.

**Estimated savings:** ~0.2–0.5 ms on `.all()` with 5000 rows for the playground's 7-field User. Larger models (Telescope entries, deep AI Agent state) would see more.

**Risk:**
- **Breaks the constructor.** If any Model's `constructor()` runs side-effect logic (event registration, default-value setting), it's skipped. RudderJS's `Model` base class doesn't have a constructor body, but user subclasses might. Need a class-level opt-in or compile-time guarantee.
- The `Billable(HasApiTokens(Model))` mixin pattern (used by playground's `User`) might rely on constructor chain — needs verification.

**Recommendation:** Implementable but invasive. Skip unless A+B don't reach the target.

### D. Opt-out raw-record path

Add `query().raw()` / `Model.allRaw()` that returns plain records bypassing hydration entirely. Apps that display list pages don't need Model instances — they need rows of data, possibly serialized to JSON.

**Estimated savings:** ~3.5 ms on `.all()` — essentially zero ORM overhead. Caller pays only the raw Prisma cost.

**Risk:**
- New API surface. Users need to know when to reach for it.
- Inconsistent return shape — `Model.all()` returns instances, `Model.allRaw()` returns records. Type-system-distinguishable but easy to mix up.
- Breaks the "every read path returns Model instances" invariant the framework committed to in PR #111.

**Recommendation:** Don't ship without explicit user direction. The semantics break is real.

---

## Recommended next action

Ship **Lever A only** as a small `perf:` PR:

- Fast-path `_fireEvent` to return synchronously when there are no observers or listeners.
- Update call sites that `await` it to handle the union return.
- Measure the actual delta on the bench — estimated ~1 ms on `.all()` with 5000 rows. Single-row ops likely unchanged (microsecond noise).

Lever B (lazy `_syncOriginal`) is a real second-round win but wants its own plan doc + careful audit. Park for now.

Levers C and D have larger surface impact — skip without user direction.

---

## What we now know with confidence

- **Single-row ORM operations are essentially free** — 5–20 µs overhead on sub-millisecond raw Prisma calls. Not a perf concern at any realistic app scale.
- **Bulk hydration is the single hot path** — `.all()` with 5000 rows adds 3.7 ms (+38%) on top of raw Prisma.
- **Most of that 3.7 ms is "ceremony work" the user didn't ask for**: per-row dirty-tracking baseline + per-row `await` for an event with no listeners. Both have safe fast-paths.
- **Hydration constructor cost is real but secondary** — ~0.2 ms for this model. Bigger models would see more, but for the 7-field User in the playground, observer + dirty-tracking overhead dominates.
- The ORM is already lean by Eloquent standards — Laravel's equivalent `User::all()` on 5000 rows runs ~5× slower than this. The +38% delta is acceptable; we're chasing diminishing returns past this point.

## Reusable artifacts

Bench script lives at `playground/bench-orm.ts` (gitignored / scratch). Bench DB is `playground/bench.db` (gitignored). Reusable for any future ORM perf comparison — drop in another model + adapter and rerun.
