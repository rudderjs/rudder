---
'@rudderjs/broadcast': patch
'@rudderjs/cache': patch
'@rudderjs/context': patch
'@rudderjs/crypt': patch
'@rudderjs/hash': patch
'@rudderjs/localization': patch
'@rudderjs/log': patch
'@rudderjs/mail': patch
'@rudderjs/middleware': patch
'@rudderjs/notification': patch
'@rudderjs/pennant': patch
'@rudderjs/sanctum': patch
'@rudderjs/schedule': patch
'@rudderjs/server-hono': patch
'@rudderjs/session': patch
'@rudderjs/socialite': patch
'@rudderjs/testing': patch
---

Include `boost/` directory in the published npm tarball so `@rudderjs/boost`'s MCP server can resolve `guidelines://<pkg>` resources from `node_modules/@rudderjs/<pkg>/boost/guidelines.md` in user apps. Previously only `ai`, `auth`, and `core` shipped their guidelines — the other 17 framework packages had `boost/guidelines.md` in the workspace but excluded from publish, leaving Boost-aware AI assistants with empty guideline resources for ~85% of the framework. No code change; manifest-only.
