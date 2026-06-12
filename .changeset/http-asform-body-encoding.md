---
"@rudderjs/http": patch
---

fix(http): make `asForm()` work and stop the per-request clone from dropping the body

`asForm()` was effectively a no-op. Two bugs combined: `_clone()` (run by every verb method before sending) did not copy `_body` or `_bodyType`, so any encoding or body set on the builder was discarded; and `withBody()` — the path `post(url, data)` takes — unconditionally forced the encoding back to JSON, clobbering a prior `asForm()`. The documented `Http.withBody({...}).asForm().post('/login')` pattern actually sent an empty body, and `Http.asForm().post(url, data)` sent JSON.

Now `_clone()` carries `_body`/`_bodyType` like every other field, and `withBody()` defaults the encoding to JSON only when none was chosen — so an explicit `asForm()` sticks regardless of call order. Form bodies are correctly serialized as `application/x-www-form-urlencoded`; JSON remains the default. Adds tests covering both `asForm()` paths, body survival across the clone, and JSON default (the body path had no test coverage before).
