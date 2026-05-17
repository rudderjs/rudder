---
'@rudderjs/server-hono': patch
---

Clone the raw Web `Request` before consuming its body for JSON / form-urlencoded pre-parsing. Hono's `c.req.json()` / `c.req.text()` go straight through to `raw.text()` and consume the underlying `ReadableStream`, so handlers that need to read `c.req.raw.body` themselves get a locked / empty stream. The canonical case is `@rudderjs/mcp`'s `WebStandardStreamableHTTPServerTransport`, which parses the JSON-RPC payload directly off the raw stream — every POST to a mounted MCP endpoint hung waiting for a body that server-hono had already drained.

With `c.req.raw.clone().json()`, the original stream survives for the handler while the clone gets consumed for `req.body`. No behavior change for handlers that only read `req.body`; existing form-urlencoded OAuth, JSON API, and multipart paths are unaffected.
