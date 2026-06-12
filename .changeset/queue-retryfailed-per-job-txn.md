---
"@rudderjs/queue": patch
---

Make the native database queue's `retryFailed()` atomic per job. It re-enqueued each failed job and deleted the `failed_jobs` row as two separate statements, so a crash between them could either duplicate the job (insert committed, delete lost) or strand it in `failed_jobs` (delete without the re-enqueue). Each job's re-enqueue + delete now runs in its own transaction — one transaction per job, so a single bad row can't roll back jobs already retried.
