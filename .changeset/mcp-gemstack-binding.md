---
"@rudderjs/mcp": minor
---

Repoint `@rudderjs/mcp` onto the framework-agnostic `@gemstack/mcp` core. The MCP server-authoring framework graduated to `@gemstack/mcp@0.1.0`; `@rudderjs/mcp` is now a thin Rudder binding that re-exports the core and keeps the Rudder-specific surface: the `McpProvider` (auto-discovery + transport mounting), the Rudder container DI resolver behind `@Handle(...)`, the Passport-backed OAuth verifier, the `make:mcp-*` scaffolders, the doctor check, and the inspector.

No API change for consumers: `from '@rudderjs/mcp'` and `from '@rudderjs/mcp/observers'` keep exporting the same symbols. Internally the core (McpServer/McpTool/McpResource/McpPrompt/McpResponse/Mcp, the decorators, the OAuth helpers, the test client) now lives in `@gemstack/mcp`, and `@rudderjs/json-schema` is no longer a dependency (the core uses Zod 4's native `z.toJSONSchema`).
