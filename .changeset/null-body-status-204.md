---
"@rudderjs/server-hono": patch
---

Fix a 500 when a route returns a null-body HTTP status (204/205/304) with a body — e.g. `res.status(204).send('')` (the Laravel `noContent()` equivalent, common for `DELETE` handlers). server-hono passed the body straight to Hono, and undici's `Response` constructor throws `Invalid response status code 204` when a body is attached to a null-body status, surfacing as a 500 even though the handler succeeded. `send()` and `json()` now emit a bodyless response for 204/205/304 (and 1xx), honoring the status and dropping the body. Found by dogfooding the playground's todo-delete flow.
