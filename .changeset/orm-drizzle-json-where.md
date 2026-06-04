---
'@rudderjs/orm-drizzle': minor
---

JSON-path predicates on the Drizzle adapter (parity with the native engine): arrow paths in `where()` (`where('meta->prefs->lang', 'en')` — also in `orWhere`, group callbacks, `whereNot`, the `whereIn`/`whereNull`/`whereBetween` sugar, and `whereHas` constraint callbacks), plus `whereJsonContains` / `whereJsonDoesntContain` / `whereJsonLength` (+ `orWhere*` forms). Per-dialect SQL mirrors the native seams — sqlite `json_extract` + `json_each` EXISTS emulation, pg arrow chains with `::numeric`/`::boolean` casts + `@>` + `jsonb_array_length` (the containment candidate binds through `cast(? as text)::jsonb` so postgres-js can't double-encode it), mysql `JSON_UNQUOTE(JSON_EXTRACT)` + `JSON_CONTAINS` + `JSON_LENGTH` with booleans spliced as SQL literals. Path segments are validated (quotes/backslashes/backticks/control chars rejected); numeric segments address array indexes.
