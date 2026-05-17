---
'@rudderjs/core': patch
'@rudderjs/schedule': patch
'@rudderjs/log': patch
'@rudderjs/queue': patch
---

Route 5 cross-bundle singletons through `globalThis` so duplicate bundles of these packages share state. Defensive sweep of the same "module-scoped state ≠ bundle-split-survival" pattern that produced #498 / #500–#506 (static-state registries) and #507 (router) and #514 (mcp metadata symbols).

| Singleton | Package | Global key | Risk if unfixed |
|---|---|---|---|
| `container` | `@rudderjs/core` | `__rudderjs_core_container__` | Defensive — only `Application` imports today, but a direct cross-bundle import would split |
| `dispatcher` | `@rudderjs/core` | `__rudderjs_core_dispatcher__` | Multiple packages re-export `dispatch()` — events fired from one bundle don't reach listeners in another |
| `schedule` | `@rudderjs/schedule` | `__rudderjs_schedule_singleton__` | User registers tasks in `routes/console.ts`; cron runner + telescope's ScheduleCollector read from a different bundle's Scheduler → no jobs |
| `customDrivers` | `@rudderjs/log` | `__rudderjs_log_custom_drivers__` | Public `extendLog('sentry', ...)` API — write to one bundle's Map, read from another → "Unknown driver" on every channel |
| `_chainStates` | `@rudderjs/queue` | `__rudderjs_queue_chain_states__` | Chain.dispatch() stamps state on each job; worker reads via `getChainState(this)` — split = state silently lost |

No public API change. Same shape as `groupMiddlewareStore` (long-standing globalThis precedent in `@rudderjs/core`).

Out-of-scope: `queue/_locks` (documented process-local fallback — "use cache for production"), `server-hono/perf-boundaries` (single-module scope, no cross-bundle access).
