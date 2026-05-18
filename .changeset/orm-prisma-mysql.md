---
'@rudderjs/orm-prisma': minor
---

Add MySQL / MariaDB support via `@prisma/adapter-mariadb`.

The `driver` config option already declared `'mysql'` as a valid value, but the adapter factory only handled `'postgresql'`, `'libsql'`, and `'sqlite'` (default) — every other driver value fell through to better-sqlite3 silently. Real apps that wanted MySQL would silently try to open a SQLite file and fail with a confusing "Cannot open database because the directory does not exist" error.

This adds the missing branch. When `driver === 'mysql'` + a URL is provided, the adapter:

1. Parses the standard `mysql://user:pass@host:port/db` URL into the component parts (`@prisma/adapter-mariadb`'s constructor takes parsed connection options, not a URL — the underlying `mariadb` npm client doesn't accept connection strings directly).
2. Constructs a `PrismaMariaDb` adapter and passes it to the new PrismaClient.

The MariaDB adapter is wire-compatible with both MySQL 5.7+ and MariaDB 10.x, so a single driver covers both engines.

## Added to optional dependencies

- `mariadb@^3.0.0`
- `@prisma/adapter-mariadb@^7.0.0`

Both are optional — installed only when the app actually uses `driver: 'mysql'`.

## Why this matters

Forge (the most common Laravel-ecosystem hosting choice, and one RudderJS borrows heavily from in design) provisions MySQL by default on every new server. Without this branch, every Forge deploy of a RudderJS app forces either:
- Manually installing Postgres alongside MySQL and ignoring the provisioned DB, or
- Switching to libsql (Turso), or
- Falling back to SQLite-on-disk

Now the Forge default just works. Tested end-to-end on `pilotiq-io` against MySQL 8.0 (DBngin local) and MySQL 8.4 (Forge production).
