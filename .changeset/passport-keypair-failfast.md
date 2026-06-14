---
"@rudderjs/passport": patch
---

Add an opt-in `config('passport').requireKeys` that fails the boot when no OAuth signing keypair is reachable (no `PASSPORT_PRIVATE_KEY`/`PASSPORT_PUBLIC_KEY` env vars and nothing on disk under `keyPath`). Previously a missing keypair only warned at boot and then 500'd every `/oauth/*` request with a generic ENOENT deep inside `Passport.keys()`. With `requireKeys: true`, a deployment that depends on OAuth fails fast (caught at deploy time) instead. The default stays warn-and-continue — passport is often installed without OAuth being actively used (it ships with the framework demo), and `APP_ENV` defaults to `production`, so keying the throw off production-detection alone would break apps that pull passport in transitively without configuring keys.
