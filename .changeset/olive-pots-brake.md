---
"@rudderjs/boost": patch
"@rudderjs/orm": minor
---

Boost's DB-facing MCP tools now work on native-engine apps (the create-rudder default), not just Prisma:

- `db_schema` parses the committed native typed registry (`.rudder/types/models.d.ts`) first, falling back to `prisma/schema*` — same `{ models, raw }` shape on both engines, pure file-read posture (never boots the app).
- `db_query` spawns the new `rudder db:query` command (rides `DB.select`, so it returns real JSON rows on native, drizzle, AND prisma); `prisma db execute --stdin` remains only as a no-boot fallback for Prisma apps — it never returned rows for SELECTs. The query is never interpolated into a shell string (argv element / stdin).
- `model_list` walks `app/Models/**` recursively and resolves columns for `Model.for<'table'>()` models (which declare no fields in-file) from the native typed registry.

New `@rudderjs/orm` command: `rudder db:query "<SELECT …>"` — adapter-agnostic read-only SELECT printing `{ "rows": [...] }` as JSON (SELECT-only guard; BigInt-tolerant serialization).
