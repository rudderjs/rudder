# Prompt Caching — Google (sub-PR 3 of 3)

**Status:** design — pre-implementation. Sub-PR 1 (Anthropic, [#336](https://github.com/rudderjs/rudder/pull/336)) and sub-PR 2 (OpenAI, in flight) ship the API and the two simpler translations. This doc pins down the open questions Google's `cachedContent` API forces before any code gets written.

**Related:** `docs/plans/2026-05-09-ai-roadmap.md` §A1.

---

## Why Google is bigger than the other two

Anthropic's prompt cache is a header on a content block. OpenAI's is a routing-affinity string. Both are stateless from our side — we attach a marker, send the request, done.

Google is different. `cachedContent` is a **stateful, server-side resource**:

1. **Two-step protocol.** First call `client.caches.create({ model, systemInstruction, contents, tools, ttl })` and get back a `name` like `cachedContents/abc123`. Then on `generateContent`, pass `cachedContent: 'cachedContents/abc123'` *instead of* the system / contents / tools that are now baked into the resource.
2. **Per-resource TTL.** Default 1 hour, configurable up to ~24h (model-dependent). After expiry the resource is gone — using it returns 404; we have to recreate.
3. **Model-bound.** A cache is tied to one model id. Switching `model('gemini-2.5-pro')` → `model('gemini-2.5-flash')` invalidates.
4. **Minimum size.** Below the model's threshold (~1024 tokens for 2.5-flash, higher for older), `caches.create` errors. Tiny prompts can't be cached at all.
5. **Storage cost.** Google charges $/M-tokens-stored/hour. So unlike Anthropic (charge on write, free reads within 5min) and OpenAI (free, automatic), there's a real meter running between hits. Net win only if the hit rate justifies the storage bill.
6. **Concurrent-create races.** Two requests with the same hash arriving before the first `caches.create` returns will both try to create. Either the SDK errors on duplicate or we end up paying for two resources.

So translating `CacheableMarkers` to `cachedContent` requires a **registry** — some component that owns the hash → resource-name map, the create-call coordination, and the TTL refresh policy. None of that existed before; it's the bulk of this sub-PR.

---

## Google API surface (what we'll actually call)

The `@google/genai` SDK exposes:

```ts
// Create
const cache = await client.caches.create({
  model: 'gemini-2.5-flash',
  config: {
    systemInstruction: { parts: [{ text: '...' }] },
    contents: [/* gemini-shaped messages */],
    tools: [{ functionDeclarations: [...] }],
    ttl: '3600s',                 // string seconds, default 3600
    displayName: 'optional label',
  },
})
// → cache.name === 'cachedContents/abc123'

// Use
await client.models.generateContent({
  model: 'gemini-2.5-flash',     // must match cache's model
  contents: [/* only the NEW messages (everything not in the cache) */],
  config: {
    cachedContent: cache.name,
    // Don't re-send systemInstruction / tools — they're inherited.
  },
})

// Lifecycle
await client.caches.list()
await client.caches.update({ name, config: { ttl: '7200s' } })
await client.caches.delete({ name })
```

**Constraint:** when `cachedContent` is set, the request body must NOT also carry the regions that are part of the cache. The agent loop's existing `toGeminiContents()` always emits system + tools + full message history; we'll need to split out *what's cached* from *what to send fresh* per request.

---

## Open design questions

### Q1. Where does the hash → resource-name map live?

**Constraints:**
- Must survive across calls within a single process (otherwise every request creates a new cache → infinite-money fountain in the wrong direction).
- Should ideally survive across restarts (otherwise a deploy invalidates every cache and we pay for orphans until TTL).
- Must be process-shared in multi-worker setups (otherwise each worker creates duplicates).

**Options:**
- **A. In-memory `Map`.** Zero deps, single-process only. After restart: orphan resources until TTL expires (storage cost bleeds for ~1h). After fork: each worker gets its own duplicates.
- **B. `@rudderjs/cache` (existing framework cache).** Already pluggable (memory / redis / file drivers). Cross-process and cross-restart when configured with redis. Runtime dep on `@rudderjs/cache` — but we're a server-only feature anyway (the runtime-agnostic main entry doesn't run providers).
- **C. New pluggable `CacheRegistry` interface in `@rudderjs/ai`.** Most flexible, most code, most surface area. Same outcome as B with more boilerplate.

**Recommendation:** **B** — use `@rudderjs/cache`. Shipping a new pluggable interface for one consumer is over-engineered, and the framework's cache contract already covers TTL, drivers, and cross-process semantics. We add a soft peer dep on `@rudderjs/cache`; if the user hasn't installed it, fall back to an in-process `Map` and log a one-line warning on first use (`"@rudderjs/ai: Google prompt caching is using in-memory storage; install @rudderjs/cache for cross-process/restart persistence"`).

**Open:** does this dep break the runtime-agnostic guarantee? No — google.ts is a provider adapter; provider adapters are server-only by nature (they import provider SDKs that themselves pull node:* APIs). The check in `isomorphic-check.test.ts` excludes `src/server/` and the providers run via dynamic import. We're fine.

### Q2. TTL strategy

**Options:**
- **D. Fixed 1h default.** Match Google's default. User opts up via a config knob.
- **E. Adaptive — refresh on hit.** Each cache use triggers a `caches.update({ ttl: '+1h' })` so frequently-used caches stay alive. Stale ones expire naturally.
- **F. Configurable per `cacheable()` declaration.**

**Recommendation:** **D + F**. Default 1h (Google's default; matches user expectations for "ephemeral"). Make it configurable via a new optional field on `CacheableConfig`:

```ts
class SupportAgent extends Agent {
  cacheable() {
    return { instructions: true, tools: true, ttl: '6h' }
  }
}
```

Skip **E** for v1 — the refresh-on-hit pattern needs careful thought (each refresh is a billable API call; chatty caches cost more than letting them expire and recreate). Revisit if telemetry shows high recreate churn.

`ttl` accepts a duration string (`'30m'`, `'2h'`, `'1d'`) parsed with the same helper used elsewhere in the framework.

### Q3. Concurrent-create races

Two requests with the same hash, both miss the cache, both call `caches.create` — duplicate spend.

**Options:**
- **G. In-process lock (`Map<hash, Promise<resourceName>>`).** Cheap. Doesn't help across processes.
- **H. Distributed lock via `@rudderjs/cache` (`add()` + TTL).** Real cross-process protection. Adds latency on every cache miss (one cache `add` round-trip) — acceptable since misses are rare by design.
- **I. Don't lock — accept duplicates.** Storage cost of an extra resource for one TTL window. Simpler. For typical workloads (1 to a few hits per resource per TTL), the duplicate is a small fraction of total spend.

**Recommendation:** **G + I as fallback**. Always do the in-process lock (free, removes the most common race — same worker, two concurrent requests). Skip distributed locking for v1; document the cross-worker duplicate window as known behavior. If users complain, add **H** behind a config flag in v2.

### Q4. Minimum-token gate

`caches.create` errors below the model threshold. We can't blindly cache.

**Options:**
- **J. Pre-check the prompt token count.** Requires a tokenizer per model; fragile and adds dep weight.
- **K. Try-then-fall-back.** Call `caches.create`; on error, log + run the request uncached. Memoize the failure for a short window so we don't retry every call.

**Recommendation:** **K**. Token estimation is a rabbit hole and Google has already done the work — the API tells us exactly when a prompt is too small. Cache the failure (hash → "too small") for ~5 minutes so a tight loop doesn't pound the create endpoint. Surface a single warn log per unique hash:

```
[RudderJS AI] Google cache for hash <abc123> below model minimum — running uncached. Future calls with the same prefix will skip cache attempts for 5m.
```

### Q5. Stale cache (404 on use)

The resource expired between create and use. The `generateContent` call returns a 404-ish error.

**Options:**
- **L. Catch the error, recreate, retry once.** One recovery path per stale cache.
- **M. Return the error and let the caller retry.** Simpler; surfaces as a normal API error.

**Recommendation:** **L**. Recreate-on-404 is a one-liner and matches the user's mental model ("caching should be transparent"). Drop the dead entry from the registry, recreate, retry. No outer-layer code change.

---

## Proposed architecture

```
packages/ai/src/providers/
├── google.ts                ← existing adapter; add ~80 LOC for cache wiring
└── google-cache-registry.ts ← new file (~150 LOC)
```

**`google-cache-registry.ts`** exports a single class:

```ts
class GoogleCacheRegistry {
  constructor(opts: {
    cacheStore?: import('@rudderjs/contracts').CacheStore  // optional; falls back to Map
    defaultTtl?: string                                    // default '1h'
  })

  // Returns the cachedContents/* resource name, creating if needed.
  // Returns null if the prompt is too small to cache.
  async resolve(args: {
    client: any                                // the @google/genai client
    model: string
    cacheKey: string                           // hash of marked regions + model
    systemInstruction?: { parts: { text: string }[] }
    contents?: unknown[]
    tools?: unknown[]
    ttl?: string
  }): Promise<string | null>

  // Drop a resource from the registry (called on 404 retry).
  forget(cacheKey: string): void
}
```

**Hash composition.** Same shape as OpenAI's `buildPromptCacheKey` — canonical JSON of `{ model, instructions?, tools?, messages? }` → cyrb53. Reuse the `cyrb53Hex` helper from `openai.ts`; lift it to a shared utility (`packages/ai/src/util/hash.ts`) when this PR lands.

**`google.ts` integration.** In both `generate()` and `stream()`, after building `system` + `contents` + `tools`:

```ts
let cacheName: string | null = null
if (options.cache) {
  const cacheKey = buildGoogleCacheKey(this.model, options.cache, system, contents, geminiTools)
  cacheName = await this.cacheRegistry.resolve({
    client, model: this.model, cacheKey,
    systemInstruction: system ? { parts: [{ text: system }] } : undefined,
    contents: contentsToCache(contents, options.cache),  // first N messages only
    tools: options.cache.tools ? geminiTools : undefined,
    ttl: options.cache.ttl,
  })
}

// When we have a cache: send only the NEW messages and the cached resource ref.
// When we don't: send everything as before.
const payload = cacheName
  ? { model, contents: contentsAfterCache(contents, options.cache), config: { ...config, cachedContent: cacheName } }
  : { model, contents, ...(system ? { systemInstruction: ... } : {}), config }
```

`contentsToCache()` and `contentsAfterCache()` split the message list at index `cache.messages` — everything before goes into the resource, everything after gets sent fresh per request.

**Provider config.** New optional field on `GoogleConfig`:

```ts
export interface GoogleConfig {
  apiKey: string
  cache?: {
    store?: CacheStore       // optional @rudderjs/cache binding
    defaultTtl?: string      // default '1h'
  }
}
```

The `AiProvider` (in `/server`) wires the framework cache automatically when a `cache` config block is present in `config/ai.ts`.

---

## Test plan

Lift the OpenAI test pattern. Pure-function tests for the registry + adapter wiring (no real network):

1. **Registry caches by key**: same key → no second `caches.create` call.
2. **Registry creates per model**: same content + different model → two resources.
3. **Registry handles "too small" errors**: caches the failure, returns null, doesn't retry within 5min.
4. **Registry recreates on 404**: simulated stale resource → drop + recreate + return new name.
5. **Adapter sends `cachedContent` when registry returns a name**: payload omits cached regions.
6. **Adapter falls back to uncached when registry returns null**: payload includes everything.
7. **Adapter survives `caches.create` failure entirely**: any other error logs + runs uncached.
8. **Concurrent calls with same key issue one create**: in-process Promise dedup.

Mock `@google/genai` with a fake client (counts `caches.create` / `caches.delete` calls). No live API needed.

---

## Out of scope

- **Cache observability.** Hit/miss counters, storage spend telemetry. Same call-out as the original A1 plan — Telescope follow-up.
- **Per-call TTL override.** `prompt(input, { cache: { ttl: '12h' } })`. Adds API surface; revisit if anyone asks.
- **Distributed locking** (Q3 option H). Documented as known limitation.
- **Refresh-on-hit TTL** (Q2 option E). Documented as known limitation.
- **Auto-deletion of orphans on shutdown.** Tempting but risky — multi-worker deploys would have one worker delete resources another is using. Let TTL handle it.

---

## Open questions for review

**Resolved 2026-05-09 (review pass 1):**

- ✅ **Q1 — registry storage backend.** Decision: **B**. Soft peer dep on `@rudderjs/cache`. Falls back to in-process `Map` + one-line warning when the package isn't installed. Auto-wire on `AiProvider` boot when both packages are present (matches how `RateLimit` middleware already binds to the cache).
- ✅ **Q2 — `ttl` on `CacheableConfig`.** Decision: **a**. Add `ttl?: string` to `CacheableConfig` in this PR. Default `'1h'` when omitted. Anthropic/OpenAI ignore the field (their caching has no per-call TTL). Document as "Google-only for now" in the JSDoc.

**Resolved 2026-05-09 (review pass 2):**

- ✅ **Q3 — Hash utility lift.** Decision: **lift**. Extract `cyrb53Hex` from `openai.ts` to `packages/ai/src/util/hash.ts` in this PR. Both adapters import from the shared util.
- ✅ **Q4 — cache binding location.** Decision: **DI auto-wire only**. `AiProvider` checks `app().make('cache')` on boot and passes it to `GoogleCacheRegistry`. No new field on `GoogleConfig`. Matches `RateLimit`'s binding pattern.

---

## Estimated scope

~400 LOC: registry (~150) + adapter wiring (~80) + tests (~150) + small types/JSDoc updates. Significantly larger than sub-PR 2 (OpenAI was ~90 LOC of code + 90 of tests). One-week-ish given the fuzziness around concurrent-create + recreate-on-stale paths.
