---
"@rudderjs/queue": patch
---

Two queue-worker correctness fixes:

- **`queue:work` numeric flags passed without a value no longer poison the worker.** A bare `--tries` / `--sleep` / `--backoff` / `--timeout` / `--max-jobs` (no `=value`) parsed to `Number(undefined) === NaN`; because NaN is not nullish it survived every downstream `?? default`. A NaN `sleep` turned the empty-queue poll into a busy-spin, and a NaN `tries` made `attempts >= maxTries` always false, so a failing job was released back to the queue forever and never moved to `failed_jobs`. Valueless or non-numeric flag values are now ignored, so the documented defaults apply.
- **The `RateLimited` job middleware now uses an atomic counter.** It previously did `get` then `set(count + 1)`, which let two workers read the same count and both write `count + 1` (the limit silently leaked under concurrency), and re-`set`ting with the decay every call slid the window forward so a never-idle job stream's counter never expired. It now uses the cache's atomic `increment`, which seeds the TTL on the first hit and preserves it thereafter — a race-free fixed window.
