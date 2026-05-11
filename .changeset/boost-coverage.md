---
"@rudderjs/cashier-paddle": patch
"@rudderjs/orm-drizzle": patch
"@rudderjs/orm-prisma": patch
"@rudderjs/queue-bullmq": patch
"@rudderjs/queue-inngest": patch
"@rudderjs/terminal": patch
---

Author `boost/guidelines.md` for the 6 packages that previously had no boost content. Adopting apps now get per-package guidelines for these packages too — `@rudderjs/boost` was already capable of consuming them, only the source content was missing.

Also adds `"boost"` to the `files` array in `package.json` for the 5 packages that didn't include it (`@rudderjs/terminal` already did), so the guidelines actually ship via npm.

No code changes.
