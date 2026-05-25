---
"@rudderjs/core": patch
---

Dev HMR: drain in-flight renders before a re-boot mutates shared state (quiesce barrier).

#652 single-flighted re-boots and gated each request's *start* on the boot promise, but a request that already passed the gate could be **mid-render** when the next re-boot stomped process-shared state in place (`router.reset()`, provider `boot()`s repopulating registries). That render observed a half-booted graph — e.g. a resource list whose schema was missing its table element, so the data query was never issued and the page rendered its empty-state with no error (the "wedged empty table after a dev edit" residual).

`_bootstrapProviders()` now awaits any in-flight render to finish (bounded by a 5s timeout so a hung render can't wedge the reload) before it resets/re-registers; `handleRequest()` marks a render as in-flight only while the handler runs. New requests already wait for the re-boot via the existing gate. Dev-only and a no-op in production (single boot, nothing in flight, no resets).
