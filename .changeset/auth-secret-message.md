---
"@rudderjs/auth": patch
---

Fix the misleading PasswordBroker secret guidance. The dev boot notice, the production-throw error, and the `secret` JSDoc all told you to "Set `auth.passwords.secret` in your config (derived from APP_KEY)" — but `AuthConfig` has no `passwords` field (no such config path), and the canonical source is `AUTH_SECRET`, not `APP_KEY`. The secret is the `secret` option passed to `new PasswordBroker(repo, users, { secret })`, sourced from `AUTH_SECRET` in `.env` — which is what the scaffolder template uses and what `rudder doctor`'s `auth:secret` check validates. All three messages now point at the real mechanism.
