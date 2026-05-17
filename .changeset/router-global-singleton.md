---
'@rudderjs/router': patch
---

Route the module-singleton `router` (and its `Route` alias) through `globalThis` so the same `Router` instance is shared across duplicate module bundles. A bundled app's `entry.mjs` ships its own copy of `@rudderjs/router`; when a framework provider calls `resolveOptionalPeer('@rudderjs/router')` from inside that bundle, a second copy is loaded from `node_modules`, each with its own module-level `new Router()`. `McpProvider.boot()` was registering `/mcp/echo` on the node_modules-copy router while `server-hono` dispatched against the bundled-copy router, so every MCP web route silently 404'd in production builds.

Same pattern as `groupMiddlewareStore` in `@rudderjs/core` and the static-state registries audited in #498 / #500–#506. No public API change.
