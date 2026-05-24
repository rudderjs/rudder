# Provider-boot route handlers hold a stale closure across dev HMR re-registration

> **RESOLVED 2026-05-24 — the framework is NOT the cause; this doc's leading hypothesis is FALSIFIED.**
> Investigated on the framework side after this handoff was filed. Findings:
> - The dev reload path **already** calls `router.reset()` before re-registration (`app-builder.ts:278`) **and** builds a fresh `new Hono()` per bootstrap (`server-hono index.ts:803`). Routes do **not** accumulate, so the "router appends a duplicate handler, first-match-wins shadows the fresh one" hypothesis below is wrong.
> - Provider `boot()` **does** fully re-run on `app/` edits in dev — proven by the dev console (`[RudderJS] change detected … [AppServiceProvider] booted … N providers booted … ready`).
> - **Leading (pilotiq-internal) cause:** the re-boot re-runs but re-reads a **stale `AdminPanel.ts`** — reached via the SSR-externalized `@pilotiq` package path / Node require cache, which Vite's `invalidateAll()` does not clear — so re-registration just re-stores the same stale panel. The decisive probe (a timestamp `console.log` at the top of `AdminPanel.ts`) is owned by the pilotiq agent, not the framework.
>
> The original (now-falsified) handoff text is kept below for the record. Do **not** implement a router replace-vs-append fix on its basis.

**Status:** RESOLVED — framework not the cause (see banner). Original status: plan / handoff, 2026-05-24. Root-cause investigation for the framework session.
**Origin:** pilotiq design-pass sessions 2026-05-23/24. Editing `app/Pilotiq/AdminPanel.ts` (or a resource/page schema it imports) in dev didn't reflect without a server restart — the SSR-rendered panel lagged a reload behind. Pilotiq shipped a request-time workaround (`PilotiqRegistry.livePanel()`, PRs #70/#71) but the clean fix lives in `@rudderjs/core` and is deferred. This doc hands that off.

---

## Symptom

A downstream package (`@pilotiq/pilotiq`) registers HTTP routes inside a **service provider's `boot()`**, e.g. `registerPilotiqRoutes(router, panel)`, where each route **handler closure captures `panel`** (a config object). In dev, when the user edits a watched source file, the provider re-runs: it builds a fresh `panel` and calls `registerPilotiqRoutes(router, freshPanel)` again.

At request time the handler still uses the **OLD/stale `panel` closure**, even though a fresh panel was registered. Confirmed by probe: `closure-branding = OLD` while `registry-branding = NEW` for the same request.

## Already ruled out (during the pilotiq investigation)

- **`@rudderjs/vite` reload is not the culprit** — a faithful repro in the *plain* `rudder/playground` reflects edits live (no staleness).
- **`Application.create()` builds a fresh instance** — verified; the new app/provider graph is constructed.
- So the staleness is specifically about **how/where routes get registered**, not the reload mechanism or app construction.

## The tell

The plain rudder playground registers routes in a way that **does** reflect edits live, while pilotiq's **provider-`boot()` route registration with closure capture** does not. The difference between those two registration paths is the crux.

## Leading hypothesis (for the framework session to verify — not yet confirmed against `@rudderjs/core`/`@rudderjs/router` source)

When a provider re-runs in dev and calls the router's register API again for the **same method+path**, the router likely **appends a duplicate handler** rather than replacing it, and **first-match-wins** on dispatch — so the stale (first-registered) handler shadows the freshly-registered one. The plain playground presumably re-evaluates route *files* and/or the router is cleared/replaced between reloads, which the provider-boot path doesn't get.

Worth checking in the framework:
1. **Router re-registration semantics** — for a repeated method+path, does the route table REPLACE, APPEND (first wins), or throw? (This is the most likely root cause.)
2. **Provider lifecycle on dev reload** — are `register()` / `boot()` re-invoked on a NEW `Application`, and is there any route-table reset between reloads?
3. **Any existing reset/clear hook** — `router.reset()` / flush / dev-only "clear before re-register".

## Goal

Make provider-boot route re-registration go fully live in dev (replace, don't shadow), so that:
- downstream packages registering routes in `boot()` with closure-captured config reflect edits without a restart, and
- pilotiq can **remove its `livePanel()` request-time workaround** (re-resolving the panel from a globalThis registry by name on every render-data builder).

## Pilotiq-side context (for reference)

- Workaround: `PilotiqRegistry.livePanel(panel)` → `map.get(panel.name) ?? panel`, called at the top of every SSR render-data builder + the chrome builder (PRs #70/#71). The provider's `register()` does `PilotiqRegistry.reset()` then re-registers, so the global map holds the fresh instance; `livePanel` re-resolves against it at request time.
- Residual even with the workaround: a **one-time off-by-one on the very first edit after a cold boot / dep re-optimize** — steady-state consecutive edits are fresh. That residual is exactly the symptom of the provider-boot re-registration not going fully live, which is what this doc is about.
