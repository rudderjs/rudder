---
"@rudderjs/auth": patch
---

`PasswordBroker` now throws on construction when `auth.passwords.secret` is unset and `NODE_ENV === 'production'`. Previously it silently used a hardcoded fallback (`'password-reset'`), which made stored token hashes predictable across deployments. Dev and test still boot — they get a one-time `console.warn` and the hardcoded fallback.

Apps already setting `auth.passwords.secret` (typically derived from `APP_KEY`) are unaffected. Apps relying on the silent fallback in production must set the secret before upgrading.
