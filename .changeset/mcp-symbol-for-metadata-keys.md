---
'@rudderjs/mcp': patch
---

Route all decorator metadata keys (`@Name`, `@Version`, `@Instructions`, `@Description`, `@Handle`, `@IsReadOnly`, `@IsDestructive`, `@IsIdempotent`, `@IsOpenWorld`, `@Audience`, `@Priority`, `@LastModified`) through `Symbol.for(...)` instead of `Symbol(...)` so the metadata key has a single process-global identity regardless of how many bundled copies of `decorators.ts` exist.

A bundled app's `entry.mjs` typically inlines the decorator module (the `@Handle` / `@Description` decorators run at module-load time when the user's tool class is defined), while the MCP runtime that later reads the metadata is resolved through `await import('@rudderjs/mcp/...')` → node_modules → a **second** copy of `decorators.ts` with a separate `Symbol(...)` identity. Write under one symbol, read from the other, `Reflect.getMetadata` returns `undefined`. Every `@Handle(...)`-injected dependency silently dropped → `greeter is undefined` style errors in production.

This is the same class of bug fixed in `@rudderjs/router` (#507) and the static-state-singleton audit (#498 / #500–#506). `Symbol.for(...)` shares the global symbol registry so the symbol identity survives bundle splits.

No public API change. Verified end-to-end on the playground prod-bundle: the `EchoTool.handle(input, greeter: GreetingService)` DI injection now resolves correctly through both the proxy intercept and a direct MCP SDK client call.
