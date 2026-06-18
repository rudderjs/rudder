---
"@rudderjs/sanctum": minor
---

Add `Sanctum.actingAs(user, abilities?, guard?)` testing helper, mirroring Laravel's `Sanctum::actingAs()`. It authenticates a test as a user without seeding a token row or crafting a Bearer header by installing a `TransientToken` (also exported) that `SanctumMiddleware` and `RequireToken` pick up in place of header validation. Scoped abilities exercise 403 paths; `actingAsGuest()` clears the state. Test-only: ignored under `NODE_ENV=production`.
