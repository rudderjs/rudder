---
"@rudderjs/cli": patch
---

`rudder add notifications` no longer suggests running `make:notification` — that command doesn't exist. The hint now shows the real API (extend `Notification`, dispatch via `notify(...)`).
