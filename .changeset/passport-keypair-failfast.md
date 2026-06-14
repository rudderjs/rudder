---
"@rudderjs/passport": patch
---

Fail the boot fast in production when no OAuth signing keypair is reachable. Previously a missing keypair (no `PASSPORT_PRIVATE_KEY`/`PASSPORT_PUBLIC_KEY` env vars and nothing on disk under the configured path) only emitted a boot warning and let the app start — then every `/oauth/*` request 500'd with a generic ENOENT deep inside `Passport.keys()`. An OAuth server with no keys can neither issue nor verify tokens, so `PassportProvider.boot()` now throws in production (caught at deploy time) and keeps the warn-and-continue behavior in development so a fresh checkout still boots before `rudder passport:keys` has been run.
