---
'@rudderjs/orm': patch
---

Fix: bound string timestamps no longer store TZ-shifted on the native Postgres engine. porsager/postgres's default `date` type serializer round-trips every bound value the server describes as `date`/`timestamp`/`timestamptz` through `new Date(x).toISOString()` — a plain `'2026-01-20 11:20:45'` string was parsed as machine-local time and silently stored shifted on any non-UTC server (e.g. `Model.create({ at: '2026-01-20 11:20:45' })` landed as `09:20:45` on a UTC+2 machine; UTC CI never showed it). The driver now overrides the type so strings pass through verbatim (Postgres casts text natively, machine-TZ independent). `Date` values keep the exact previous serialization (`toISOString()`, same instant) and reads are unchanged.
