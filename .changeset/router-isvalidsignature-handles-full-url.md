---
'@rudderjs/router': patch
---

Fix `Url.isValidSignature(req)` so signed URLs verify correctly behind any server adapter.

Hono's `c.req.url` is a fully-qualified URL (`http://host/path?query`), not a bare path — that's what `server-hono` forwards as `req.url`. The previous verifier split `req.url` at the first `?` and treated the left half as the pathname, so the HMAC was computed over `http://host/path` while `Url.sign(path)` had hashed just `/path`. Pathnames never matched. Every signed-URL request returned 403 in production:

- `serveTemporaryUrls()` (signed file downloads)
- `ValidateSignature()` middleware (any custom signed route)
- `Url.signedRoute(...)` use cases including the email-verification flow shipped by `@rudderjs/auth`

`isValidSignature` now parses `req.url` through `new URL(req.url, base)` so both fully-qualified URLs and bare paths collapse to the same pathname + searchParams pair the signer used. Existing tests cover both forms, plus tampered-pathname / tampered-query / expired-signature / round-trip-via-signedRoute. No change to `Url.sign(path, ...)` — it has always taken paths.
