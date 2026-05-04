# `@rudderjs/cache` — Atomic Cache Locks (`Cache.lock()`)

**Status:** PROPOSED — design + implementation contract.
**Author handoff:** filed for the next rudder agent. Self-contained.
**Scope:** v1 = `Cache.lock(name, seconds)` returning a `Lock` with `get`/`get(cb)`/`block`/`release`/`forceRelease`/`restoreLock`/`owner`. Memory + Redis drivers. Refactor of `WithoutOverlapping` + `schedule.withoutOverlapping()` to use the new API.

---

## Why

Two consumers in the framework already need atomic cross-process locks but currently fake them with check-then-set against the regular cache. Both are racy and one is silently broken under contention.

**`packages/queue/src/job-middleware.ts:88`** — `WithoutOverlapping`:

```ts
const locked = await cache.get(lockKey)
if (locked) { throw new Error(...) }
await cache.put(lockKey, '1', this._expiresAfter)   // ← race: two workers can both pass the get()
try { await next() } finally { await cache.forget(lockKey) }
```

Two queue workers polling the same job key in the same window both observe `null`, both write the lock, both proceed. Lock duration is also wall-clock expiry, not owner-bound — a slow worker whose key TTL'd out will `forget()` a lock the next worker just acquired. That's a "release-someone-else's-lock" bug, not just a missed-overlap bug.

**`packages/schedule/src/index.ts:222`** — `withoutOverlapping()` and `onOneServer()` have the identical check-then-set shape with the identical race. `onOneServer()` is the worse case: across N app boxes, all of them tick at the same minute, all see `null`, all schedule the task. The whole point of `onOneServer()` is that exactly one runs.

A first-class `Cache.lock()` solves both. It also ships the missing primitive for downstream features people will write:

- Singleton job middleware (`UniqueLock` for jobs that must execute exactly once per key, even across retries).
- Long-poll coordination in `@rudderjs/sync` (only one tab/process owns the canonical state writer).
- Application-level mutexes for things like Stripe webhook idempotency or "process this user's outbox".

The cache adapter is the only place we already require for both single-node + Redis-backed coordination, so the lock primitive belongs here, not in a new package.

---

## Public API

### `Cache.lock(name, seconds)`

Returns a `Lock` instance. Does not acquire — acquisition is explicit via `get()` or `block()`. `seconds` is the lock TTL once acquired (auto-release if the holder crashes or hangs). No default — caller must pass it.

```ts
const lock = Cache.lock('process-podcast:42', 120)

if (await lock.get()) {                        // try-acquire, non-blocking
  try { await processPodcast(42) }
  finally { await lock.release() }
}
```

Auto-release callback form — preferred for normal control flow:

```ts
await Cache.lock('process-podcast:42', 120).get(async () => {
  await processPodcast(42)
})
// lock is released even if the callback throws.
// Returns the callback's return value, or false if the lock was not acquired.
```

Block (wait) up to N seconds for the lock to free, then acquire:

```ts
await Cache.lock('process-podcast:42', 120).block(10, async () => {
  await processPodcast(42)
})
// Throws LockTimeoutError if not acquired within 10s.
// Polls at ~250ms intervals — see Out of scope re: fairness.
```

Cross-process recovery via stored owner token:

```ts
const lock  = Cache.lock('process-podcast:42', 120)
const owner = lock.owner()                      // capture before serialising

// Later, in another process:
const restored = Cache.restoreLock('process-podcast:42', owner)
await restored.release()                        // releases ONLY if the owner matches
```

### `Lock` interface

`packages/cache/src/lock.ts` (new file — keeps `index.ts` from sprawling).

```ts
export interface Lock {
  /** Try to acquire. Returns true on success, false if held by someone else. */
  get(): Promise<boolean>

  /**
   * Try to acquire and run callback. Auto-releases (try/finally).
   * Returns the callback's return value on success, false if not acquired.
   */
  get<T>(callback: () => T | Promise<T>): Promise<T | false>

  /**
   * Wait up to `seconds` for the lock to free, then acquire.
   * Polls every ~250ms. Throws LockTimeoutError on timeout.
   *
   * With a callback: auto-releases. Returns the callback's return value.
   * Without a callback: caller must release(). Returns void.
   */
  block(seconds: number): Promise<void>
  block<T>(seconds: number, callback: () => T | Promise<T>): Promise<T>

  /** Release the lock — only if THIS instance still owns it (owner check). */
  release(): Promise<boolean>

  /** Release unconditionally — for stuck/orphaned locks. Use sparingly. */
  forceRelease(): Promise<void>

  /** Owner token. Stable across the Lock's lifetime; unique per instance. */
  owner(): string
}

export class LockTimeoutError extends Error {
  constructor(public readonly name: string, public readonly waitedSeconds: number) {
    super(`[RudderJS Cache] Could not acquire lock "${name}" within ${waitedSeconds}s.`)
    this.name = 'LockTimeoutError'
  }
}
```

### `Cache.lock` + `Cache.restoreLock`

Add to the `Cache` facade in `packages/cache/src/index.ts`:

```ts
/**
 * Build a lock handle for the given name. Does NOT acquire — call .get() or .block().
 * @param seconds Lock TTL once acquired. Required.
 */
static lock(name: string, seconds: number): Lock {
  return this.store().lock(name, seconds)
}

/**
 * Rebuild a lock handle owned by a specific token (cross-process release).
 * Useful when one process acquires, serialises the owner, and another releases.
 */
static restoreLock(name: string, owner: string): Lock {
  return this.store().restoreLock(name, owner)
}
```

---

## Driver contract

Widen `CacheAdapter` in `packages/cache/src/index.ts`:

```ts
export interface CacheAdapter {
  // ... existing methods unchanged
  /** Build a lock backed by this driver. */
  lock(name: string, seconds: number): Lock
  /** Rebuild a lock with a specific owner token (for cross-process release). */
  restoreLock(name: string, owner: string): Lock
}
```

Both methods are **synchronous** — they only construct the handle. All I/O happens inside `Lock.get()` / `Lock.release()` / `Lock.block()`.

The `Lock` itself is the I/O surface. Each driver ships its own `Lock` impl. To minimise per-driver boilerplate, factor out a base class:

`packages/cache/src/lock.ts`:

```ts
export abstract class BaseLock implements Lock {
  protected constructor(
    protected readonly name:    string,
    protected readonly seconds: number,
    protected readonly _owner:  string,
  ) {}

  owner(): string { return this._owner }

  abstract get(): Promise<boolean>
  abstract get<T>(callback: () => T | Promise<T>): Promise<T | false>
  abstract release(): Promise<boolean>
  abstract forceRelease(): Promise<void>

  async block<T>(seconds: number, callback?: () => T | Promise<T>): Promise<T | void> {
    const deadline = Date.now() + seconds * 1_000
    const interval = 250  // ms
    while (Date.now() < deadline) {
      if (await this.get()) {
        if (!callback) return
        try { return await callback() } finally { await this.release() }
      }
      await new Promise(r => setTimeout(r, interval))
    }
    throw new LockTimeoutError(this.name, seconds)
  }
}
```

Concrete drivers override the four abstract methods. The `get(callback?)` overload pattern lives in each subclass (TS overload sigs don't compose cleanly through abstracts — repeat the two-overload + single-impl shape per driver, ~6 lines each).

**Owner token format:** `crypto.randomBytes(16).toString('hex')` — 128 bits, lazy-loaded:

```ts
function newOwner(): string {
  // node:crypto lazy-loaded (per feedback_no_top_level_node_imports)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return (require('node:crypto') as typeof import('node:crypto')).randomBytes(16).toString('hex')
}
```

Generated inside `MemoryAdapter.lock()` / `RedisAdapter.lock()`. `restoreLock(name, owner)` reuses the supplied owner verbatim.

---

## Memory driver

`packages/cache/src/lock.ts` — adds `MemoryLock`:

```ts
export class MemoryLock extends BaseLock {
  constructor(
    name: string,
    seconds: number,
    owner: string,
    private readonly store: Map<string, { owner: string; expiresAt: number | null }>,
  ) { super(name, seconds, owner) }

  async get<T>(callback?: () => T | Promise<T>): Promise<T | false | boolean> {
    const k = this.lockKey()
    const existing = this.store.get(k)
    const now = Date.now()
    const live = existing && (existing.expiresAt === null || existing.expiresAt > now)
    if (live) return callback ? false : false
    this.store.set(k, { owner: this._owner, expiresAt: this.seconds ? now + this.seconds * 1_000 : null })
    if (!callback) return true
    try { return await callback() } finally { await this.release() }
  }

  async release(): Promise<boolean> {
    const k = this.lockKey()
    const existing = this.store.get(k)
    if (!existing || existing.owner !== this._owner) return false
    this.store.delete(k)
    return true
  }

  async forceRelease(): Promise<void> { this.store.delete(this.lockKey()) }

  private lockKey(): string { return `__lock__:${this.name}` }
}
```

`MemoryAdapter` reuses its existing `store` Map by writing lock entries under a `__lock__:` key prefix (segregated namespace; `flush()` still clears them). `MemoryAdapter.lock()` returns `new MemoryLock(name, seconds, newOwner(), this.store)`. `restoreLock(name, owner)` returns `new MemoryLock(name, 0, owner, this.store)` — `seconds` is irrelevant for release-only.

> **Single-process caveat — call out in README + the JSDoc on `MemoryAdapter`.** The Map lives in one Node process. Across multiple workers (`pm2 cluster`, multiple containers, multiple `tsx` invocations) the locks are independent — workers will both think they own the lock. This is the same caveat as the rest of `MemoryAdapter`; document it next to the existing "resets on restart" note. For real multi-process coordination use Redis (or any future shared driver).

Note: `MemoryAdapter` already deletes expired entries lazily on `get()/has()`. The lock check needs the same lazy-expiry treatment in the `live = ...` test above. No `setTimeout` cleanup needed — eviction-on-read is sufficient and matches the rest of the adapter.

---

## Redis driver

The canonical pattern: `SET NX EX` for acquire, Lua compare-and-delete for release. Redis evaluates Lua atomically.

`packages/cache/src/lock.ts` — adds `RedisLock`:

```ts
const RELEASE_LUA = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
else
  return 0
end
`.trim()

interface RedisLockClient {
  set(key: string, value: string, ...args: unknown[]): Promise<unknown>
  eval(script: string, numKeys: number, ...args: unknown[]): Promise<unknown>
  del(...keys: string[]): Promise<unknown>
}

export class RedisLock extends BaseLock {
  constructor(
    name: string,
    seconds: number,
    owner: string,
    private readonly clientFactory: () => Promise<RedisLockClient>,
    private readonly prefix: string,
  ) { super(name, seconds, owner) }

  async get<T>(callback?: () => T | Promise<T>): Promise<T | false | boolean> {
    const client = await this.clientFactory()
    const result = await client.set(this.lockKey(), this._owner, 'NX', 'EX', this.seconds)
    const acquired = result === 'OK'
    if (!acquired) return callback ? false : false
    if (!callback) return true
    try { return await callback() } finally { await this.release() }
  }

  async release(): Promise<boolean> {
    const client = await this.clientFactory()
    const result = await client.eval(RELEASE_LUA, 1, this.lockKey(), this._owner)
    return result === 1
  }

  async forceRelease(): Promise<void> {
    const client = await this.clientFactory()
    await client.del(this.lockKey())
  }

  private lockKey(): string { return `${this.prefix}__lock__:${this.name}` }
}
```

Why Lua for release: the naive sequence `if (await get(k)) === owner) await del(k)` has the same race as the queue middleware does today. Between `get` and `del`, another process can release + re-acquire under a different owner; we'd then delete their lock. The Lua block is atomic on Redis.

`RedisAdapter` already memoises its `ioredis` client behind `getClient()`. Pass `() => this.getClient()` as the `clientFactory` thunk; reuse the existing `prefix`. `restoreLock(name, owner)` constructs `new RedisLock(name, 0, owner, this.clientFactory, this.prefix)`.

`RedisAdapter.flush()` already wipes prefix-scoped keys; locks under `__lock__:` go with them. No special behaviour needed.

---

## Owner token + `restoreLock` cross-process semantics

The owner is a 128-bit hex string generated at `Cache.lock()` time. It is the *only* thing that authorises `release()`.

Cross-process flow:

1. Process A: `const lock = Cache.lock('foo', 60); await lock.get(); const owner = lock.owner()`
2. Process A serialises `owner` (e.g. into a job payload, a session, a DB row).
3. Process B (different host even): `const restored = Cache.restoreLock('foo', owner); await restored.release()`

Process B's `release()` succeeds iff the lock in Redis still has `value === owner`. If A's lock TTL'd out and someone else acquired in between, B's release is a no-op — exactly what we want. Returns `false` so the caller can log/observe.

This is the mechanism the queue refactor hangs on: a job acquires the lock when it's dispatched, stores the owner on the job payload, and the worker (potentially on a different machine) releases it after `handle()`.

`restoreLock` does **not** call Redis on construction — it's a pure handle. The first network call is whatever the caller invokes (`release()`, `forceRelease()`, `get()` — though `get()` on a restored lock is a weird usage; doesn't break anything since `SET NX` checks the key, not the owner).

---

## Integration — refactor existing consumers

Both refactors are net-deletions. File scope is small enough to land alongside the lock primitive in this plan, but each is a separately committable task.

### Task A — `WithoutOverlapping` (queue/job-middleware.ts:82)

Before:
```ts
const locked = await cache.get(lockKey)
if (locked) { throw new Error(...) }
await cache.put(lockKey, '1', this._expiresAfter)
try { await next() } finally { await cache.forget(lockKey) }
```

After (`Cache.lock` is sync; lock is per-execution, so no owner serialisation needed):
```ts
const acquired = await Cache.lock(this._key, this._expiresAfter).get(async () => {
  await next()
  return true
})
if (acquired === false) {
  throw new Error(`[RudderJS Queue] Job "${this._key}" is already running. Releasing back to queue.`)
}
```

Drops the optional-peer dance (`_getCache()`) — `WithoutOverlapping` already imports from `@rudderjs/queue`'s peer set; switch to a direct optional peer of `@rudderjs/cache` (peer dep, not runtime require).

> **No-cache fallback** — current behaviour is "no cache → just run". Preserve by guarding `if (!CacheRegistry.get()) return next()` at the top, before constructing the lock. Or strip the fallback entirely: cache is now a hard dep of overlap protection. Author call — recommend hard dep + clear error message ("WithoutOverlapping requires a cache adapter; install @rudderjs/cache").

### Task B — `schedule.withoutOverlapping()` + `onOneServer()` (schedule/index.ts:206)

Both branches collapse to the same shape. Replace lines 211–233 + 257–259:

```ts
async function _executeTask(task: ScheduledTask): Promise<void> {
  const label = task.getDescription() || task.getCron()

  // onOneServer + withoutOverlapping both use cache locks now.
  const locks: Array<Lock> = []
  if (task.isOnOneServer()) {
    const l = Cache.lock(`schedule:server:${label}`, 60)
    if (!await l.get()) return  // another server is handling it
    locks.push(l)
  }
  if (task.isWithoutOverlapping()) {
    const l = Cache.lock(task.getOverlapKey(), task.getOverlapExpiresAt() * 60)
    if (!await l.get()) {
      console.log(`[Schedule] Skipping "${label}" — already running (overlap lock)`)
      // release any previously acquired locks (onOneServer)
      for (const acquired of locks) await acquired.release()
      return
    }
    locks.push(l)
  }

  try {
    // ... existing before/run/onSuccess/onFailure/after
  } finally {
    for (const l of locks) await l.release()
  }
}
```

Drops the local `_getCache()` shim. `_overlapKey` already namespaces with `rudderjs:schedule:overlap:` — keep it; the lock layer adds its own `__lock__:` prefix on top, no collision.

### Task C (separate plan, not this one) — `UniqueLock` for `@rudderjs/queue`

`packages/queue/src/unique.ts` already exists for `ShouldBeUnique`. It uses the same check-then-set pattern. Migrate it the same way as Task A. Call out as a follow-up — file it as a separate ticket once the lock API ships.

---

## Implementation tasks

### Task 1 — `Lock` types + `BaseLock`
- New file `packages/cache/src/lock.ts`.
- Export `Lock`, `LockTimeoutError`, `BaseLock`.
- Re-export from `index.ts` (`export type { Lock } from './lock.js'`).

### Task 2 — `MemoryAdapter` lock support
- Add `MemoryLock` to `lock.ts`.
- Implement `MemoryAdapter.lock()` + `restoreLock()` in `index.ts`.
- Keep using the existing `store` Map under `__lock__:` prefix — segregation, not a separate Map.
- Update the JSDoc on `MemoryAdapter` to call out the single-process caveat for locks.

### Task 3 — `RedisAdapter` lock support
- Add `RedisLock` + `RELEASE_LUA` to `lock.ts`.
- Implement `RedisAdapter.lock()` + `restoreLock()`.
- Pass through the existing `getClient()` thunk + `prefix`.

### Task 4 — `Cache` facade methods
- Add `Cache.lock(name, seconds)` + `Cache.restoreLock(name, owner)`.
- Document in JSDoc with the auto-release callback example.

### Task 5 — `FakeCacheAdapter` lock support
- Recording fake should implement `lock()` + `restoreLock()` returning a `MemoryLock`-style impl that also pushes ops onto `_operations`.
- Add `CacheOperation` variants: `'lock-acquire'`, `'lock-release'`, `'lock-force-release'` (key + owner).
- Add `assertLockAcquired(name)`, `assertLockReleased(name)`.

### Task 6 — Refactor `WithoutOverlapping` (queue)
- Replace check-then-set with `Cache.lock().get(callback)`.
- Drop `_getCache()` shim if unused after refactor.
- Add a no-cache guard with an explicit error (or preserve fail-open — author call, document either way).

### Task 7 — Refactor `schedule.withoutOverlapping()` + `onOneServer()`
- Replace both branches with `Cache.lock()` calls (see snippet above).
- Drop `_getCache()` shim.

### Task 8 — Tests

`packages/cache/src/lock.test.ts` (new):

| Scenario | Driver | Assert |
|---|---|---|
| `get()` returns true on first acquire | memory + fake | bool |
| `get()` returns false when held by someone else | memory + fake | bool |
| `get(cb)` runs callback + auto-releases | memory + fake | post-state has no lock; cb return value passed through |
| `get(cb)` releases on callback throw | memory + fake | finally semantics; rethrows |
| `release()` only releases when owner matches | memory + fake | cross-instance release returns false; lock still held |
| `restoreLock(name, owner).release()` succeeds across instances | memory + fake | original holder loses ownership |
| `restoreLock(name, wrongOwner).release()` returns false | memory + fake | lock still held |
| `forceRelease()` always wipes | memory + fake | bypasses owner check |
| `block(s, cb)` waits + acquires when freed mid-poll | memory | use a setTimeout to release after 100ms |
| `block(s)` throws `LockTimeoutError` after timeout | memory | error type + name + waitedSeconds populated |
| TTL expiry releases the lock for the next caller | memory | lock TTL elapses → next `get()` succeeds |

Redis lock tests live behind the existing `REDIS_TEST=1` env flag (see how `index.test.ts` handles it). Same matrix as memory.

`packages/queue/src/job-middleware.test.ts` — update `WithoutOverlapping` test to assert correct behaviour with two concurrent handlers (interleaved `get`s); should serialise.

`packages/schedule/src/index.test.ts` — update overlap-skip test to use the new lock API in the spy.

### Task 9 — Docs + README
- `packages/cache/README.md`: new "Atomic locks" section after the existing API. Show all five usage shapes (sync get, callback get, block, restoreLock, owner token).
- `packages/cache/CHANGELOG.md`: minor bump entry.
- `packages/queue/CHANGELOG.md` + `packages/schedule/CHANGELOG.md`: patch entries — "internal: switch overlap protection to `Cache.lock()`. No API change."
- `packages/cache/CLAUDE.md` (if present, otherwise skip): note the lock primitive + the `MemoryLock` single-process caveat.
- Update `docs/guide/cache.md` (or create) with the lock recipes.

### Task 10 — Changeset
```bash
pnpm changeset
# minor for @rudderjs/cache (additive — new API)
# patch for @rudderjs/queue + @rudderjs/schedule (internal refactor)
```

---

## Out of scope

- **Fairness / queue-of-waiters.** `block()` polls every 250ms; under contention, acquisition order is effectively first-come but not strict FIFO. Laravel doesn't promise fairness either. If a real consumer needs strict FIFO, that's a v2 conversation around Redis Streams or a separate `OrderedLock` primitive.
- **Reentrant locks.** Calling `lock.get()` twice from the same instance does not "increment a count". Second `get()` returns `false` because the lock is held (by you). Keep the API surface small; reentrancy is a foot-gun across async boundaries.
- **Read/write locks (shared vs exclusive).** Out — exclusive only. Different primitive entirely.
- **Driver beyond memory + redis.** Memcached/DynamoDB/Postgres-advisory-lock would each be additive; ship when there's demand. Adapter contract is shaped to make it possible.
- **Cluster-mode Redis lock safety (Redlock).** Single-Redis `SET NX EX` is the documented pattern and matches Laravel. Redlock's correctness is contested (Antirez vs Kleppmann); we deliberately don't ship it. If a user runs a Redis cluster and needs cross-shard correctness, they pin the lock keys to one slot via `{tag}` syntax in `name` — document this in the README, don't paper over it.
- **Auto-extend / heartbeat.** No background renewal of the TTL during `get(cb)` execution. Pick a TTL longer than the worst-case callback. Heartbeat is a v2 once we see real long-running cases.
- **Telescope `lock` collector.** Out for v1. Locks are a hot path — observability hooks come once we have real usage to design around. The fake's `assertLockAcquired/Released` covers test assertions.

---

## Open questions for the implementer

1. **Hard cache dep vs fail-open in `WithoutOverlapping`.** Today: no cache → run anyway (no protection). Under the lock API: arguably "no cache → throw" is safer (prevents silent loss of overlap protection). Lean toward throw + clear message; flag in PR for review. Schedule is the same call.
2. **`get()` overload return type.** With callback `T | false`, without `boolean`. The discriminated overload signature compiles but TS narrowing on `await lock.get(cb)` when `T` itself can be `boolean` is awkward. Mitigation: tell callers to check `result !== false` rather than truthy. Document. (Laravel returns `true|false` for the no-callback form and the callback's return for the callback form — same shape, same caveat.)
3. **`__lock__:` namespace prefix collision.** Picked because no current cache key uses double underscores. If anyone is already storing keys starting with `__lock__:`, their `Cache.flush()` will still wipe both — same blast radius. Document in the README.
4. **`block()` poll interval — 250ms hardcoded.** Reasonable default. Make it overridable via a third arg (`block(seconds, callback?, intervalMs?)`)? Defer until someone asks; YAGNI.

---

## File touch list (final)

- `packages/cache/src/lock.ts` — new (`Lock`, `LockTimeoutError`, `BaseLock`, `MemoryLock`, `RedisLock`, `RELEASE_LUA`)
- `packages/cache/src/index.ts` — widen `CacheAdapter`, add `Cache.lock` + `Cache.restoreLock`, wire `MemoryAdapter` + `RedisAdapter`
- `packages/cache/src/fake.ts` — `lock()` / `restoreLock()` + new ops + asserts
- `packages/cache/src/lock.test.ts` — new
- `packages/cache/src/index.test.ts` — touch only if Cache facade tests need lock smoke
- `packages/cache/README.md` — Atomic locks section
- `packages/cache/CHANGELOG.md` — minor entry
- `packages/queue/src/job-middleware.ts` — refactor `WithoutOverlapping`
- `packages/queue/src/job-middleware.test.ts` — update tests
- `packages/queue/CHANGELOG.md` — patch entry
- `packages/schedule/src/index.ts` — refactor `_executeTask` lock branches
- `packages/schedule/src/index.test.ts` — update overlap test
- `packages/schedule/CHANGELOG.md` — patch entry
- `.changeset/<random>.md` — generated

Estimated: 1 day for the lock primitive + memory driver + tests; another half day for Redis + cross-process tests; half day for the queue/schedule refactor + docs. Two days end-to-end.
