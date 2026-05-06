---
'@rudderjs/server-hono': patch
---

Parse `application/x-www-form-urlencoded` request bodies on POST/PUT/PATCH (in addition to JSON). Required by RFC 6749 §3.2 for OAuth2 token endpoints — without this, `@rudderjs/passport`'s `/oauth/token`, `/oauth/device/code`, `/oauth/device/approve`, and POST/DELETE `/oauth/authorize` cannot accept spec-compliant clients (curl `-d`, Postman default, axios `URLSearchParams`, Spring Security, MSAL). Multipart/form-data is still left untouched (handlers parse via `c.req.parseBody()` when needed).
