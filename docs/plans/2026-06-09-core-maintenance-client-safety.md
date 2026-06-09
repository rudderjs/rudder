# `@rudderjs/core` — `maintenance.js` is client-unsafe (crashes browser bundles)

**Status:** proposed (2026-06-09)
**Packages:** `@rudderjs/core`
**Driver:** pilotiq-pro e2e regression — bumping `@rudderjs/core` 1.10 → 1.11/1.12 turned the entire Playwright suite red (23/23). Root-caused to a client-bundle crash; worked around app-side with a `node:path`/`node:fs` client shim (pilotiq-pro `playground/vite.config.ts`). This plan is the proper upstream fix so the shim can be removed.

---

## Problem

`@rudderjs/core@1.11+` added `dist/maintenance.js` (Laravel-style `down`/`up`/`maintenanceMiddleware`). It is **Node-only** — it statically imports `node:fs` + `node:path` and runs a **module-top-level `path.join`**:

```js
// dist/maintenance.js
import fs from 'node:fs';
import path from 'node:path';
const DOWN_FILE = path.join('storage', 'framework', 'down');   // ← runs at module eval
```

…and the **main entry re-exports it statically**:

```js
// dist/index.js:32
export { isDownForMaintenance, maintenanceData, down, up, maintenanceMiddleware, MAINTENANCE_BYPASS_COOKIE } from './maintenance.js';
```

So **any client bundle that imports `@rudderjs/core`'s main entry — directly or transitively — eagerly evaluates `maintenance.js` in the browser**, where bundlers externalize `node:path` to a throwing stub:

```
Module "node:path" has been externalized for browser compatibility.
Cannot access "node:path.join" in client code.
  at @rudderjs/core/dist/maintenance.js:19
```

That throw happens at module-eval time, so it kills the whole SPA before hydration — no React mount, no editors, no app. In pilotiq-pro this was reached transitively (e.g. `@rudderjs/localization` and app `ServiceProvider`s import `@rudderjs/core`), and every browser-driven test failed because the admin app never booted.

### Self-contradiction in the source

`maintenance.js`'s own header comment already states the intended contract — which `index.js` violates:

> **Node-only.** This module statically imports `node:fs`/`node:path`, so it is exported only from `@rudderjs/core`'s main entry, **never from `@rudderjs/core/client` … so the client bundle never evaluates it.** `app-builder` reaches it via a lazy `await import('./maintenance.js')` inside `_createHandler` (server-only).

The comment assumes "main entry = server-only," but the main entry (`index.js`) is what client code resolves `@rudderjs/core` to. The lazy `await import('./maintenance.js')` in `app-builder` is correct; the **static `export … from './maintenance.js'` in `index.js` is the bug** — it forces eager evaluation for every importer of the main entry, client included.

## Impact

- Any consumer whose **client** bundle transitively imports `@rudderjs/core` (very common — localization, providers, helpers) gets a hard SPA crash on bundlers that stub `node:*` for the browser (Vite, esbuild, webpack with node polyfills off). 1.10 was safe (no `maintenance.js`); 1.11+ regressed it.
- Confirmed in pilotiq-pro; current mitigation is a client-only Vite plugin shimming `node:path`/`node:fs` to no-ops — a band-aid we want to delete.

## Fix options (pick one or both)

1. **Defer the top-level `node:*` access (smallest).** Move `DOWN_FILE`'s `path.join` (and any other module-top-level `fs`/`path` calls) **inside the functions** (`downPath(cwd)` already takes `cwd` and joins lazily). With no `node:*` touched at module-eval, `maintenance.js` evaluates harmlessly even if it lands in a client graph (its functions are never called there). Lowest-risk; keeps the current export surface.

2. **Don't re-export the Node-only module from the client-facing entry (cleanest).** Drop the static `export … from './maintenance.js'` from `index.js`; expose `down`/`up`/`maintenanceMiddleware` from a server-only subpath (e.g. `@rudderjs/core/maintenance`) or keep them solely behind `app-builder`'s existing lazy `await import('./maintenance.js')`. This honors the module's own documented contract and guarantees client bundles can't pull it in.

Recommend **both**: (1) makes `maintenance.js` intrinsically client-eval-safe (defense in depth), (2) keeps the Node-only surface off the main entry. Either alone fixes the crash.

## Verification

- A minimal client bundle that imports `@rudderjs/core` (or a transitive consumer like `@rudderjs/localization`) builds + evaluates in a browser with **no `node:path`/`node:fs` access errors**.
- Maintenance mode still works server-side (`down`/`up`/`maintenanceMiddleware`, the `storage/framework/down` flag, bypass cookie) — unchanged behavior in `app-builder`'s pipeline.
- Downstream: pilotiq-pro removes its `node:path`/`node:fs` client shim from `playground/vite.config.ts` and the e2e suite stays green.

## References

- `@rudderjs/core@1.12.0/dist/maintenance.js` — top-level `const DOWN_FILE = path.join(...)`; `import fs/path from 'node:*'`.
- `@rudderjs/core@1.12.0/dist/index.js:32` — static `export { …, down, up, maintenanceMiddleware, … } from './maintenance.js'`.
- Mitigation reference: pilotiq-pro `playground/vite.config.ts` `clientNodeBuiltinShims()` (PR #28).
