---
"@rudderjs/router": patch
---

fix(router): load node:crypto synchronously to remove a startup race in Url signing

`Url.sign()` / `Url.isValidSignature()` / `ValidateSignature()` used a
fire-and-forget `import('node:crypto')`. If signing fired before that microtask
resolved (a handler on the very first request, or a bootstrap hook right after
`router.mount()`), `node:crypto` was still unloaded and the call threw a
misleading `[Rudder Router] node:crypto not available`. The module is now
resolved synchronously via `process.getBuiltinModule('node:crypto')` on first
use, so the first call always works. Still client-safe: no static `node:`
import, and the lookup is guarded by the `process` feature check.
