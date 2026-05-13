---
"@rudderjs/telescope": patch
---

Internal cleanup: add regression coverage for the list-slug parity contract, file integration tests for `SqliteStorage`, snapshot-shape tests for the three largest detail views (`RequestView` / `HttpView` / `AiView`), and unit tests for the `ai` / `job` / `mcp` collectors. Glob the `pnpm test` script so future test files auto-run.

No API change. Test count `@rudderjs/telescope`: 52 → 115.
