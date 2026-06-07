---
"@rudderjs/cashier-paddle": major
---

Support the native engine, and ship one model set that runs on both native and Prisma.

The 5 models' `static table` now carry the real SQL table names (`paddle_customers`, `paddle_subscriptions`, `paddle_subscription_items`, `paddle_transactions`, `paddle_webhook_logs`) instead of the Prisma camelCase delegate names, and set `static keyType = 'ulid'` so the ORM stamps a primary key on insert (the native engine has no `@default(cuid())`). A native migration fragment (`schema/native/`) is published by `vendor:publish --tag=cashier-schema` alongside the existing Prisma fragment.

**Breaking — Prisma apps must upgrade `@rudderjs/orm-prisma`** to a release with the SQL-table-name → delegate fallback. Without it, queries fail with `Prisma has no delegate for table "paddle_customers"`. With it, the SQL name resolves to the `paddleCustomer` delegate via the client's runtime datamodel — no schema or data change needed.

**Behavior change — new primary keys are ulid, not cuid.** Existing cuid rows are untouched (both are opaque strings in a `String @id` column); only rows created after upgrading get ulid ids. No migration required.
