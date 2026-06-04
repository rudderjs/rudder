---
"@rudderjs/orm": minor
---

JSON arrow-path keys in update payloads on the native engine — `Model.update(id, { 'meta->prefs->lang': 'en' })` (and `updateAll`) writes one path inside a JSON column via the new per-dialect `Dialect.jsonSet` seam: sqlite `json_set(col, path, json(?))`, mysql `JSON_SET(col, path, CAST(? AS JSON))`, pg nested `jsonb_set((col)::jsonb, ARRAY[…], $n::jsonb)`. Values bind as JSON text so every type (string/number/boolean/null/array/object) round-trips identically; multiple writes on one column merge into a single assignment; mixing a whole-column write and an arrow write on the same column throws; path segments run the same injection gate as JSON reads. Plain payloads compile byte-identical to before. Under `fillable`/`guarded` the arrow key itself must be listed (Laravel parity). Adapters without the capability (Drizzle/Prisma for now) throw a clear Model-layer error instead of leaking the arrow key downstream.
