---
'@rudderjs/queue': minor
---

feat: the native database queue reserves jobs with `FOR UPDATE SKIP LOCKED` (Postgres/MySQL). A worker whose top candidate is mid-reservation by another worker now takes the next runnable job immediately instead of blocking on the row lock and re-evaluating to zero rows — multi-worker pickup no longer serializes on the head-of-queue row. No-op on SQLite (its write transaction already serializes the reservation); reservation semantics are otherwise unchanged.
