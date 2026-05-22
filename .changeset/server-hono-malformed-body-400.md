---
'@rudderjs/contracts': minor
'@rudderjs/server-hono': patch
---

fix(server-hono): malformed request body → 400 (was a silent `{}`)

A `POST` / `PUT` / `PATCH` with `Content-Type: application/json` (or `application/x-www-form-urlencoded`) and a truncated or otherwise unparseable body used to silently become `req.body = {}`. Handlers and validators then saw a request that "looked fine" and emitted cryptic "field required" errors — masking a malformed-request as a missing-field problem.

The body-parse block in `server-hono` now throws a `MalformedBodyError` on parse failure. The central exception pipeline in `@rudderjs/core` recognizes its `httpStatus = 400` and renders a clean 400 response with the parse-error context.

**Behavior change**

| Scenario | Before | After |
|---|---|---|
| `application/json` + parseable body | parsed object | parsed object |
| `application/json` + truncated / invalid body | `req.body = {}`, 200 | `400 — Malformed request body (Content-Type: application/json)` |
| `application/json` + empty body | `req.body = {}`, 200 | `req.body` stays `null`, request proceeds; validators emit their normal "field required" errors |
| `application/x-www-form-urlencoded` + parseable body | parsed object | parsed object |
| `application/x-www-form-urlencoded` + empty body | `req.body = {}`, 200 | `req.body` stays `null` |

The empty-body case used to look like an empty object; it now leaves `req.body` at the normalizer default so validators handle "no body" the same way they handle "GET with no body" — emitting standard missing-field errors instead of cryptic JSON parse messages.

**API**

`@rudderjs/contracts` now exports `MalformedBodyError extends Error`:

```ts
import { MalformedBodyError } from '@rudderjs/contracts'

err.httpStatus  // 400 (duck-typed; recognized by core's exception pipeline)
err.contentType // 'application/json' | 'application/x-www-form-urlencoded'
err.cause       // the underlying SyntaxError, when applicable
```

Plan: `docs/plans/2026-05-21-framework-pipeline-hardening.md`, Phase 2.
