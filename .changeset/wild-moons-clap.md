---
"@rudderjs/cli": minor
---

Add `make:exception` — scaffolds a domain exception class into `app/Exceptions/` with the duck-typed `httpStatus` rendering opt-in baked in. `--status <code>` (4xx/5xx, default 500) sets the status the exception renders with; invalid codes are rejected before anything is written.
