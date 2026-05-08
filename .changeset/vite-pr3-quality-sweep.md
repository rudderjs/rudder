---
"@rudderjs/vite": patch
---

Add `@rudderjs/orm-prisma` to SSR externals, fix WS pending-buffer socket leak on 10s timeout (destroy queued sockets rather than silently dropping them), fix HMR log missing closing `)`, and correct boost/guidelines.md plugin name (`rudderjs:views` → `rudderjs:views-scanner`) and ORM externals list.
