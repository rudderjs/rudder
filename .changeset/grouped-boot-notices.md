---
"@rudderjs/core": minor
"@rudderjs/ai": patch
"@rudderjs/auth": patch
---

Group non-fatal boot-time warnings into one clean block at the end of dev startup. Previously each provider `console.warn`-ed inline as it booted, scattering messages (AI apiKey-skip, auth dev-secret) between the boot sequence and the provider tree with inconsistent prefixes (`[RudderJS AI]`, `[@rudderjs/auth]`, …). `@rudderjs/core` now exposes `bootNotice(scope, message)` — providers record notices during `boot()` and the framework flushes them as a grouped, scope-aligned `⚠ N notices` block after the provider tree and before `ready`, so the dev boot reads banner → tree → notices → ready. `@rudderjs/ai` (apiKey-empty skips) and `@rudderjs/auth` (dev password secret) now route through it. Notices are still printed in production so warnings aren't lost, and a fully-configured app boots with no notices block.
