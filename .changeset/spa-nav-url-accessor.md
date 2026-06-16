---
'@rudderjs/contracts': minor
'@rudderjs/server-hono': minor
---

feat(server-hono): expose non-forgeable `req.spaNavUrl` / `req.isPageContextRequest`

Adds two read-only `AppRequest` accessors that surface the adapter's SPA-nav signal to route middleware and handlers:

- `req.spaNavUrl` — the original `/<path>/index.pageContext.json` URL when this request is a Vike client-router navigation that the adapter rewrote into a controller-view call; `undefined` for direct requests.
- `req.isPageContextRequest` — boolean convenience for the same condition.

Both are getters over the existing per-request `spaNavUrlStore` `AsyncLocalStorage`, not a client header, so they're unforgeable: a direct request (even one sending the old `x-rudder-original-url` header) reads `undefined`/`false`. This is the supported replacement for the `x-rudder-original-url` request header removed in 1.9 — guard/policy middleware uses it to return a Vike-parseable JSON envelope for SPA fetches but a real `302`/HTML for top-level navigations, instead of heuristics like sniffing `Sec-Fetch-Mode`.
