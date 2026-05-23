# React Server Components via `vike-react-rsc` — integration design

**Status:** plan, 2026-05-23. Exploratory design — gated on an explicit "go" decision (see "Decision gate" below). Not yet scheduled.
**Origin:** Architecture exploration 2026-05-23. Question raised: can RudderJS offer an islands-style, less-JS rendering model *and* keep true SPA navigation? That combination is React Server Components (RSC). Rather than build an SSR engine, we spiked the community extension `vike-react-rsc@1.0.0` standalone and confirmed it delivers exactly that on the engine we already run (vike + Vite).

---

## Why this exists

RudderJS today renders views the "whole-page hydration" way: a controller returns `view('id', props)`, vike SSRs the React tree, and the entire page hydrates on the client (the Next Pages Router / Nuxt / SvelteKit model). That gives a good first paint and smooth SPA nav, but ships JS for the *entire* page — including parts that are purely static.

RSC changes the unit of work: most components render on the server and ship **no** client JS; interactivity is opt-in per component (`"use client"`); a thin persistent client router stays alive so navigation is a soft swap, not a reload. The result is "less JS, server-rendered" **and** "true SPA navigation" at the same time — the thing islands frameworks (Astro) give up nav for, and the thing whole-page SPAs give up JS budget for.

A second payoff: **server actions**. A `"use server"` function is callable directly from a component — no API route, no fetch boilerplate, no client-side data plumbing:

```ts
"use server"
import { rerender } from "vike-react-rsc/server"

export const addTodo = async (title: string) => {
  await db.todos.create({ title })
  rerender()        // server re-renders, streams the updated UI back
}
```

## What the spike proved

`vike-react-rsc@1.0.0` was cloned and run standalone (`examples/full`, port 3111). Verified end-to-end against a real running server, not by inspection:

| Behavior | Evidence |
|---|---|
| Server components render on the server, data inlined into HTML | `/data` HTML contained the server-fetched film list; the request took **3.55s** because the component's 2s server-side fetch completes before any HTML is sent |
| RSC flight payload embedded for hydration | `self.__rsc_payload_stream` / `self.__rsc_web_stream` present in the served HTML |
| True SPA navigation coexists | vike's `runtime-client-routing/entry.js` is loaded on every page; a soft navigation fetches a 64-byte pageContext envelope, not the 53KB document |
| Server actions work | `"use server"` + `rerender()` round-trips the updated UI |

Conclusion: the model is real, shipped at 1.0, and runs on vike + Vite + Hono — the stack we already use. The open question is purely **integration cost**, not feasibility.

## Goals

- Make RSC an **opt-in renderer** alongside the current `vike-react` view model — not a replacement, not a forced migration.
- A `view('id', props)` controller call must keep working unchanged for apps that don't adopt RSC.
- Define how a controller and a self-fetching server component compose, so the two models are coherent rather than two disconnected worlds.
- Keep `@rudderjs/server-hono`'s existing JSON-API and `view()` SPA-nav paths intact.

## Non-goals

- Not replacing `vike-react`. Whole-page hydration stays the default and the supported path.
- No Vue/Solid RSC — **not a policy choice, an upstream reality.** RSC is a React technology (the Flight protocol / `react-server-dom`); `vike-react-rsc` wraps React's RSC, it is not a vike feature that generalizes. There is no Server Components equivalent for `vike-vue`, and SolidStart ships only the server-*functions* half (`"use server"` RPC), not server components. RSC is therefore intrinsically a React-only renderer variant; Vue/Solid keep whole-page hydration.
- No production deployment story in this pass (the example leans on `vike-server`/`vike-cloudflare` + `standaloner` for bundling; we evaluate dev + SSR correctness first).
- Not committing to ship. This doc scopes the work so the go/no-go is informed.

## Architecture — the four integration points

### 1. Versions (low risk)

The example pins react `^19.2.0` and vite `^7.2.2`; the playground is on react `^19.0.0` and vite `^7.1.0`. Both are monorepo-wide (every package shares them), so the bump is a global change but a small one. Add `vike-react-rsc` as a dependency of the app (not the framework — see renderer detection below).

### 2. `@rudderjs/vite` scanner — teach it the RSC renderer (contained)

The view scanner auto-detects the installed renderer in `detectFramework()` (`packages/vite/src/views-scanner.ts`, the `[pkg, fw]` list around line 88):

```ts
for (const [pkg, fw] of [
  ['vike-react', 'react'],
  ['vike-vue',   'vue'],
  ['vike-solid', 'solid'],
] as const) { ... }
```

`vike-react-rsc` is a different package name, so today the scanner would not detect it and would emit zero `view()` pages. Work:

- Add a `react-rsc` framework variant detected from the `vike-react-rsc` package.
- The generated page modules import `usePageContext` from `vike-react/usePageContext` (line ~299); the RSC variant uses `vike-react-rsc/pageContext` instead (the spike confirmed `getPageContext()` from that subpath).
- Decide the multi-renderer guard: `vike-react` and `vike-react-rsc` are mutually exclusive (both are React renderers) — extend the existing "multiple renderers" error to cover the pair.

This is self-contained codegen work with existing test coverage (`views-scanner.test.ts`).

### 3. `@rudderjs/server-hono` — the crux

This is the load-bearing piece. Today the adapter mounts vike via the official Hono adapter (`packages/server-hono/src/index.ts` ~line 850):

```ts
const vike = (await import('@vikejs/hono')).default
// ...
vike(app)
```

…and it already has a hand-rolled SPA-nav path: it rewrites `/<path>/index.pageContext.json` → `/<path>` so a `view()` controller route matches, then `ViewResponse.toResponse()` hands the original URL back to `renderPage` so vike emits the JSON pageContext envelope instead of HTML (index.ts ~840). That handles the *current* whole-page SPA nav.

RSC introduces an **additional request type**: the client router fetches an RSC component stream on navigation (handled in the example by middleware bundled inside `vike-server`/`vike-cloudflare`'s `apply()`). Our `@vikejs/hono` + `renderPage` flow does not serve that stream. Two ways to close the gap:

- **Option A — mount the RSC middleware into the existing Hono app.** `vike-react-rsc` exposes `vike-react-rsc/__internal/integration/rscMiddleware`. If that middleware can be installed onto our Hono instance alongside `vike(app)` (rather than only through `vike-server`'s `apply()`), we keep our entire `view()` / JSON-API / error-page / prewarm machinery untouched and just add the RSC route. **Preferred if feasible** — smallest blast radius. Risk: the `__internal` path signals this is not a supported public seam; it may assume `vike-server`'s request lifecycle.

- **Option B — move the adapter onto `vike-server`.** Re-platform `@rudderjs/server-hono` from `@vikejs/hono` to `vike-server` (which the example uses and which RSC integrates with zero-config). This is the vendor-blessed path but a larger change: we'd re-home the error handler, the `view()` `toResponse` flow, the `.pageContext.json` rewrite, CORS, and the eager-prewarm side-effect onto the new lifecycle. Higher risk to existing behavior; needs the full server-hono test surface re-validated.

**Phase 0 result (2026-05-23) — Option A confirmed; Option B dropped; no re-platform needed.** Source-level probe of the running spike established:

- The RSC handler is a `@universal-middleware/core` middleware at path `/_rsc` (GET/POST), declared via vike's config `middleware` field by the `extends: [vikeReactRsc]` extension — *not* mounted by the server entry, and *not* coupled to `vike-server` internals.
- It routes through `renderPage` from `vike/server` — the same function our `view()` → `toResponse()` flow already calls — via the new `handleServerAction` / `handleNavigation` hooks.
- `vike-server`'s own Hono integration is literally `apply(app, universalMiddlewares)` from `@universal-middleware/hono`; there is nothing proprietary to replicate, and that adapter is already in the dependency tree.

So point 3 collapses to: in `@rudderjs/server-hono`, `apply()` vike's resolved universal middlewares onto our *existing* Hono app via `@universal-middleware/hono`, alongside the current `vike(app)` / custom fetch handler / `view()` / error-page / prewarm machinery — additive, not a rewrite. **Open sub-question for Phase 3:** whether `@vikejs/hono`'s `vike(app)` already applies config-declared middlewares (making even the explicit `apply()` unnecessary) or whether we add the `@universal-middleware/hono` mount ourselves. Either way it is small.

### 4. The `view()` ↔ server-component design decision

The current model is controller-driven: the controller fetches data and passes `props` to a presentational view. RSC inverts this — the page *is* an async server component that fetches its own data, and mutations go through server actions.

These must coexist coherently. The proposed shape:

- A controller returning `view('id', props)` continues to render a (whole-page) `vike-react` view. Unchanged.
- An RSC view is a server component under `app/Views/` that the scanner registers as a `react-rsc` page. The controller's role for an RSC route is to provide request context (auth, params, flash) via `pageContext`, which the server component reads through `getPageContext()` — *not* to pass rendered props. The spike confirmed `getPageContext()` is available inside server components.
- Server actions live in `app/Actions/**` (`"use server"`). Open question: whether they integrate with the DI container / form-request validation, or stay plain functions in v1. Recommend plain functions in v1; container integration is a follow-up.

This is the part with the most product-design surface and the least precedent in our codebase. It deserves its own short RFC once Option A/B is settled.

## Phased plan

| Phase | Scope | Gate |
|---|---|---|
| 0 | ✅ **DONE 2026-05-23** — probed how RSC request handling is wired. Decided **Option A**: RSC is a mountable `/_rsc` universal middleware applied via `@universal-middleware/hono`; no re-platform. | Passed — Option A confirmed cheap. |
| 1 | Version bumps (react 19.2 / vite 7.2) on a branch; confirm the whole monorepo builds + existing playground unaffected. | `pnpm build` + `pnpm typecheck` clean; playground renders. |
| 2 | `@rudderjs/vite` scanner: `react-rsc` renderer detection + RSC `usePageContext`/codegen + mutual-exclusion guard. | `views-scanner.test.ts` extended + green. |
| 3 | `@rudderjs/server-hono`: implement the chosen option (A or B). | server-hono test surface green; `view()` + JSON API + error page unchanged. |
| 4 | Playground: one RSC view + one server action, behind an opt-in flag/dir; manual verify SSR + soft-nav + action round-trip. | Live: server-rendered HTML, 64-byte soft-nav, action rerenders. |
| 5 | Docs + the `view()`↔server-component RFC; decide GA vs experimental label. | — |

Phases 0–1 are cheap and reversible; the real investment starts at phase 3.

## Risks and open questions

- **Maintenance / bus factor.** `vike-react-rsc` is a single-maintainer community extension (nitedani), marked under-development, not part of vike core. Adopting it couples a first-class RudderJS feature to a young dependency. Mitigation: ship as **experimental**, keep `vike-react` as the supported default, and gate GA on the extension's maturity + our own confidence.
- **`__internal` seam (Option A).** The RSC middleware lives behind an `__internal` export — no stability guarantee across `vike-react-rsc` versions. If A relies on it, pin the version and add a smoke test that fails loudly on upgrade.
- **Externalization vs transform.** RSC requires the server/client component boundary to be processed by the bundler. Confirm our SSR `external` config (the `@anthropic-ai/sdk` / `openai` / `@google/generative-ai` externals in the playground `vite.config.ts`) doesn't interfere with the RSC environment.
- **Styling.** The example uses `@compiled/react`; we use Tailwind. Orthogonal to RSC, but confirm Tailwind's Vite plugin coexists with the RSC plugin chain.
- **Prerender interaction.** We recently shipped static + dynamic prerender for `vike-react` views. RSC prerender semantics differ; out of scope here but flag that `export const prerender` on an RSC view is undefined behavior until designed.

## Decision gate

This is a strategic bet, not a bugfix. Proceed only if RSC is a desired *product direction* (islands-style, content-first, less client JS) — not as a performance play. Our own perf series already established that vike is not the bottleneck (the SSR RPS gap lives in `@hono/node-server`, not the renderer), so RSC will not make existing pages faster on the server; its wins are client JS budget and the server-action ergonomic.

**Kill criteria:** if phase 0 shows Option A is infeasible *and* there's no appetite to re-platform server-hono onto `vike-server` (phase 3 Option B), stop — the cost is no longer proportionate to an opt-in renderer.

## References

- Spike: `vike-react-rsc@1.0.0`, `examples/full` run locally (this session).
- Scanner: `packages/vite/src/views-scanner.ts` (`detectFramework`, usePageContext import sites).
- Server mount: `packages/server-hono/src/index.ts` (`@vikejs/hono` `vike(app)`, `.pageContext.json` rewrite, `view()` `toResponse`).
- vike RSC docs: https://vike.dev/react — extension: https://github.com/nitedani/vike-react-rsc
