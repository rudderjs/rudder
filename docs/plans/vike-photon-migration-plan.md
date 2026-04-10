# Plan: Migrate vike-photon to +server.ts

**Status**: Done
**Date**: 2026-04-10
**Scope**: `@rudderjs/server-hono`, `@rudderjs/vite`, `packages/core`, `playground`, `playground-multi`, docs

> `create-rudderjs-app` is out of scope — it needs a broader refresh.

---

## Problem

`vike-photon` is deprecated. Running any playground prints:

```
[vike][Warning] vike-photon is deprecated, see https://vike.dev/migration/server
```

The current wiring is over-complex:

1. `pages/+config.ts` imports `vike-photon/config`, sets `photon: { server: 'bootstrap/app.ts' }`
2. `@rudderjs/server-hono` dynamically imports `@photonjs/hono` for `apply()` + `serve()`
3. `@rudderjs/vite` has workarounds for photon's `httpServer` patching (monkey-patches `http.createServer`)
4. `@rudderjs/vite` marks `@rudderjs/server-hono` as `ssr.noExternal` because `@photonjs/hono` uses virtual module imports (`virtual:photon:get-middlewares:*`) that break when loaded natively

## Target

Replace `vike-photon` + `@photonjs/hono` with Vike's native `+server.ts` + `@vikejs/hono`.

New model:

```ts
// +server.ts (project root)
import { Hono } from 'hono'
import vike from '@vikejs/hono'
import type { Server } from 'vike/types'

const app = new Hono()
vike(app)

export default {
  fetch: app.fetch,
} satisfies Server
```

## What simplifies

- **`@rudderjs/server-hono`**: `createFetchHandler()` drops `@photonjs/hono` entirely. No more `apply()` + `serve()` dance. The adapter just builds a Hono app; the `+server.ts` file calls `vike(app)` and exports `fetch`.
- **`@rudderjs/vite`**: The `rudderjs:ws` plugin's monkey-patch comment about "vike-photon patches vite.httpServer" may simplify. The `ssr.noExternal` for `@rudderjs/server-hono` (needed because of `@photonjs/hono` virtual imports) can likely be removed.
- **`pages/+config.ts`**: Drops `vike-photon/config` and `photon: {}` block entirely. Only extends the UI renderer(s).
- **No more `photon` noise suppression** in `packages/core/src/application.ts` (`_suppressVikeNoise`).

## Phases

### Phase 1: Spike — verify @vikejs/hono works

1. Install `@vikejs/hono` in playground
2. Create a minimal `+server.ts` that imports `bootstrap/app.ts`, builds the Hono app, calls `vike(app)`, exports `{ fetch: app.fetch }`
3. Remove `vike-photon/config` from `pages/+config.ts`
4. Verify: playground boots, SSR works, API routes work, WebSocket upgrade works
5. If WS breaks, check whether the `http.createServer` monkey-patch still fires or needs adjustment

### Phase 2: Update @rudderjs/server-hono

**Decision: framework owns the wiring.** `createFetchHandler()` stays but calls `vike(app)` internally and returns `{ fetch }` satisfying `Server`. The user's `+server.ts` is a one-liner:

```ts
// +server.ts — user-facing
import app from './bootstrap/app.js'
export default app.server()
```

This keeps Hono/vike details out of user code. If the Vike API changes again, only `@rudderjs/server-hono` needs updating.

Steps:
1. Replace `@photonjs/hono` dependency with `@vikejs/hono` in `package.json`
2. Refactor `createFetchHandler()`:
   - Remove `import('@photonjs/hono')` dynamic import
   - Import `vike` from `@vikejs/hono`
   - Build the Hono app (CORS, error handler, adapter setup, logging wrapper)
   - Call `vike(app)` to attach Vike SSR middleware
   - Return `{ fetch: app.fetch } satisfies Server` (or the logging-wrapped fetch)
3. Expose a clean `app.server()` method on the Application that calls `createFetchHandler()` — this is what `+server.ts` imports
4. Update or remove the WS `http.createServer` monkey-patch at the top of the file if no longer needed

### Phase 3: Update @rudderjs/vite

1. Remove `@rudderjs/server-hono` from `SSR_NO_EXTERNALS` if the virtual module issue is gone (no more `@photonjs/hono`)
2. Update the `rudderjs:ws` plugin — check if the httpServer patching comment/workaround still applies
3. Remove photon-specific comments

### Phase 4: Update packages/core

1. `application.ts` `_suppressVikeNoise()`: remove the `"Server running at "` photon suppression line if no longer needed

### Phase 5: Update playground + playground-multi

1. `pages/+config.ts` — remove `vike-photon/config`, remove `photon: {}` block
2. Add `+server.ts` at project root
3. `package.json` — replace `vike-photon` with `@vikejs/hono`
4. Verify both playgrounds boot clean (no deprecation warning)

### Phase 6: Update docs

Files referencing vike-photon:
- `docs/guide/installation.md`
- `docs/guide/frontend-pages.md`
- `docs/guide/directory-structure.md`
- `docs/integrations/deployment.md`
- `docs/packages/core/index.md`
- `docs/claude/create-app.md`

Update all to show the `+server.ts` pattern.

### Phase 7: Update CLAUDE.md + Architecture.md

Update any references to photon wiring in the top-level docs.

---

## Dependency changes

| Package | Remove | Add |
|---|---|---|
| `@rudderjs/server-hono` | `@photonjs/hono` | `@vikejs/hono` |
| `playground` | `vike-photon` | `@vikejs/hono` |
| `playground-multi` | `vike-photon` | `@vikejs/hono` |

## Files touched (estimated)

| File | Change |
|---|---|
| `packages/server-hono/src/index.ts` | Refactor `createFetchHandler()`, remove photon imports |
| `packages/server-hono/package.json` | Swap `@photonjs/hono` for `@vikejs/hono` |
| `packages/vite/src/index.ts` | Remove photon workarounds, simplify `SSR_NO_EXTERNALS` |
| `packages/core/src/application.ts` | Clean up `_suppressVikeNoise()` |
| `playground/pages/+config.ts` | Remove photon config |
| `playground/+server.ts` | **New** — Hono + vike wiring |
| `playground/package.json` | Swap `vike-photon` for `@vikejs/hono` |
| `playground-multi/pages/+config.ts` | Remove photon config |
| `playground-multi/+server.ts` | **New** |
| `playground-multi/package.json` | Swap deps |
| 6 docs files | Update examples to `+server.ts` pattern |

## Resolved decisions

- **`createFetchHandler()` API**: Keep it — framework owns the wiring. User's `+server.ts` is `export default app.server()`. Hono/vike stay internal.

## Open questions

1. **Where does `+server.ts` live?** Vike docs show project root. Confirm this works with our `playground/` structure.
2. **WebSocket upgrade**: Does the `http.createServer` monkey-patch still work with `@vikejs/hono`, or does the new server API provide a cleaner hook?
3. **vike version**: Currently `0.4.255`. Check if `@vikejs/hono` requires a newer vike version.
