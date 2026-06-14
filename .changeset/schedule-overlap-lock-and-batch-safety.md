---
"@rudderjs/schedule": patch
---

Fix two scheduler bugs around overlap locks and batch resilience.

First, a throwing `before()` hook leaked the `withoutOverlapping()` lock. The hook ran outside the try/finally that releases acquired locks, so a failing precondition left the overlap lock held for its full TTL (24h by default) and every subsequent run of that task was skipped as "already running". The before hook now runs inside the try, so the finally always releases the lock; a failed before hook also skips the callback (a failed precondition should not run the task).

Second, `withoutOverlapping()` snapshotted the lock key eagerly and, when chained before `description()`, baked in a per-process random id (`cron:<random>`). Two servers running the same task computed different keys, silently defeating cross-server overlap and `onOneServer()` mutual exclusion, and the key changed on every restart. The key is now computed lazily from `description || cron`, so it is deterministic and independent of builder-call order.

Also hardened the `schedule:run` loop: each task runs under its own try/catch so a throw escaping `_executeTask` (e.g. a failing after-hook or lock release) can no longer abort the batch and skip every remaining due task that minute.
