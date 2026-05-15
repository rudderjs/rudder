---
'@rudderjs/view': patch
'@rudderjs/server-hono': patch
---

First-render perf: prewarm `vike/server` during application bootstrap so its ~100 ms module-load cost no longer stalls the first user-visible request. `@rudderjs/view` now exposes `prewarmVikeServer()` (memoized lazy loader); `@rudderjs/server-hono` fires it as a module-load side-effect of its own index module — t≈0 in the cold-boot timeline — so by request-time the import is fully cached. On a fresh-scaffold minimal app, first-render drops from ~182 ms to ~96 ms (−47%); RudderJS now beats Next.js on first-render and lands within 20 ms of Nuxt. Trade-off: cold boot bumps ~86 ms (the load happens during boot now). Net spawn-to-first-content is the same; in production this is a clear win because cold-boot hides behind the load-balancer's health check while users always see the request time. Also adds env-gated `[perf]` request-lifecycle traces in both packages (enabled via `RUDDER_PERF_TRACE=1`; zero overhead when unset).
