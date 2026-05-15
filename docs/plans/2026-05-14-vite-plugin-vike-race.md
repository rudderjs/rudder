# @rudderjs/vite — fix microtask race against `vike/plugin`

> **Status:** ✅ closed — Alt B shipped via #464 (2026-05-15). See [Outcome](#outcome-2026-05-15--alt-b-shipped).
> **Date filed:** 2026-05-14 (pilotiq side)
> **Last reviewed:** 2026-05-15 (rudder side — see [Assessment](#assessment-rudder-side-2026-05-15) and [Decision](#decision-2026-05-15--coordinated-path)).
> **Scope:** `@rudderjs/vite` only — single package, single function (`rudderjs()`).
> **Filed by:** pilotiq-pro side, in response to e2e workflow flakiness on GH Actions Ubuntu runners.

---

## TL;DR

`@rudderjs/vite@1.0.1`'s `rudderjs()` constructs the Vike plugin **inside** the async IIFE it returns. Vike's `plugin()` function returns a Promise whose IIFE synchronously checks `globalObject.isOnlyResolvingUserConfig` on entry — if `true`, it returns `[]` (Vike's "I'm being scanned, don't register anything" path).

Whether that flag is `true` or `false` at the moment Vike's IIFE starts is **a microtask-ordering race** between Vite's `loadConfigFromFile` returning (which resets the flag to `false`) and the rudderjs IIFE's second `await` resolving (which then synchronously calls `vikeMod.default()`).

The race is decided by Node version + load:

| Environment | Outcome |
|---|---|
| Local Node 22, warm cache | Always wins → vike plugins registered → `vike dev` works |
| GH Actions Ubuntu, Node 20 | Always loses → vike plugins `[]` → `assert(viteVersion)` fires at `vike/dist/node/api/dev.js:26` |
| GH Actions Ubuntu, Node 22 | **Coin flip** — about ~50% of runs hit the failure |

The failure manifests as a misleading error wrapper:

```
[vike@0.4.257][Bug] You stumbled upon a Vike bug. Go to https://github.com/vikejs/vike/issues/new
    at Module.dev (file:///.../vike/dist/node/api/dev.js:26:5)
    at cmdDev (.../vike/dist/node/cli/entry.js:25:9)
    at cli (.../vike/dist/node/cli/entry.js:11:9)
```

The actual underlying assertion is `assert(viteConfig._viteVersionResolved)` where `_viteVersionResolved` is the value Vike's `pluginCommon.config()` hook writes — never written because pluginCommon never registers when the IIFE returns `[]`.

## Repro

```bash
# In a pilotiq-pro checkout on an Ubuntu CI runner (Node 22):
cd playground
pnpm exec prisma db push --schema prisma/schema
pnpm dev
# ~50% chance you'll see the "[vike] Bug" assertion at startup.
```

Cleaner repro lives in `pilotiq-pro/.github/workflows/debug-vike.yml` (now deleted) which captured the dev-server stderr to an artifact and made the failure mode tractable. The diagnostic survives in git history at commit `e23bf97`.

## Root cause

In `packages/vite/src/index.ts`'s `rudderjs()` function:

```ts
export function rudderjs() {
  const promise = (async () => {
    const viewsScanner = viewsScannerPlugin()
    let vikePlugins: Plugin[] = []
    try {
      const vikePath = _require.resolve('vike/plugin')
      const vikeMod  = await import(vikePath)         // (A) — first await
      vikePlugins    = await vikeMod.default()        // (B) — vike's plugin() called here
    } catch {
      console.warn('[RudderJS] vike not found …')
    }
    return [...vikePlugins, viewsScanner, /* …more plugins… */]
  })()

  Object.assign(promise, { _vikeVitePluginOptions: {} })   // self-detect marker for Vike
  return promise
}
```

Vike's `plugin()` (in `vike/dist/node/vite/index.js`):

```js
function plugin(opts = {}) {
  const promise = (async () => {
    if (removeVitePlugin()) return []   // ← reads isOnlyResolvingUserConfig
    // …construct pluginCommon, pluginVirtualFiles, etc…
  })()
  Object.assign(promise, { _vikeVitePluginOptions: opts })
  return promise
}
```

And in `vike/dist/node/api/resolveViteConfigFromUser.js`, `getViteInfo()` does:

```js
globalObject.isOnlyResolvingUserConfig = true
const viteConfigFromUserViteConfigFile = await loadViteConfigFile(...)
globalObject.isOnlyResolvingUserConfig = false
```

The user's `vite.config.ts` runs inside `loadViteConfigFile`; it synchronously calls `rudderjs()`, which kicks off the async IIFE. By the time the IIFE reaches step (B), Vike's `plugin()` body runs synchronously and reads `isOnlyResolvingUserConfig`. If `loadConfigFromFile` has not yet returned (and thus `isOnlyResolvingUserConfig` is still `true`), Vike returns `[]`.

The race is between:
- the depth of microtask hops needed for `loadConfigFromFile` to return (Vite-internal, varies by file size + JIT state)
- the depth of microtask hops needed for `await import(vikePath)` to resolve (Node-internal, varies by module cache state + Node version)

Node 22 changed microtask scheduling for cached `await import()` such that the import resolves **later** relative to `loadConfigFromFile`, generally letting `isOnlyResolvingUserConfig = false` happen first. But it's a tendency, not a guarantee.

## Proposed fix

Two options, in order of preference:

### Option 1 — Don't call `vike/plugin` inside the scanned IIFE

Restructure `rudderjs()` so it returns the Vike plugin **as a separate top-level Promise** that Vite resolves AFTER `loadConfigFromFile` returns. Concretely: instead of one outer Promise that internally calls `vike/plugin`, return an array of Promise-plugins where Vike is its own entry.

```ts
export function rudderjs() {
  const vikePromise = (async () => {
    try {
      const vikePath = _require.resolve('vike/plugin')
      const vikeMod  = await import(vikePath)
      return await vikeMod.default()
    } catch {
      console.warn('[RudderJS] vike not found — install vike to enable SSR support.')
      return []
    }
  })()
  Object.assign(vikePromise, { _vikeVitePluginOptions: {} })

  const otherPromise = (async () => {
    return [viewsScannerPlugin(), /* …all the rudderjs-specific plugins… */]
  })()

  return [vikePromise, otherPromise]
}
```

Vite resolves Promise plugins lazily during config processing — **after** `loadConfigFromFile` returns and the `isOnlyResolvingUserConfig = false` reset has happened. The race disappears because Vike's IIFE no longer runs inside the scanned-config window.

> **Assessment (rudder side, 2026-05-15) — Option 1's mechanism is suspect.**
>
> Async IIFEs run synchronously **at construction**, not when awaited. The moment `rudderjs()` is called from `vite.config.ts`, both promises in Option 1 start executing through their first `await import(vikePath)`. The microtask race that fires `vikeMod.default()` is unchanged — just split across two promise chains instead of one. The only structural difference is that `vikePromise` resolves directly to Vike's plugin array rather than being embedded inside a larger array; that changes what Vite's plugin flattener sees but doesn't change *when* the IIFE body runs.
>
> Option 1 may *incidentally* shift microtask draining order enough to pass on Ubuntu Node 22, but the stated mechanism ("Vite resolves Promise plugins lazily" — which is true) doesn't explain a fix, because the IIFE bodies don't wait for Vite to await them. With a flaky failure mode, "passed 5 runs" is weak evidence. See [Alternatives](#alternatives-the-plan-didnt-consider) below.

### Option 2 — Defer the await of `vikeMod.default()` to a `config()` hook

Keep the outer IIFE structure but don't actually call `vike/plugin` until Vite's config-merging phase fires the plugin's `config()` hook. Pattern:

```ts
let vikePlugins: Plugin[] | undefined
const lazyVikeLoader = {
  name: 'rudderjs:vike-lazy-loader',
  async config(_userConfig, _env) {
    if (vikePlugins) return
    const vikePath = _require.resolve('vike/plugin')
    const vikeMod  = await import(vikePath)
    vikePlugins    = await vikeMod.default()
    // …figure out how to inject the resolved plugins…
  },
}
```

More invasive — Vite doesn't have a clean way to inject sibling plugins from inside a `config()` hook. Probably not worth pursuing; option 1 is the surgical fix.

## Alternatives the plan didn't consider

Added 2026-05-15 alongside the rudder-side assessment. Listed in increasing order of intrusiveness.

### Alt A — Explicit macrotask yield before `vikeMod.default()`

One line, deterministic by construction:

```ts
const vikeMod = await import(vikePath)
await new Promise(setImmediate)   // drain pending microtasks (incl. flag reset)
vikePlugins = await vikeMod.default()
```

`setImmediate` schedules in the check-phase macrotask — guaranteed to fire after **all** pending microtasks drain, which means after `loadConfigFromFile` returns and Vike's `isOnlyResolvingUserConfig = false` line executes. Surgical, no structural change, no breaking change for consumers. Worth A/B testing against Option 1 on Ubuntu Node 20 + 22 before committing to either.

Risk: relies on Node's event-loop ordering staying stable across versions. Has held across Node 18 → 22; not formally specified.

### Alt B — Synchronous Vike registration in user `vite.config.ts`

The conventional Vike pattern — `vike()` called synchronously in user code:

```ts
// scaffolded vite.config.ts
import vike from 'vike/plugin'
import rudderjs from '@rudderjs/vite'

export default defineConfig({
  plugins: [vike(), rudderjs(), tailwindcss(), react()],
})
```

The race disappears because `vike()` is called synchronously in user code — no dynamic-import chain interleaves with `loadConfigFromFile`. `@rudderjs/vite` can keep the current dynamic-import path as a fallback (detect Vike already in `plugins` → skip self-registration).

Cleanest long-term answer if Vike considers wrapping out of scope. Breaking change for every app generated by the current scaffolder, so it needs a migration plan (changeset + scaffolder template update + a sweep for in-the-wild apps via release notes).

### Alt C — Coordinated upstream patch

Discuss with brillout before committing to a rudder-side fix — he may prefer a Vike-side change (e.g. defer `removeVitePlugin()` past the first microtask, or expose a sync registration helper) over having every meta-framework re-discover this race. See [Decision](#decision-2026-05-15--coordinated-path) for the chosen path.

## Tests

This regression is currently uncaught by the rudder test suite. Adding a test requires either:

1. **An integration test** that spawns `vike dev` against a representative `vite.config.ts` (rudder's own playground would do) and asserts the dev server reaches `ready in N ms` — would catch the failure mode but is slow.
2. **A unit test** that mocks `isOnlyResolvingUserConfig = true`, calls `rudderjs()`, awaits the returned promise(s), and asserts the result contains vike's `pluginCommon` entries (`_vikeVitePluginOptions` set on the inner plugin object). This is the right shape — Promise-resolution semantics tested in isolation.

Either way, the test should pin: even when consumers call `rudderjs()` during early config scan, Vike's plugin must register.

> **Assessment (rudder side, 2026-05-15) — unit-test design has a gap.**
>
> The proposed unit test sets `isOnlyResolvingUserConfig = true` synchronously and never flips it back. That doesn't reproduce the *timing race* — it reproduces an "always wins" case where no fix could ever pass (Vike sees `true` no matter what). A real test needs to flip the flag mid-await, matching `loadConfigFromFile`'s bracket, so the fix is exercised against the actual contention window. Doable with manual microtask draining (`await Promise.resolve()` ladders) or fake timers, but the test plan should call it out.

## Acceptance criteria

- pilotiq-pro's `e2e` workflow on `ubuntu-latest` Node 20 runs `vike dev` cleanly without the `assert(viteVersion)` failure
- **20+** consecutive workflow runs all pass the Vike startup step (raised from 5 — with a ~50% per-run failure rate on Node 22, 5-in-a-row is ~3% probability of being a fluke; 20+ tightens the confidence interval)
- the new unit test covers the previously racy path *with the flag flipped mid-await*, not just held statically true

## Decision (2026-05-15) — coordinated path

After rudder-side review, the path forward is:

1. **Don't implement Option 1.** The mechanism described doesn't hold up (see [Assessment](#assessment-rudder-side-2026-05-15)). Shipping a fix whose causal chain we don't trust risks chasing flakes downstream when the race re-emerges in some other shape.
2. **Ping brillout with the diagnosis first.** Suleiman has a direct technical line. A short writeup of the race + the legitimate "meta-framework wraps Vike in an async factory" use case may surface a cleaner upstream fix (e.g. defer `removeVitePlugin()` past the first microtask, or expose a sync registration helper) rather than every wrapper re-discovering this race.
3. **If Vike treats the wrapping pattern as out of scope**, migrate to **Alt B** (synchronous `vike()` in user `vite.config.ts`) — that's the conventional Vike pattern and would also eliminate the related `_vikeVitePluginOptions` self-detection hack at `packages/vite/src/index.ts:299`.
4. **If we need a stopgap before brillout responds**, use **Alt A** (`setImmediate` yield) — one-line, deterministic, no breaking change. Validate against 20+ Ubuntu Node 20 + 22 CI runs before merging.

A draft GitHub-issue body for the upstream ping is held outside this plan; the gist:

> Vike's `plugin()` IIFE reads `isOnlyResolvingUserConfig` as its first synchronous action. When a meta-framework wraps `vike/plugin` in its own `async` plugin factory (`await import('vike/plugin'); await vikeMod.default()`), the wrapper's `await import(...)` and `loadViteConfigFile`'s internal awaits race through microtasks. Decided 50/50 on Ubuntu Node 22; always loses on Node 20. Is wrapping considered supported? If not, can it be documented? If yes, would Vike consider deferring the flag check?

## Outcome (2026-05-15) — Alt B shipped

The coordinated path resolved cleanly within the same day.

**Brillout's reply** (`vikejs/vike#3258`, closed 2026-05-15): *"If you statically import `vike/plugin`, does it fix the issue?"* — pointing at the conventional Vike pattern (Alt B). Locally verified that a scaffolded app with `import vike from 'vike/plugin'` + sync `vike()` in `vite.config.ts` boots cleanly (`Vike v0.4.259 · Vite v7.3.3 · ready in 591 ms`, no `[Bug]` failure, no "added 2 times" warning, views-scanner stubs land before Vike's pages scan).

**Shipped via #464:**

- **`@rudderjs/vite` major** — `rudderjs()` no longer dynamically imports `vike/plugin` or registers Vike. Returns `Plugin[]` synchronously instead of `Promise<Plugin[]>`. Drops the `_vikeVitePluginOptions` self-detection hack and the `createRequire` + dynamic-import machinery that caused the wrapper IIFE race.
- **`create-rudder-app` major** — scaffolded `vite.config.ts` emits `import vike from 'vike/plugin'` and includes `vike()` in the plugins array. Ordering: `rudderjs()` before `vike()`, because the views-scanner writes auto-generated stubs to `pages/__view/` during plugin construction and Vike scans `pages/` during its own construction.
- Migration for existing apps is the two-line diff documented in each changeset (and below).

**Migration diff for existing apps:**

```diff
  import { defineConfig } from 'vite'
+ import vike from 'vike/plugin'
  import rudderjs from '@rudderjs/vite'
  // …

  export default defineConfig({
    plugins: [
      rudderjs(),
+     vike(),
      // …
    ],
  })
```

**What the alternatives turned out to be:**

- *Option 1* (pilotiq's filed proposal) — never implemented. The mechanism didn't hold up under rudder-side review; brillout's reply pointed at the conventional pattern instead.
- *Alt A* (`setImmediate` yield) — never implemented. With Alt B shipping cleanly, an interim Alt A would have been pure churn.
- *Alt B* (synchronous `vike()` in user config) — **shipped.**
- *Option 2 / Alt C* (Vike-side upstream change) — not needed; brillout's existing conventional pattern was already the fix.

**Lesson for future filings:** when a meta-framework wraps an external Vite plugin in its own async factory, the wrapping pattern itself is the bug — not the plugin's flag check. Stay close to the upstream's conventional pattern; resist the temptation to "ergonomically bundle" plugins that have non-trivial init order.

## Cross-repo coordination

Now that #464 is merged and the version-packages PR will republish `@rudderjs/vite` + `create-rudder-app` as majors:

- pilotiq-pro can revert the workflow's `node-version: '22'` → `'20'` (Node 20 was the workflow's prior pin, only bumped as a partial workaround) after pulling the new `@rudderjs/vite` major and applying the two-line `vite.config.ts` migration.
- pilotiq-pro can drop the `e2e` workflow's `cwd: '../playground'` workaround (also a partial mitigation; the root issue was the same race aggravated by the extra pnpm-filter process layer).
- Acceptance threshold from the original plan: 20+ consecutive Ubuntu CI runs passing the Vike-startup step (raised from 5 given the ~50% flake rate). Validate post-migration.
- Pilotiq companion memory `[[rudderjs-vite-needs-node-22]]` can be closed out.

## Companion memory

- `~/.claude/projects/-Users-sleman-Projects-pilotiq/memory/feedback_rudderjs_vite_node_version.md` documents this race from the pilotiq side (current workaround posture).

## Pre-flight

```bash
cd ~/Projects/rudder
git checkout main && git pull --ff-only
pnpm install
pnpm --filter @rudderjs/vite typecheck
pnpm --filter @rudderjs/vite test     # baseline before changes
```
