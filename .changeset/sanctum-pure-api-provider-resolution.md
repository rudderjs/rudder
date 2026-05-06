---
'@rudderjs/sanctum': minor
'@rudderjs/auth': minor
---

Fix Sanctum's hardwiring to the session driver (T2/T7).

- `AuthManager.createProvider(name?)` is now public. With no `name`, it falls back to the default guard's configured provider; with a `name`, it resolves any provider in `auth.providers` independently of any guard. Pure-API apps can now use Sanctum without registering `@rudderjs/session` or a session guard.
- `SanctumServiceProvider.boot()` resolves the user provider through `manager.createProvider(config.provider)` instead of `manager.guard().provider`. The previous code instantiated a `SessionGuard` just to read its provider, which threw on any non-session default guard. The catch around `app.make('auth.manager')` now narrows to "binding not found" only — provider-resolution errors propagate verbatim instead of being rewritten to "No auth manager found".
- `SanctumConfig.provider?: string` overrides which entry in `auth.providers` Sanctum uses. Required for pure-API apps; optional in mixed (web + API) setups.
