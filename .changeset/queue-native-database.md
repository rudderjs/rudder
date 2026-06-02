---
"@rudderjs/queue": minor
"@rudderjs/orm": minor
"@rudderjs/contracts": minor
---

feat(queue): native database-backed queue driver (`@rudderjs/queue/native`)

A persistent, self-hosted queue driver backed by the native ORM engine — the
zero-infrastructure default tier, modeled on Laravel's `database` driver.
Selected with `driver: 'database'` in `config/queue.ts`; BullMQ and Inngest
remain the high-throughput / cloud tiers, unchanged.

- Jobs persist in a `jobs` table; exhausted jobs move to `failed_jobs`. Stub the
  migrations with `pnpm rudder queue:table`, then `pnpm rudder migrate`.
- For apps on a non-native ORM (Prisma/Drizzle), set `engine` + `url` on the
  queue connection to give the queue its own dedicated SQLite/Postgres/MySQL
  store — its `jobs` / `failed_jobs` tables are created automatically on first
  use (its private DB, no migration step). Omit `engine` to run against the app's
  native ORM connection instead.
- `pnpm rudder queue:work [queues] [--once --sleep --tries --backoff --timeout
  --max-jobs --stop-when-empty]` — a polling worker with comma-separated queue
  **priority** order, retries with backoff, and `retry_after` reclaim of jobs
  abandoned by a crashed worker. Atomic reservation via a transaction +
  `lockForUpdate()` (`FOR UPDATE` on Postgres/MySQL; a serializing write
  transaction on SQLite — run a single worker on SQLite).
- `queue:status` / `queue:clear` / `queue:failed` / `queue:retry` all work
  against the new driver.

Supporting changes:

- `@rudderjs/orm` (native): new `QueryBuilder.lockForUpdate()` / `sharedLock()`
  — first-class pessimistic row locking (Laravel parity). The compiler emits the
  dialect's `FOR UPDATE` / `FOR SHARE` suffix, a no-op on SQLite.
- `@rudderjs/contracts`: `QueryBuilder` gains optional `lockForUpdate?()` /
  `sharedLock?()` (additive; adapters without row locking omit them).
- `@rudderjs/queue`: `executeJob` gains an opt-out `invokeFailedHook` flag so the
  database worker fires `failed()` exactly once, on terminal failure (Laravel
  parity); existing drivers are unaffected.

Deferred to a follow-up (same limits as the BullMQ driver today): chains,
batches, and closure dispatch.
