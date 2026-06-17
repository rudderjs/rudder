---
"@rudderjs/sanctum": patch
---

`TokenGuard` now implements the `loginUsingId()` / `once()` / `onceUsingId()` members added to the `Guard` contract, as not-applicable no-ops (returning `false`), matching its existing stateless stubs for `attempt`/`login`/`logout`. Keeps `@rudderjs/sanctum` compiling against the updated `@rudderjs/auth` `Guard` interface.
