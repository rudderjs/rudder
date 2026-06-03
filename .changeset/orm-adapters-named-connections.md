---
"@rudderjs/orm-prisma": minor
"@rudderjs/orm-drizzle": minor
---

Named database connections on the Prisma and Drizzle adapters (multi-connection PR4a).

Both providers now register a lazy `ConnectionManager` factory for every connection they claim in `config/database.ts` (connections selecting another engine — e.g. `engine: 'native'` — are skipped), so `DB.connection('reporting')`, `Model.on('reporting')`, and per-model `static connection` work on Prisma/Drizzle apps. The default connection boots eagerly through the same manager entry, sharing one adapter/client with the Models. The dev-HMR client caches are per-connection now (keyed by connection name): each named connection holds its own client, a config edit disposes/reopens only that connection, and a second named connection no longer evicts the first. Prisma query events report the connection name. Read/write-split config (`read:`/`write:`) fails loudly at boot on both adapters — Prisma points at `@prisma/extension-read-replicas` (or the native engine); Drizzle points at the native engine, with real Drizzle routing planned as a follow-up.
