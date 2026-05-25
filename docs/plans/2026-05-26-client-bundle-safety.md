# Client-bundle safety: `@rudderjs/core/client` + CI smoke gate

**Filed:** 2026-05-26 · **Status:** core + gate DONE (this PR) · **Origin:** generalizes the `@rudderjs/orm@1.12.5` fix ([2026-05-25 plan](./2026-05-25-orm-top-level-process-env-breaks-client-bundles.md)) · **Affects:** `@rudderjs/core`, CI

## Problem

Several `@rudderjs/*` packages are legitimately bundled into the **browser** by consumers — a `Model` reachable from client code, or `app`/`Env` imported from a module that's also client-bundled. Such entries must evaluate in the browser without pulling Node. Two real regressions hit this:

1. **orm 1.12.4** — a top-level `process.env` read → `process is not defined` at eval → React never hydrated → SPA nav died. Fixed in 1.12.5.
2. **`@rudderjs/core`** — the main `.` entry re-exports `@rudderjs/console` (whose `@clack/*` dep *statically* imports `node:process`/`node:fs`) plus Node-only modules (`default-providers` → `node:fs`, `events-fake` → `node:assert`, support's `resolveOptionalPeer`/`dump`/`dd`). pilotiq needed a client stub to use `app`/`Env` from client-reachable code.

Neither was caught by CI — there was **no client-bundle gate**.

## Shipped (this PR)

- **`@rudderjs/core/client`** (`packages/core/src/client.ts` + `./client` export) — a curated, node-free surface: `app`, `resolve`, `Application`/`RudderJS`, `Container` + DI, `ServiceProvider`, events, validation (`z`, `FormRequest`, `ValidationError`), exceptions, `Env`/`env`/`config`/`Collection` + utils, contracts types. Omits the console re-export, `defaultProviders`/provider-registry, `EventFake`, and support's `resolveOptionalPeer`/`dump`/`dd`. Main `.` entry unchanged (no breaking change). Changeset: core **minor**.
- **`Client Bundle Smoke` CI gate** (`scripts/client-bundle-smoke.mjs`, `pnpm test:client-bundle`, wired into `ci.yml`): `export * from` each client-reachable entry through esbuild (`platform:browser`, `treeShaking:false` to model Vite optimizeDeps), with `node:*` stubbed to throw at eval, then evaluates the bundle in a `vm` sandbox with **no `process`**. Fails on top-level `process` reads (orm-class) and static `node:` imports (@clack-class); tolerates lazy `await import('node:x')`. Targets: `@rudderjs/orm`, `@rudderjs/core/client`. Verified it has teeth — `export * from '@rudderjs/core'` (main) fails the gate; both targets pass.

## How to extend

When a package becomes client-reachable, add it to `TARGETS` in `scripts/client-bundle-smoke.mjs`. Fix failures by guarding top-level `process` (`typeof process !== 'undefined'`) and keeping static `node:` / CLI chains out of the entry (lazy `await import` is fine).

## Follow-ups (open)

- **Tell pilotiq** they can drop the `@rudderjs/core` client stub and import from `@rudderjs/core/client` (once core minor is published).
- **Audit other client-reachable packages** against the gate before adding them as targets — likely candidates: anything a view/component imports (e.g. `@rudderjs/support` is already lazy-node-safe; `@rudderjs/contracts` is types-only). Add targets opportunistically, not speculatively.
- The main `@rudderjs/core` entry is still browser-hostile by design (back-compat). Not worth a breaking change; the `/client` subpath is the supported path.
