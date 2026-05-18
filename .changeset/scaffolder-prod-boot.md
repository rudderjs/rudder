---
'create-rudder-app': patch
---

Scaffolded `AuthController` now sources `PasswordBroker`'s `secret` from
`process.env.AUTH_SECRET` so a fresh `pnpm build && pnpm start` boots without
manual config in production. Caught by the new Phase 2 scaffolder E2E job.
