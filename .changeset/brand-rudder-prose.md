---
"@rudderjs/server-hono": patch
"@rudderjs/boost": patch
"@rudderjs/sync": patch
"@rudderjs/cli": patch
"@rudderjs/ai": patch
---

Rename remaining user-facing "RudderJS" brand text to "Rudder", completing the rebrand from #1294. Affects CLI command help descriptions (`@rudderjs/cli`), the outbound MCP `User-Agent` header (`@rudderjs/ai`), the perf-boundaries output banner (`@rudderjs/server-hono`), the Boost guidelines header and app-info tool description (`@rudderjs/boost`), and a database-adapter error message (`@rudderjs/sync`). No behavior change; the `@rudderjs/*` npm scope and the exported `RudderJS` application class are unchanged.
