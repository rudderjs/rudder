---
"@rudderjs/ai": minor
"@rudderjs/auth": minor
"@rudderjs/boost": minor
"@rudderjs/broadcast": minor
"@rudderjs/broadcast-redis": minor
"@rudderjs/cache": minor
"@rudderjs/cashier-paddle": minor
"@rudderjs/cli": minor
"@rudderjs/concurrency": minor
"@rudderjs/console": minor
"@rudderjs/context": minor
"@rudderjs/contracts": minor
"@rudderjs/core": minor
"@rudderjs/crypt": minor
"@rudderjs/database": minor
"@rudderjs/hash": minor
"@rudderjs/horizon": minor
"@rudderjs/http": minor
"@rudderjs/image": minor
"@rudderjs/localization": minor
"@rudderjs/log": minor
"@rudderjs/mail": minor
"@rudderjs/mcp": minor
"@rudderjs/middleware": minor
"@rudderjs/notification": minor
"@rudderjs/orm": minor
"@rudderjs/orm-drizzle": minor
"@rudderjs/orm-prisma": minor
"@rudderjs/passport": minor
"@rudderjs/pennant": minor
"@rudderjs/process": minor
"@rudderjs/pulse": minor
"@rudderjs/queue": minor
"@rudderjs/queue-bullmq": minor
"@rudderjs/queue-inngest": minor
"@rudderjs/router": minor
"@rudderjs/sanctum": minor
"@rudderjs/schedule": minor
"@rudderjs/server-hono": minor
"@rudderjs/session": minor
"@rudderjs/socialite": minor
"@rudderjs/storage": minor
"@rudderjs/support": minor
"@rudderjs/sync": minor
"@rudderjs/telescope": minor
"@rudderjs/terminal": minor
"@rudderjs/testing": minor
"@rudderjs/view": minor
"@rudderjs/vite": minor
"create-rudder": minor
"create-rudder-app": minor
---

Require Node ≥ 22.12 (drop Node 20)

Node 20 ("Iron") reached end-of-life in April 2026, so `engines.node` is now `>=22.12.0` (was `^20.19.0 || >=22.12.0`). CI tests against the current Active LTS lines, Node 22 and 24. Consumers still on Node 20 will see an `engines` warning at install time — upgrade to Node 22 or 24. The scaffolder-generated app template now declares the same floor.
