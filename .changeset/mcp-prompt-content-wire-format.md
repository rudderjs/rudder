---
"@rudderjs/mcp": patch
---

`prompts/get` responses now emit structured content objects (`{ type: 'text', text: string }`) on the wire, matching the MCP spec's `PromptMessageSchema`. Previously the SDK handler forwarded `McpPromptMessage.content` as a raw string, which the MCP TypeScript SDK rejected with a Zod validation error on the client side. Prompts authored against the framework's `McpPrompt` interface are unaffected — the adapter only transforms on the way out, so user code still returns `{ role, content: string }`.

Surfaced while writing end-to-end SDK-handler tests (mcp-quality-audit PR C).
