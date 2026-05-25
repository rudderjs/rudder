---
"@rudderjs/orm": patch
---

Trace the `count()` read terminal under `RUDDER_ORM_TRACE` (it previously fell through the proxy's pass-through and logged no terminal line). Without it, a list view's separate total/badge `count()` showed up as a `build` with no matching terminal — masquerading as a "dropped" `paginate` in the REOPEN #2 diagnosis. The read surface is now 1 `build` : 1 terminal, so the trace is unambiguous.
