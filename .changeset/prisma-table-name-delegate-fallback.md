---
"@rudderjs/orm-prisma": minor
---

Resolve a model's `static table` against the Prisma client's runtime datamodel when it isn't a direct delegate name. Previously `static table` had to be the camelCase Prisma delegate name (`paddleCustomer`) because the adapter does `prisma[table]` — but on the native engine the same field is the literal SQL table name (`paddle_customers`), so a single package model couldn't run on both adapters. The adapter now falls back to `_runtimeDataModel.models` (present on every generated client since Prisma 5): the model whose `@@map` name (or, when unmapped, its own name) equals the requested table resolves to its delegate. Direct delegate-name lookups keep the historical fast path, so existing models are untouched. This unblocks shipping package models (cashier-paddle, and later passport/notification/etc.) with real SQL table names that work on the native engine AND Prisma.
