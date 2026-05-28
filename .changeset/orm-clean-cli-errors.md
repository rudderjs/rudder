---
"@rudderjs/orm": patch
---

ORM CLI commands (`db:push`, `migrate`, `make:migration`, `db:generate`) now fail with a clean error line instead of dumping a Node stack trace when the underlying tool exits non-zero. The subprocess (Prisma / drizzle-kit) already prints its own actionable message via inherited stdio (e.g. Prisma's "We found changes that cannot be executed…"), so `exec()` now throws a `CliError` — which the `rudder` CLI renders as a single red message + the original exit code — rather than a plain `Error` that surfaced as a stack trace. Found by dogfooding `db:push` against a schema-drifted dev database.
