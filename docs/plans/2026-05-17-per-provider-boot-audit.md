# Per-provider `boot()` cost audit

**Status:** Phase 1 (measurement + audit) done, 2026-05-17. Phase 2 (fixes) pending user direction — each proposed fix has a real trade-off and needs explicit sign-off.
**Effort so far:** ~45 min. Phase 2 fixes scoped per-lever below; each is 1–4 hours of implementation + measurement.
**Prerequisites:** Sits on top of `docs/plans/2026-05-17-cold-boot-audit.md` (the parent investigation that identified provider boot as the highest-leverage lever in the realistic 580 ms cold-boot).

**Goal:** Identify which providers dominate `Application._bootAll()` time in a realistic app (22 providers) and figure out which ones can shave their boot cost without breaking semantics.

**Non-goals:** Not a rewrite of how providers boot. Not addressing the route-loader serial path (that's blocked by router architecture — separate plan if pursued). Not optimizing the minimal-scaffold path (already at floor — see parent plan).

---

## Methodology

Subject app: playground prod build (22 providers, pennant skipped + `passwords.secret` added to AuthController locally — pre-existing prod-mode issues unrelated to this work).

Per-provider timing: temporary `performance.now()` brackets around each `await provider.boot?.()` call in `Application._bootAll()`, gated behind `RUDDER_PERF_TRACE=1`. Reverted after measurement.

Four runs, warm filesystem cache, prod build:

```
                          Run 0   Run 1   Run 2   Run 3
QueueProvider          161.7ms 192.4ms  80.5ms  70.3ms
DatabaseProvider        93.6ms  80.3ms  72.3ms  55.7ms
PulseProvider           16.6ms   9.7ms   6.3ms   5.0ms
McpProvider              9.2ms   —       —       —
TelescopeProvider        6.3ms   7.2ms   —       5.7ms
AiProvider               5.6ms   5.8ms   4.9ms   2.6ms
LogProvider              2.5ms   —       6.2ms   —
PassportProvider         3.1ms   —       —       —
(15 others, each <1ms)
─────────────────────  ───────────────────────────────
providers:boot total   303ms   311ms   185ms   148ms
```

Variance is high (JIT warm-up, GC) but the **ranking is stable**: Queue + Database dominate, ~80% of total `providers:boot` time across all runs.

---

## Top 2 — Queue + Database (84% of total boot cost)

### QueueProvider — ~100 ms typical, peak 192 ms

`packages/queue/src/index.ts:262`:

```ts
async boot(): Promise<void> {
  const cfg = config<QueueConfig>('queue')
  // ...
  if (driver === 'bullmq') {
    const { bullmq } = await resolveOptionalPeer(...)   // ← heavy
    adapter = bullmq(connectionConfig).create()         // ← cheap
  }
  QueueRegistry.set(adapter)
  this.app.instance('queue', adapter)
  rudder.command('queue:work', ...)                     // 5 command registrations
  rudder.command('queue:status', ...)
  // ... (3 more)
}
```

**Where the cost lives:** the `resolveOptionalPeer('@rudderjs/queue-bullmq')` dynamic-import. The queue-bullmq chunk inlines `bullmq` (npm) and `ioredis` (npm), both of which have heavy module-load cost. Module evaluation of those bundled deps is what eats ~100 ms.

**Notable:** `bullmq(config).create()` constructs a `BullMQAdapter` whose constructor is cheap and **does NOT connect to Redis**. Connection happens lazily inside `getQueue()` on first `.dispatch()`. So we're paying ~100 ms at boot just to *load the module*, not to set anything up.

The 5 `rudder.command(...)` calls are cheap but they exist regardless of whether the process is a CLI or an HTTP server. HTTP servers never invoke them.

### DatabaseProvider — ~76 ms typical, peak 94 ms

`packages/orm-prisma/src/index.ts:1141`:

```ts
async boot(): Promise<void> {
  const cfg = config<DatabaseConfig | undefined>('database', undefined)
  // ...
  const adapter = await PrismaAdapter.make(prismaConfig)   // ← ~30–60 ms (module + new PrismaClient())
  await adapter.connect()                                  // ← ~20–40 ms (DB $connect())
  ModelRegistry.set(adapter)
  this.app.instance('db', adapter)
  this.app.instance('prisma', adapter.prisma)
}
```

**Where the cost lives:**

1. `PrismaAdapter.make()` dynamic-imports `@prisma/adapter-better-sqlite3` (or `@prisma/adapter-pg` / `@prisma/adapter-libsql`) and `@prisma/client`, then constructs `new PrismaClient(opts)`. The PrismaClient constructor isn't trivially cheap — it sets up its internal engine.

2. `adapter.connect()` calls `prismaClient.$connect()` which opens the actual database connection. Prisma's docs note that **calling `$connect()` is optional** — the client will connect lazily on first query. Eager `$connect()` is mainly a fail-fast pattern for "DB unavailable at boot."

---

## Levers — proposals + trade-offs

Three levers, each scoped + risk-assessed. Two are speculative (need a separate plan if pursued); one is a one-line change.

### Lever 2a — Remove eager `adapter.connect()` (one-line change)

`packages/orm-prisma/src/index.ts:1153`:

```diff
- const adapter = await PrismaAdapter.make(prismaConfig)
- await adapter.connect()
+ const adapter = await PrismaAdapter.make(prismaConfig)
+ // $connect() is optional in Prisma — the client connects lazily on first
+ // query. Skipping eager connect saves ~20–40 ms cold-boot. Trade-off:
+ // database-unavailable errors surface on first user query instead of
+ // at boot. For apps with a DB-down health-check, that's the right
+ // tradeoff; for apps that want fail-fast at deploy, set
+ // `database.eagerConnect: true` (TODO if we add the config knob).
  ModelRegistry.set(adapter)
```

**Estimated savings:** 20–40 ms (~30 ms median).

**Risk:**
- **Errors move from boot to first request.** A DB-down deploy currently fails on the boot promise rejection (which today is observed during first-request via the deferred-app pattern anyway, so this risk is partially mitigated by current prod entry shape).
- **Connection pool warmup happens on first request.** First DB query is slightly slower; subsequent requests unaffected.
- **No public API change.** Drop-in.

**Recommendation:** Ship as a small `fix:` PR. Minor risk, real win, no breaking change. Could add a `database.eagerConnect?: boolean` config knob if we want users to opt back in for fail-fast — but probably premature.

---

### Lever 2b — Defer `@rudderjs/queue-bullmq` module load until first `dispatch()` (speculative)

Current flow:

```ts
async boot() {
  const { bullmq } = await resolveOptionalPeer('@rudderjs/queue-bullmq')  // ← always
  const adapter = bullmq(cfg).create()
  this.app.instance('queue', adapter)
  // commands...
}
```

Proposed flow: register a lazy proxy that loads bullmq on first method call.

```ts
async boot() {
  let realAdapter: QueueAdapter | null = null
  let loading: Promise<QueueAdapter> | null = null
  const getAdapter = async (): Promise<QueueAdapter> => {
    if (realAdapter) return realAdapter
    if (!loading) {
      loading = (async () => {
        const { bullmq } = await resolveOptionalPeer('@rudderjs/queue-bullmq')
        realAdapter = bullmq(cfg).create()
        QueueRegistry.set(realAdapter)
        return realAdapter
      })()
    }
    return loading
  }
  const proxy: QueueAdapter = {
    async dispatch(...args) { return (await getAdapter()).dispatch(...args) },
    async work(...args)     { return (await getAdapter()).work?.(...args) },
    async status(...args)   { return (await getAdapter()).status?.(...args) },
    // ... etc. for every method on QueueAdapter
  }
  this.app.instance('queue', proxy)
  // commands... (lazily resolve adapter on invocation)
}
```

**Estimated savings:** ~80–150 ms (the entire QueueProvider cost). For HTTP-only services that never dispatch a job, savings are permanent.

**Risk:**
- **First `dispatch()` is now slow.** Apps that dispatch jobs during a request will see the first request take an extra ~100 ms.
- **API surface change**: `app.make('queue')` returns a proxy, not a real adapter. If any code uses `Object.getPrototypeOf()`, `instanceof BullMQAdapter`, or accesses a property not on the proxy interface, it breaks. Auditing this is the bulk of the work.
- **Adapter method completeness**: every method on every adapter (`SyncAdapter`, `BullMQAdapter`, `InngestAdapter`) must be on the proxy. Forgotten methods become silent runtime errors.
- **Test surface**: queue tests rely on synchronous adapter resolution. Likely needs a few test updates.

**Recommendation:** **Don't ship without a separate plan doc.** This is a real architectural change — the lazy-DI pattern doesn't exist elsewhere in the framework and introducing it here sets a precedent. The estimated win (100 ms) is significant but the audit + proxy completeness work is 1–2 days for someone who knows the code.

If we wanted to pursue this, the right framing is "introduce a lazy-DI primitive in `@rudderjs/core`" and apply it to Queue + Database + maybe Storage. As a single one-off in Queue, the precedent cost outweighs the win.

---

### Lever 2c — Defer `PrismaAdapter.make()` (parallel to 2b, more invasive)

Same shape as 2b, applied to Database. Wrap the `db` and `prisma` bindings behind a proxy that loads PrismaClient on first query.

**Estimated savings:** ~50–80 ms (the full Database provider cost, if combined with 2a).

**Risk:** Same risk profile as 2b, plus:
- **More integration points**: telescope's QueryCollector hooks `prisma.$on('query', ...)` — needs the real client, not a proxy. Either wait until first query and hook then, or skip first-query observation.
- **Migration commands** (`pnpm rudder migrate`, etc.) need eager DB access. Would need a CLI bypass.

**Recommendation:** **Don't ship.** Higher risk than 2b for similar dollars of win. If the platform ever introduces the lazy-DI primitive, this can ride on top of it.

---

### Things not worth pursuing

- **PulseProvider boot cost** (~8 ms median) — too small to justify the SqliteStorage lazy-open complexity.
- **McpProvider, TelescopeProvider, AiProvider** — already audited in previous work ([[mcp-runtime-subpath-shipped]], [[ai-provider-eager-key-check]]). No remaining low-hanging fruit.
- **`rudder.command(...)` registrations in HTTP context** — registering commands when not running CLI is wasteful, but the cost is microseconds. Not worth a CLI-vs-HTTP split.

---

## Recommended next action

Ship **Lever 2a only** as a small `fix:` PR:

- Remove the eager `await adapter.connect()` call in `DatabaseProvider.boot()` (one line + a comment explaining the trade-off)
- Measure the actual delta in the playground (estimated 20–40 ms; bench script already exists)
- Document the behavior change in `@rudderjs/orm-prisma`'s CLAUDE.md and the package docs (DB-down errors now surface on first query)
- Optional follow-up: add `database.eagerConnect?: boolean` config knob if users want the old behavior. Not in v1.

Levers 2b and 2c require their own plan docs and architectural buy-in. Park them.

**Estimated outcome:** playground cold-boot goes from ~580 ms to ~550 ms median — small but real, no breaking change, no architectural debt.

---

## Reusable artifacts

The per-provider tracing instrumentation is reusable but not committed — applying it again is a 5-line patch in `Application._bootAll()`. Bench scripts in `/tmp/rudder-perf/` (parent plan doc).
