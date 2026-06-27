---
"@rudderjs/core": patch
---

fix(core): close maintenance-mode bypass for paths with a dot in the last segment

The maintenance middleware let any request whose final path segment contained a
period skip the 503 gate (e.g. `/api/users.json`, `/admin.x`,
`/internal/export.csv`). The static-asset pass-through now matches a known
file-extension allow-list instead of "any dot", so app and API routes stay
gated while down.
