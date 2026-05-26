# Upgrade RudderJS to Vite 8 (rolldown)

**Filed:** 2026-05-25 · **Status:** ✅ executed 2026-05-26 (branch `chore/vite-8-upgrade`) · **Type:** cross-package major migration · **Affects:** `@rudderjs/vite`, `@rudderjs/view`, `@rudderjs/server-hono`, all renderer paths (react/vue/solid/vanilla), `vike-react-rsc-rudder`, both playgrounds, scaffolder templates

## Outcome (2026-05-26)

Done as a deliberate, gated PR. Bumped `vite 7→8`, `@vitejs/plugin-react 4→6`, `@vitejs/plugin-vue 5→6`, `@tailwindcss/vite →4.3` (declares Vite 8), and pulled `vite-plugin-solid 2.11.12` (Vite 8 peer) across `@rudderjs/vite`, the RSC pair, both playgrounds, and the scaffolder template. **vike stayed pinned `0.4.257` + patch** (independent of the Vite bump; see [[project_vike_patch_dont_unpatch]]). vitepress stays isolated on its own Vite 5 (1.x is Vite-5-locked) — untouched. `@rudderjs/vite`'s published peers (`vite: ">=5.0.0"`, etc.) already accepted Vite 8, so only its devDeps changed — no consumer-facing change there; the only changeset is `create-rudder` (scaffolds now target Vite 8).

Validated: full build (54/54, rolldown), `@rudderjs/vite` tests (110), full test suite (only the pre-existing boost unknown-command drift fails), typecheck (96/96), playground prod boot + dev SSR + HMR, RSC production e2e (SSR + `"use server"` round-trip — the `virtual:client-references` regression does **not** manifest under rolldown), and the scaffolder smoke for React/Vue/Solid (install → build → boot → headless render). Two non-fatal rolldown diagnostics: a `[EVAL]` warning on the playground's tinker/eval demo, and `[INEFFECTIVE_DYNAMIC_IMPORT]` notes for mcp/passport (same as Rollup).

> A latent re-boot bug (dev HMR reset gated on `isDevelopment()` rather than "is re-boot") surfaced while validating in a fresh worktree with no `.env` — it is **not** Vite-8-related (reproduces on Vite 7) and shipped separately as #689.

## TL;DR

Vite 8 is stable and current; we're on Vite 7.3.1. Our core deps already accept Vite 8 and the plugin ecosystem is moving on (plugin-react@6 is Vite-8-only). **Recommendation: do it, but as a deliberate dedicated PR gated by the full CI portability matrix — not bundled into the in-flight RSC work, and not now.** No perf payoff for us (the SSR RPS gap is in `@hono/node-server`, not Vite — see [[project_ssr_rps_gap_outside_vike]]); the driver is staying current with the plugin ecosystem, not speed.

## Verified state (2026-05-25)

| Package | We pin | Latest | Vite 8 support |
|---|---|---|---|
| `vite` | `7.3.1` | `8.0.14` (`latest`; 7.x is now `previous` = 7.3.3) | — |
| `vike` | `0.4.257` | `0.4.259` | peer `vite >=6.3.0`, `engines.node >=20.19.0` → accepts 8 |
| `@vitejs/plugin-rsc` | `0.5.1` | `0.5.26` | peer `vite: *` |
| `@vitejs/plugin-react` | `^4.3.4` | `6.0.2` | **peer `^8.0.0` — Vite-8-only** |
| `@vitejs/plugin-vue` | `5.2.4` | `6.0.7` | `^5 || ^6 || ^7 || ^8` |
| `vite-plugin-solid` | `2.11.10` | `2.11.12` | up to `^8` |
| `vike-react` | `0.6.23` | `0.6.23` | no vite peer (relies on vike) |

Node floor (`>=20.19.0`) is fine — we run Node 22.

## What Vite 8 changes that matters to us

- **Bundler/optimizer → rolldown** (replaces esbuild + Rollup). This is the load-bearing change. It touches:
  - `@rudderjs/vite`'s `rudderjs:routes` scanner + dev re-boot/HMR invalidation
  - the SSR build pipeline (`dist/server/index.mjs` shape, chunking)
  - dep pre-bundling (`optimizeDeps`) — directly relevant to the RSC `virtual:client-references` regression below
- **Plugin majors come along for the ride**: plugin-react 4→6 (Vite-8-only), plugin-vue 5→6 — each with its own breaking changes.

## Why not now

1. **It's a real major, not a bump.** Rolldown swap risks subtle build/dev differences across every renderer + the scanner + SSR.
2. **No perf unlock.** Our request-path bottleneck is `@hono/node-server`, proven. Rolldown speeds *builds*, not requests.
3. **RSC is mid-churn.** brillout (vike) and nitedani are reworking RSC onto the official `@vitejs/plugin-rsc`; bundling a Vite 8 migration into that adds noise. See [[project_rsc_spike_findings]].
4. **Plugin-version cliff.** plugin-react@6 forces Vite 8, so we can't half-step the React path — it's all-or-nothing per renderer.

## Triggers to pick it up

- We want plugin-react 6 (or another plugin major that's Vite-8-only).
- Vite 7 maintenance lapses / a security fix lands only on 8.
- The RSC rewrite onto official `@vitejs/plugin-rsc` stabilizes (good moment to land both).

## Migration plan (when scheduled)

Own branch + PR. Roughly:

1. **Bump core**: `vite 7→8`, `@vitejs/plugin-react 4→6`, `@vitejs/plugin-vue 5→6`, `vite-plugin-solid` latest, `@vitejs/plugin-rsc` latest. Update root `pnpm.overrides`.
2. **`@rudderjs/vite`**: validate the routes scanner, dev re-boot/HMR invalidation, and `noExternal`/`watch` paths against rolldown. This is the highest-risk package.
3. **Build pipeline**: confirm `@rudderjs/view` SSR + `server-hono` prod build (`dist/server/index.mjs`) still boot and serve.
4. **Renderers**: dev + prod render for react/vue/solid/vanilla.
5. **RSC**: re-run `playground-rsc` dev + e2e; **re-check whether the `virtual:client-references` regression even exists** under rolldown's optimizer (it may not — rolldown ≠ esbuild; this is the open experiment from the vike#3290 thread).
6. **Scaffolder**: regenerate a fresh app and boot it (the scaffolder E2E matrix path).

## Validation gates

Gate the PR on the existing **CI portability matrix** ([[project_ci_portability_matrix_shipped]]) — react/vue/solid + scaffolder E2E ([[project_scaffolder_e2e_coverage]]) + the RSC prod e2e. This change is exactly what that matrix exists to catch.

## Open questions / unknowns

- vike's peer range *accepts* Vite 8, but rudder has **not** been run on it — needs validation, not assumption.
- Does the rolldown optimizer resolve Vite-virtual ids (so RSC's `virtual:client-references` pre-bundles cleanly), making our `patches/vike@0.4.257.patch` skip-workaround unnecessary on Vite 8? Tied to [[project_vike_patch_dont_unpatch]]. **Cheap bounded experiment** — worth running before committing to the full migration.
- `tsdown>rolldown` is already pinned (`1.0.0-beta.8`) for our package builds; check for rolldown-version conflicts with Vite 8's bundled rolldown.

## Links

- vike#3290 esbuild/optimizeDeps thread: https://github.com/vikejs/vike/issues/3290
- Related plans: `2026-05-23-vike-react-rsc-integration.md`, `2026-05-24-publish-vike-react-rsc-fork.md`
