---
'@rudderjs/orm-drizzle': minor
'@rudderjs/orm-prisma': minor
---

Pessimistic locking parity across adapters. **Drizzle**: `lockForUpdate()` / `sharedLock()` are now real — rendered via the builder's `.for('update' | 'share')` on pg/mysql, no-op on sqlite (no row locks; matches the native engine), skipped on union'd queries (`FOR UPDATE` isn't valid on a set operation). **Prisma**: both methods now throw a clear error with a raw-transaction pointer instead of failing with a bare `is not a function` — a silent no-op would be a correctness bug for job-queue-style reservations.
