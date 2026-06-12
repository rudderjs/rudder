---
"@rudderjs/core": patch
---

Fix ORM adapter selection when both `@rudderjs/orm-prisma` and `@rudderjs/orm-drizzle` are installed. `defaultProviders()` runs at module-eval time (before `Application.create()` binds the config repository), so `config('database.driver')` always read `undefined` and the framework silently fell back to "first installed wins", ignoring an explicit driver choice. Driver selection now reads the `DB_DRIVER` env var (available at discovery time), then `config('database.driver')` for callers that run after boot, then first-installed.

Also hardens two internal container edge cases: deferred-provider resolution now honors `scoped()` bindings on first resolve, and a stale missing-handler is cleared when a dev re-boot drops all deferred providers.
