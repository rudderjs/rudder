---
"@rudderjs/cli": patch
---

Doctor now picks up checks contributed by `@rudderjs/broadcast-redis` (`REDIS_URL` + deep connectivity probe). The package is silently skipped when not installed in the user app.
