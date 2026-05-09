---
'@rudderjs/mcp': minor
---

Add MCP protocol-spec annotations and conditional registration:

- **Tool annotations** — `@IsReadOnly` / `@IsDestructive` / `@IsIdempotent` / `@IsOpenWorld` class decorators surface as `annotations` on `tools/list`. Clients (Claude Desktop, Cursor, etc.) use these hints to decide auto-approval, batching, and sandboxing. Each accepts an explicit value (`@IsReadOnly()` = true, `@IsReadOnly(false)` = false, omitted = absent).
- **Resource annotations** — `@Audience('user' | 'assistant')`, `@Priority(0..1)`, `@LastModified(string | Date)` surface on `resources/list` and `resources/templates/list`.
- **`shouldRegister()` hook** on `McpTool` / `McpResource` / `McpPrompt`. Returning `false` hides the primitive from list endpoints AND blocks calls — preventing bypass. Async hooks supported. Use for static gating (env flags, feature toggles, build mode).
- **`McpTestClient.listTools()` / `.listResources()`** now return `annotations` when set and apply `shouldRegister` filtering, so tests reflect production behavior.
