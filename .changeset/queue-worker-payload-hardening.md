---
"@rudderjs/queue": patch
---

Harden the database queue worker and payload serializer against malformed and hostile payloads.

- **The native `database` worker no longer crashes on a poison-pill row.** `_process` parsed and decoded the stored payload (`JSON.parse` + `decodePayload`) *before* its try/catch, and the `work()` poll loop had no catch. A row whose payload was not valid JSON (corruption, a row written straight into a shared `jobs` table, or SQL injection elsewhere) threw synchronously, killed the worker, and — because the row stayed reserved — re-crashed every worker that reclaimed it after `retry_after`, stalling the whole queue. The parse/decode now runs fail-closed: an unparseable row is dead-lettered to `failed_jobs` and removed, and the loop catches unexpected reservation/processing errors (e.g. `SQLITE_BUSY` when multiple worker processes contend on one SQLite file) and keeps running.
- **`encodePayload`/`decodePayload` now bound their recursion depth (256 levels).** Job props frequently carry user-controlled input; a pathologically deep value would otherwise stack-overflow `encodePayload` on dispatch (crashing the app server) or `decodePayload` on the worker. Both now throw a clear error past the limit instead of overflowing the call stack.
- **A soft-timed-out job is held back by `retry_after` before it can re-run.** On timeout the in-flight handler keeps running (JS can't preempt it), but the row was released immediately (`available_at = now + backoff`, default 0), so another worker could reserve and run the same job concurrently. A timeout now holds the row back by at least `retry_after` — the same window the crashed-worker safety net uses — before it becomes reclaimable. A normal failure still releases after the configured backoff.
