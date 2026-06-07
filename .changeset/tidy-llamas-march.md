---
"@rudderjs/cache": minor
---

Add `cache:clear` — flushes the application cache store (Laravel parity), registered by `CacheProvider.boot()`. `CacheAdapter` gains an optional `disconnect()` (implemented for redis) so one-shot CLI commands exit instead of hanging on an open connection.
