---
'@rudderjs/orm': patch
---

ORM cast and `JsonResource` errors now include the column / cast type / next step instead of bare opaque text.

- **`Invalid JSON in "<column>" cast`** (`packages/orm/src/cast.ts:_parseJson`) — now reads `Invalid JSON in cast column "<col>": <first 80 chars>… Verify the column stores serialized JSON; if it stores raw strings, change the cast to "string" or remove it.`
- **`Vector column "<col>" expected number[], got <type>`** (`cast.ts:103`) — gains a next-step hint pointing at `JSON.parse()` for pgvector text strings AND the `static casts = { <col>: vector({ dimensions: N }) }` declaration.
- **`Vector cast failed to parse value (…)`** (`cast.ts:91`) — now leads with the column name (renamed the cast `get()` parameter from `_key` → `key` since we're now using it), names the failed input, and points at the `vector(N)` schema column type.
- **`JsonResource.toJSON() does not support async toArray()`** (`resource.ts:108`) — now names the concrete resource class (`<UserResource>.toJSON()…`) via `this.constructor.name`, and the proposed fix becomes `res.json(await resource.toArray())` instead of the unhelpful "Use toArray() directly."

No behavior change; only message text + one parameter rename. All 430 ORM tests pass. Found by the Phase 2 error-message audit.
