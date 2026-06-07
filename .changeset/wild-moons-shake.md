---
"@rudderjs/database": patch
---

Native engine: plain-object and array bindings now JSON-stringify at the compiler's binding funnel, so an object payload on a `t.json()` column works without declaring `static casts = { col: 'json' }`. Previously better-sqlite3 threw the opaque `TypeError: You cannot specify named parameters in two different objects`, mysql2 silently mangled the object into `` `key`='val' `` SQL pairs, and Postgres only survived when the server described the param as json/jsonb — all three dialects now store identical JSON text, round-tripping with the `json` cast's read path and pg/mysql's native JSON column parsing. `Date`/`Buffer`/class-instance bindings keep their driver-level handling.
