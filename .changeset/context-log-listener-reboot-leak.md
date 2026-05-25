---
"@rudderjs/context": patch
---

Register the `@rudderjs/log` integration listener only once per process. `ContextProvider.boot()` re-runs on every dev HMR re-boot and called `Log.listen()` each time, which appends to a globalThis-backed listener array with no dedup — so a duplicate context-merge listener accumulated per edit (unbounded across a dev session; every log entry re-ran the merge N times). Now guarded with a globalThis flag so the listener is registered once. No-op in production (single boot).
