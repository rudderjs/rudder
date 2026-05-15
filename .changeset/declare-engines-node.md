---
"@rudderjs/ai": patch
"@rudderjs/auth": patch
"@rudderjs/boost": patch
"@rudderjs/broadcast": patch
"@rudderjs/cache": patch
"@rudderjs/cashier-paddle": patch
"@rudderjs/cli": patch
"@rudderjs/concurrency": patch
"@rudderjs/console": patch
"@rudderjs/context": patch
"@rudderjs/contracts": patch
"@rudderjs/core": patch
"@rudderjs/crypt": patch
"@rudderjs/hash": patch
"@rudderjs/horizon": patch
"@rudderjs/http": patch
"@rudderjs/image": patch
"@rudderjs/localization": patch
"@rudderjs/log": patch
"@rudderjs/mail": patch
"@rudderjs/mcp": patch
"@rudderjs/middleware": patch
"@rudderjs/notification": patch
"@rudderjs/orm": patch
"@rudderjs/orm-drizzle": patch
"@rudderjs/orm-prisma": patch
"@rudderjs/passport": patch
"@rudderjs/pennant": patch
"@rudderjs/process": patch
"@rudderjs/pulse": patch
"@rudderjs/queue": patch
"@rudderjs/queue-bullmq": patch
"@rudderjs/queue-inngest": patch
"@rudderjs/router": patch
"@rudderjs/sanctum": patch
"@rudderjs/schedule": patch
"@rudderjs/server-hono": patch
"@rudderjs/session": patch
"@rudderjs/socialite": patch
"@rudderjs/storage": patch
"@rudderjs/support": patch
"@rudderjs/sync": patch
"@rudderjs/telescope": patch
"@rudderjs/terminal": patch
"@rudderjs/testing": patch
"@rudderjs/view": patch
"@rudderjs/vite": patch
"create-rudder-app": patch
---

Declare `engines.node: "^20.19.0 || >=22.12.0"` on every published package and on the scaffolder-generated `package.json` template.

Matches the actual runtime floor enforced transitively by `vite@7` (`^20.19.0 || >=22.12.0`) and `vike` (`>=20.19.0`). Previously the requirement was only mentioned in the install guide — adding it to `engines.node` surfaces the floor at `pnpm install` / `npm install` time via the package manager's engines warning, rather than waiting for runtime / transitive errors.

Not a breaking API change — `engines` is advisory by default (package managers warn but don't refuse without `engineStrict=true`).
