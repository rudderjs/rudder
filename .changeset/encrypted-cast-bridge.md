---
"@rudderjs/orm": patch
"@rudderjs/crypt": patch
---

Fix the `encrypted` / `encrypted:array` / `encrypted:object` model casts, which were permanently non-functional. The cast read `@rudderjs/crypt` via `require()`, but the package is ESM (`require` is undefined at runtime), so the call always threw and was swallowed — every encrypted cast raised "requires @rudderjs/crypt" even when crypt was installed and booted.

`@rudderjs/crypt` now publishes a synchronous encrypt/decrypt pair onto a globalThis registry (`__rudderjs_crypt_registry__`) whenever an encryption key is set, mirroring the bridge `@rudderjs/hash` already uses for the `hashed` cast. `@rudderjs/orm`'s cast reads that registry instead of importing the node-only crypt package, keeping the cast funnel client-bundle safe. Encrypted casts now round-trip correctly once `crypt()` is in your providers with `APP_KEY` set, and still throw a clear error when crypt is not booted.
