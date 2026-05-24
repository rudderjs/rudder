---
"@rudderjs/core": patch
"@rudderjs/vite": patch
---

Dev HMR: fix half-booted responses served during the re-bootstrap window.

Editing an `app/`, `routes/`, or `bootstrap/` file in dev triggers a full re-bootstrap. Requests that landed **while that async re-boot was still in flight** could be served against a half-booted app and render empty data — e.g. resource tables showing their empty-state ("No records yet") despite rows in the DB, while pure-config changes reflected fine. An editor's atomic-write / format-on-save made it reliable: the second write fired a *second* concurrent re-boot that interleaved its `router.reset()` / provider boot / `ModelRegistry.set()` with the first.

Three independent fixes close the window:

- **`@rudderjs/vite` — debounce the watcher.** A burst of `change` events (atomic-write / format-on-save double-fire) is now coalesced into a single re-boot, removing the reliable trigger. One save = one reload.
- **`@rudderjs/core` — single-flight the re-bootstrap.** Concurrent re-boots are chained via a promise on `globalThis.__rudderjs_boot__` and run strictly serially, so one boot never observes another mid-reset.
- **`@rudderjs/core` — gate request handling on boot completion.** `handleRequest()` blocks on the latest in-flight re-boot before invoking the route handler, so in-window requests wait for a fully-booted graph instead of observing half-booted shared state. In production (a single boot) and in the steady state this is a no-op.
