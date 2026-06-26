---
"@rudderjs/mcp": patch
---

Build the MCP inspector on `@gemstack/mcp`'s public API instead of internal access. The inspector now reads a server's registered classes via the public `McpServer.introspect()` surface (dropping a cast through the core's `@internal` accessors) and imports `zodToJsonSchema` + `matchUriTemplate` from `@gemstack/mcp` (retiring the binding's local copies). Bumps the `@gemstack/mcp` dependency to `^0.2.0`, which adds those public exports. No behavior change.
