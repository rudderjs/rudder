---
"@rudderjs/orm-drizzle": minor
---

JSON arrow-path keys in update payloads — `Model.update(id, { 'meta->prefs->lang': 'en' })` (and `updateAll`) now works on the Drizzle adapter, mirroring the native engine: sqlite `json_set(col, path, json(?))`, mysql `JSON_SET(col, path, CAST(? AS JSON))`, pg nested `jsonb_set((col)::jsonb, ARRAY[…], cast(? as text)::jsonb)` (the text cast sidesteps postgres-js re-stringifying jsonb-described params). Values bind as JSON text so every type (string/number/boolean/null/array/object) round-trips identically; multiple writes on one column merge into a single assignment; mixing a whole-column write and an arrow write on the same column throws; path segments run the same injection gate as JSON reads; plain payloads are untouched (zero-cost gate).
