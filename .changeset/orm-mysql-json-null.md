---
"@rudderjs/orm": patch
"@rudderjs/orm-drizzle": patch
---

fix: `whereNull`/`where(col, null)` on a JSON arrow path now matches an explicit json `null` on MySQL, not just a missing key (Laravel parity). MySQL's `JSON_EXTRACT` returns a JSON null literal — not SQL NULL — for an explicit null, so null equality now compiles to Laravel's `(extract IS NULL OR JSON_TYPE(extract) = 'NULL')` grammar shape on both the native engine (new `Dialect.jsonNullComparison` seam) and the Drizzle adapter. sqlite/pg SQL is unchanged.
