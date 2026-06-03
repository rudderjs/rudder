---
"@rudderjs/orm": minor
---

JSON-path predicates on the native engine: arrow paths in `where()` (`where('meta->prefs->lang', 'en')` — also in `orWhere`, group callbacks, `whereNot`, and the `whereIn`/`whereNull`/`whereBetween` sugar), plus `whereJsonContains` / `whereJsonDoesntContain` / `whereJsonLength` (+ `orWhere*` forms) with Model statics. Compiled through new per-dialect `Dialect.jsonExtract` / `jsonContains` / `jsonLength` seams — sqlite `json_extract`/`json_each`, pg arrow-operator chains with `::numeric`/`::boolean` casts + `@>` + `jsonb_array_length`, mysql `JSON_EXTRACT`/`JSON_CONTAINS`/`JSON_LENGTH`. Path segments are validated (quotes/backslashes/backticks/control chars rejected); numeric segments address array indexes (`meta->items->0`). Prisma/Drizzle throw a clear "not supported on this adapter" error until their follow-ups.
