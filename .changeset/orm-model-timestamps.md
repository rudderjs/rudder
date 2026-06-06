---
"@rudderjs/orm": minor
"@rudderjs/database": minor
"@rudderjs/contracts": minor
---

Automatic `createdAt`/`updatedAt` stamping (Laravel's `$timestamps`, `static timestamps = true` by default). On the native engine, `Model.create()` now stamps both columns and `update()`/`save()` bumps `updatedAt` — previously they were written NULL unless the migration added DB defaults. Stamping is schema-gated via the new optional `OrmAdapter.tableColumns()` capability (implemented by `NativeAdapter` with cached introspection): tables without the columns are silently skipped, and Prisma/Drizzle are untouched (their schemas own timestamp defaults). Opt out per model with `static timestamps = false`.
