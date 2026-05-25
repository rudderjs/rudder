# `@rudderjs/orm` reads `process.env` at module top-level → crashes browser bundles

**Filed:** 2026-05-25 · **Reporter:** pilotiq · **Severity:** high (breaks any client that bundles a Model) · **Affects:** `@rudderjs/orm@1.12.4` (regression vs `1.12.0`)

**Status (2026-05-25): orm fix DONE** — both eval-time and the `morphTo` `NODE_ENV` reads guarded with `typeof process !== 'undefined'` on branch `fix/orm-top-level-process-env` (changeset = orm patch; 427 tests green). The `@rudderjs/core` client-hostile tail (bottom section) is the **remaining open follow-up**.

## Symptom

In a browser bundle that includes any ORM `Model`, the page throws at module eval:

```
Uncaught (in promise) ReferenceError: process is not defined
    at index.ts:126:19
    (@rudderjs/orm/src/index.ts)
```

React never hydrates, so in a Vike/SPA app the client-side router never attaches and **every navigation falls back to a full page reload**. Discovered in pilotiq: the admin panel's `Model`s are reachable from the client bundle, so the whole panel silently lost SPA navigation after bumping orm `1.12.0 → 1.12.4`.

## Root cause

`packages/orm/src/index.ts:126`:

```ts
// ─── RUDDER_ORM_TRACE — dev diagnostic for the HMR re-boot wedge ───
const _ormTrace = process.env['RUDDER_ORM_TRACE'] === '1'   // ← top-level, unguarded
```

This is a **module-top-level** read of the Node `process` global. It was added as a dev diagnostic during the HMR re-boot wedge investigation. It runs the moment the module is evaluated — including in the browser, where `process` is undefined.

Why orm legitimately ends up in a client bundle: consumers define models as classes that `extends Model` and use orm decorators (`@column`, relations, etc.). The class definition must be **evaluated** wherever the class is referenced. Admin/UI frameworks (pilotiq) reference Model classes from code that is also bundled for the browser (schema/registry modules), so the orm entry module is eval'd client-side even though no query ever runs there. orm has historically been client-safe (its only runtime dep was `@rudderjs/contracts`), so consumers reasonably bundle it.

`1.12.4` also newly added `@rudderjs/console` to `dependencies`. The main `dist/index.js` does **not** import it (only the `commands/*` CLI subpaths do), so it is not currently part of the client crash — but it makes orm's main entry one refactor away from dragging the `@clack/prompts` CLI chain into client bundles. Worth keeping the main entry free of console/CLI imports.

## Fix (small) — ✅ DONE

Guard the top-level read so it is inert when `process` is absent:

```ts
const _ormTrace =
  typeof process !== 'undefined' && process.env?.['RUDDER_ORM_TRACE'] === '1'
```

This is the same `typeof process !== 'undefined'` guard already used elsewhere in the framework for env reads. Any other module-top-level `process` / `node:*` access in orm's main entry (`dist/index.js`) should get the same treatment — only the `commands/*` (CLI) subpaths may assume Node.

**Shipped:** `index.ts:126` (eval-time, the actual crash) **and** `index.ts:2064` (the `morphTo` duplicate-discriminator `NODE_ENV` dev-check — runtime, not eval-time, so not the reported crash, but guarded in the same pass for full client-safety). Verified: orm typecheck + build clean, 427/427 tests pass, `dist/index.js` carries the guard at both sites. No other top-level `process` / `node:*` reads exist in the orm main entry (only test files + `commands/*`).

## Acceptance

- `const _ormTrace = …` no longer references a bare `process` at eval time (esbuild/rollup can fold it under `typeof process` for browser targets).
- A trivial browser bundle of `import { Model } from '@rudderjs/orm'` evaluates without `process is not defined`.
- `RUDDER_ORM_TRACE=1` still enables tracing under Node (server) unchanged.
- `@rudderjs/orm`'s main entry imports no `@rudderjs/console` / `node:*` (CLI stays in `commands/*`).

## Consumer workaround (already shipped in pilotiq)

`playground/vite.config.ts` defines `process.env.RUDDER_ORM_TRACE` → `undefined` (top-level + `optimizeDeps.esbuildOptions`) to fold the read to a literal, plus a client-only stub for `@rudderjs/core` (its main entry eval-references `process`/`node:fs` and re-exports the `@clack` chain). The orm guard above lets consumers drop the orm-specific define.

---

### Related: `@rudderjs/core` main entry is client-hostile — ⬜ OPEN (follow-up)

Separate but adjacent: `@rudderjs/core`'s `.` entry re-exports `@rudderjs/console` (whose `await import('@clack/prompts')` pulls a CLI lib) and touches `process`/`node:fs` at eval. Consumers that need only `app` / `Env` from a client-reachable module have no client-safe import path (no granular subpath export). Consider either (a) a client-safe subpath that exposes the container/`app` accessor without the CLI/console re-exports, or (b) guarding the eval-time Node access. Lower priority than the orm fix (orm is the one that breaks by default).

**Verified (2026-05-25):** `core/index.ts:48-49` does re-export `{ rudder, Rudder, CommandRegistry, … }` from `@rudderjs/console` — so the `@clack` chain is dragged into any client bundle of `@rudderjs/core`. core's `exports` map has no client-safe subpath for `app`/`Env`. Confirmed real; **not yet fixed** — decide (a) subpath vs (b) guard when picked up. Tracked separately from the orm fix above.
