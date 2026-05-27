---
"@rudderjs/orm-prisma": patch
---

fix(doctor): `doctor --deep` db-connect check works on Prisma 7 (was a raw unhandled exception)

The `orm-prisma:db-connect` runtime check spawned a bare `new PrismaClient()`, which Prisma 7's `prisma-client` generator rejects (it requires the driver adapter the app wires) — and the construction was outside the check's try/catch, so it surfaced as a raw *unhandled exception* on `doctor --deep` for any app on Prisma 7 + driver adapters (the framework's current default). The check now reuses the app's already-constructed client (cached on `globalThis` by the adapter during the `--deep` boot, built with the correct adapter/options) and runs `SELECT 1` on it; it no longer disconnects the client (it's the app's shared pool) and degrades to a clean `warn` when no Prisma client was constructed. Verified on the playground (Prisma 7.4.2): the check now reports the connection instead of crashing.
