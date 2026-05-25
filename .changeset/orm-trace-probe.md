---
"@rudderjs/orm": patch
---

Add `RUDDER_ORM_TRACE=1` dev diagnostic: logs one line per read terminal (`find`/`first`/`get`/`all`/`paginate`) with the model name, a stable class-identity tag, resolved table, the adapter-object identity, applied soft-delete/global-scope filters, and the row count returned.

Built to diagnose the "booted-ORM path returns empty after a dev re-boot, no error" residual (the HMR reboot-window plan's REOPEN #2): because the symptom is empty-not-error, the trace line surfaces which cause is in play — a wrong table, a stale re-imported model class (its `class=#N` tag differs from a working query's), a swapped adapter (`adapter=#M`), or a scope/soft-delete filtering everything out. Zero overhead when the env var is unset (every call early-returns). Class/adapter tags are stable across re-boots (this module is externalized, not re-evaluated), so re-imported `app/Models/*` deliberately get fresh tags — that contrast is the signal.
