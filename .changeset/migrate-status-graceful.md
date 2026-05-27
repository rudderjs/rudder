---
"@rudderjs/orm": patch
---

fix(migrate:status): report cleanly instead of crashing with a JS stack trace

`prisma migrate status` exits non-zero for *informational* states (drift, pending migrations, or a `db:push`-managed DB with no migrations dir) — not just hard failures. The migrate command wrapper threw on any non-zero exit, so `rudder migrate:status` on a valid `db:push` project (the scaffolder/dev default) dumped a JS stack trace + `Error: Migration command failed (exit 1)`. `migrate:status` now tolerates the non-zero exit: it surfaces Prisma's own output and preserves the exit code (so CI can still gate on drift) without throwing. The other migrate commands still throw on failure.
