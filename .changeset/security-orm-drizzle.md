---
"@rudderjs/orm-drizzle": minor
---

Require `drizzle-orm` `^0.45.2` (was `^0.38.0`) to clear a high-severity advisory in the 0.38–0.44 range, and pin `kysely` (drizzle's optional peer) to `^0.28.17` to clear its advisory. The adapter's drizzle imports (`sqliteTable`, `pgTable`, `mysqlTable`, `PgDialect`, `drizzle`, etc.) are unchanged across the bump — build, typecheck, and the full 105-test integration suite (better-sqlite3 + pglite) pass against 0.45.2.
