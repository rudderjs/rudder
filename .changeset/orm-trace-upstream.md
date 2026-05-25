---
"@rudderjs/orm": patch
---

Extend `RUDDER_ORM_TRACE` upstream to localize the REOPEN #2 wedge. The first probe showed the wedged query emits no read-terminal line at all — so the failure is upstream of `get`/`paginate`. This adds two more line types: `[orm] build …` at query construction (its absence proves `Model.query()` was never reached → the wedge is above the ORM), and `[orm] THREW <terminal> … :: <error>` when a terminal's adapter call throws and is re-thrown (the empty-not-error symptom means something swallows it upstream; the message names the real failure). Still zero overhead when the env var is off.
