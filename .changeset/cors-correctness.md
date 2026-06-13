---
"@rudderjs/middleware": patch
---

Fix several CORS correctness issues in `CorsMiddleware`:

- **Preflight is now answered.** A CORS preflight (`OPTIONS` carrying `Access-Control-Request-Method`) is short-circuited with `204` instead of falling through to the router (which would 404/405, making the browser treat the real cross-origin request as blocked). A new `maxAge` option emits `Access-Control-Max-Age` so browsers can cache the preflight.
- **No more leaked origin on a non-match.** With an allowlist (`origin: [...]`), a request whose `Origin` isn't in the list now gets **no** `Access-Control-Allow-Origin` header, instead of the first allowlist entry.
- **`Vary: Origin`** is set whenever the allow-origin is reflected per request, so shared caches don't serve one origin's allow header to another.

Single-string and `*` origins, and the default method/header lists, are unchanged.
