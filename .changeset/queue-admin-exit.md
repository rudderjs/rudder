---
"@rudderjs/queue": patch
---

fix(queue): admin commands now exit instead of hanging the terminal

`queue:status`, `queue:clear`, `queue:failed`, and `queue:retry` printed their output but never closed the adapter's connection — the open BullMQ/Redis connection kept the Node event loop alive, so the CLI hung until Ctrl+C (the command did its job, but the prompt never returned). These one-shot admin commands now `await a.disconnect?.()` after their work, so the process exits cleanly. `queue:work` (which is meant to block until SIGTERM) is unchanged.
