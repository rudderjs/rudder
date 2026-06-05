---
"create-rudder": minor
---

Native engine pg/mysql scaffolding (7.9). The Database driver prompt (SQLite / PostgreSQL / MySQL) is now asked for the Native engine too instead of pinning SQLite — the choice wires through to the driver dependency (`postgres` / `mysql2`), `config/database.ts` (native driver names `pg` / `mysql`), `.env` `DATABASE_URL`, and the "Is your DB running now?" confirm (the auto-cascade's `rudder migrate` now honors `--db-ready` on pg/mysql). Non-interactive: `--orm=native --db=postgresql|mysql` works in both the recipe and legacy flag shapes.

Behavior change: `--db=postgresql|mysql` without `--orm` now stays on the native default engine. Before this release it implied `--orm=prisma` (a back-compat fallback from when native was SQLite-only) — scripts that relied on that must pass `--orm=prisma` explicitly.
