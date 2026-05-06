---
'@rudderjs/passport': patch
---

Token models are now `MassPrunable` — `pnpm rudder model:prune` reaps
expired/revoked rows automatically.

`AuthCode`, `DeviceCode`, `AccessToken`, and `RefreshToken` each define
`static prunable()` and `static pruneMode = 'mass'`. The predicates mirror
`passport:purge` exactly (`expiresAt < now OR revoked = true` for tokens,
`expiresAt < now` for codes), so the two commands target the same rows and
running them back-to-back is idempotent.

`PassportProvider.boot()` eagerly registers the four classes with
`ModelRegistry`, so the prune scheduler sees them on day-1 fresh apps —
without this, the registry would only learn about the models lazily on
the first oauth flow, silently skipping passport rows on a `model:prune`
run from an inactive install.
