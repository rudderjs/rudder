---
"@rudderjs/ai": minor
---

**MCP ↔ Agent bridge** — `@rudderjs/ai/mcp` ships two paired connectors that close the loop between `@rudderjs/ai` and the Model Context Protocol. Net-new differentiator: Laravel ships neither side.

- `mcpClientTools(transport, opts?)` — connect to a remote MCP server (URL string for HTTP, `{ command, args }` for a stdio subprocess, or an already-connected SDK Client) and surface its tools as agent `Tool[]`. Remote JSON Schema flows through verbatim — no zod round-trip — via the new `jsonSchema` passthrough on `ToolDefinitionOptions`. The returned array carries a non-enumerable `close()` for shutdown when this call owns the client.
- `mcpServerFromAgent(AgentClass, opts?)` — wrap an `Agent` as an MCP server, returned as the SDK's `McpServer` (connect with any SDK transport — stdio, HTTP). Three exposure modes: `'tools'` (default; one MCP tool per `agent.tools()` entry), `'agent'` (one prompt-tool runs the whole agent — the marquee differentiator), or `'both'`.
- `ToolDefinitionOptions.jsonSchema?: Record<string, unknown>` — pre-built JSON Schema escape hatch for tools whose shape is constructed dynamically (MCP imports today; OpenAPI generators next). When set, takes precedence over `inputSchema` on the wire to providers.

`@modelcontextprotocol/sdk` is an optional peer dependency — apps that don't import the `/mcp` subpath aren't forced to install it.
