---
"@rudderjs/server-hono": minor
---

fix: gate the per-request access log to development (off in production by default)

The adapter wrote a colored, dotted access-log line via `console.log` on every non-asset request with no dev/prod gate. That is a dev-server affordance: in production it floods the log sink with one human-formatted line per request, and synchronous per-request `console.log` on the hot path can degrade into error-object formatting under a backpressured sink.

The access log is now gated by `requestLogEnabled(env)` — on by default only in a dev-like env (the same secure-by-default gate as the dev error page), off in production. Set `RUDDER_REQUEST_LOG=1` to force it on in any env (e.g. production), or `=0` to force it off (e.g. in dev). When off, the whole log path is skipped — no per-request `URL` parse, `logPath`, counter, or `console.log`.

This is a default-behavior change, not a throughput optimization: benchmarking showed no req/s difference on a fast log sink. If you rely on production request logging, set `RUDDER_REQUEST_LOG=1`.
