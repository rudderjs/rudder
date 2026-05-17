---
'@rudderjs/server-hono': patch
---

Silence Vite's "dynamic import cannot be analyzed" warning on the `@rudderjs/view` prewarm path by annotating it with `/* @vite-ignore */`. The string-variable indirection in `import(viewModuleSpecifier)` is intentional — `@rudderjs/view` is an optional peer and the indirection avoids a hard TS build-time resolution. The warning was cosmetic, no behavior change.
