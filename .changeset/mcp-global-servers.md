---
'@rudderjs/mcp': patch
---

Route `Mcp`'s web/local server maps through `globalThis` so the registry survives the case where `@rudderjs/mcp` is loaded twice — typical in a Vite-bundled server where the framework bundles `@rudderjs/mcp` inline (the route mounter reads `Mcp.getWebServers()`) but `Mcp.web()` / `Mcp.local()` calls in `routes/console.ts` and `app/Mcp/*` can run from a `node_modules` copy resolved via the provider auto-discovery manifest. Without a shared store, servers registered from the externalized copy would never be visible to the bundled copy's mounter — every `/mcp/*` request would 404 and stdio MCP commands wouldn't show up.

No public API change — same `web` / `local` / `getWebServers` / `getLocalServers` surface. Defensive migration per the #499 static-state singleton audit (the `__rudderjs_mcp_observers__` registry was already migrated; this completes the package). Same pattern as PR #498 (`@rudderjs/orm` `ModelRegistry`), #500 (pennant), #501 (cache), #502 (queue), #503 (mail), #504 (storage), #505 (hash).
