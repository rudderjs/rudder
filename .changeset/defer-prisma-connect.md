---
'@rudderjs/orm-prisma': patch
---

`DatabaseProvider.boot()` no longer calls Prisma's `$connect()` eagerly. The client connects lazily on first query — Prisma's documented behavior — saving ~20–40 ms cold boot.

**Behavior change:** a database-down deploy now surfaces on the first user query instead of at boot. The HTTP server starts and accepts connections regardless of database availability. Apps that want fail-fast at boot can call `await app.make('db').connect()` from an `AppServiceProvider.boot()` hook.

No API change. No code change required in apps.
