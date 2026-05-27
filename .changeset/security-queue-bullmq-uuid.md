---
"@rudderjs/queue-bullmq": patch
---

Require `bullmq` `^5.77.6` (was `^5.0.0`). Recent bullmq dropped its bundled `uuid` dependency, clearing the moderate `uuid` buffer-bounds advisory. The `Queue`/`Worker`/`Job` API used is unchanged within the 5.x line.
