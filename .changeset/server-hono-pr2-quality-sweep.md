---
"@rudderjs/server-hono": patch
---

Fix `req.ip` ignoring `trustProxy` config (always read XFF/XRI regardless of setting), fix body parsing on `ALL`-method routes (`route.method` was registration-time value, not actual HTTP method), fix hardcoded version `'0.0.2'` in dev error page, and correct two inaccurate boost/guidelines.md claims (socket address fallback, lazy body parsing).
