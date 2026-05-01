---
'@rudderjs/server-hono': patch
'@rudderjs/session': patch
---

Fix multi-value `Set-Cookie` collapse on web-group routes

When middleware on the `web` group wrote multiple cookies cooperatively
(canonically: `CsrfMiddleware` setting `csrf_token` + `SessionMiddleware`
setting `rudderjs_session`), only one survived to the browser. Two
distinct bugs were involved:

1. `normalizeResponse` in server-hono tracked headers as a
   `Record<string, string>`, so two `res.header('Set-Cookie', ...)` calls
   would clobber each other.
2. When the handler returned a `ViewResponse` or raw `Response`, server-hono
   set `c.res = ...` directly bypassing `res.json()/res.send()`, so the
   wrapper's pending headers never got applied to the response.
3. `session.save()` cloned the existing response via
   `new Response(body, { headers: existingHeaders })` to append its own
   cookie — Node's undici-backed `Response` constructor collapses
   multi-value `Set-Cookie` down to one when init.headers is a `Headers`
   instance, dropping any cookies (e.g. CSRF) that earlier middleware wrote.

Fix: track Set-Cookie as an array in `normalizeResponse`, merge pending
headers into `c.res` after view/raw paths set it, and have `session.save()`
mutate `c.res.headers` in place via `headers.append('Set-Cookie', value)`
instead of cloning.

Visible symptom on the playground: GET /register returned only one
Set-Cookie, so the browser never received `csrf_token` and every form
POST 419'd with `CSRF token mismatch`.
