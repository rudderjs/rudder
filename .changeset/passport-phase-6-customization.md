---
'@rudderjs/passport': minor
---

Passport Phase 6 — customization hooks.

- `Passport.useClientModel()` / `useTokenModel()` / `useRefreshTokenModel()` / `useAuthCodeModel()` / `useDeviceCodeModel()` — swap in custom model classes (extend the base models to add columns or methods). Grants, routes, middleware, personal access tokens, and `passport:purge` all resolve models via the new `Passport.*Model()` getters.
- `Passport.authorizationView(fn)` — render a custom consent screen from `GET /oauth/authorize`. The hook receives `{ client, scopes, redirectUri, state?, codeChallenge?, codeChallengeMethod?, request }` and may return a `view(...)` response or any router-acceptable value. JSON remains the default when unset.
- `Passport.ignoreRoutes()` — short-circuits `registerPassportRoutes()` for manual wiring.
- `registerPassportRoutes(router, { except: ['authorize'|'token'|'revoke'|'scopes'|'device'] })` — skip specific route groups.

The `HasApiTokens` mixin type now accepts abstract base classes (such as `@rudderjs/orm`'s `Model`) and preserves the base's static methods, so `User extends HasApiTokens(Model)` composes cleanly.
