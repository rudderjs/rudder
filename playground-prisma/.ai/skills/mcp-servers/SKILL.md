---
name: mcp-servers
description: Building MCP servers with tools, resources, prompts, decorators, and HTTP/stdio transports in RudderJS
license: MIT
appliesTo:
  - '@rudderjs/mcp'
trigger: building an MCP server, using `@McpServer` / `@Tool` decorators, exposing tools or resources, or choosing HTTP vs stdio transport
skip: consuming an external MCP server from an Agent — use `mcpClientTools()` and load `ai-tools` instead
metadata:
  author: rudderjs
---

# MCP Servers

## When to use this skill

Load when you're building a Model Context Protocol (MCP) server — exposing tools, resources, or prompts to AI coding assistants. If you're consuming an *external* MCP server inside an Agent, load `ai-tools` instead and use `mcpClientTools()`.

## Quick Reference

| Task | Open |
|---|---|
| Tools — `McpTool`, schema, `outputSchema`, name derivation, `McpResponse` helpers | `rules/tools.md` |
| Resources + Prompts — `McpResource` with URI templates, `McpPrompt` with arguments | `rules/resources-and-prompts.md` |
| Assemble + register a server — `McpServer` base class, decorators, `Mcp` facade | `rules/server-assembly.md` |
| Transports — stdio (`Mcp.local`) vs HTTP/SSE (`Mcp.web`), middleware | `rules/transports.md` |
| Test + DI — `McpTestClient`, DI-injected tool classes | `rules/testing-and-di.md` |

## Key concepts (load once)

- **`McpServer`** — base class. Declares `protected tools`, `resources`, `prompts` arrays of classes.
- **`McpTool` / `McpResource` / `McpPrompt`** — base classes. Implement `handle()` + `schema()` (tools) / `uri()` (resources) / `arguments()` (prompts).
- **Decorators** — `@Name`, `@Version`, `@Instructions`, `@Description` write metadata via reflect-metadata.
- **Name auto-derivation** — `WeatherTool` → `weather`. PascalCase → kebab-case, minus `Tool` suffix.
- **`McpResponse`** — return helper: `McpResponse.text(s)`, `.json(obj)`, `.error(msg)`. Errors thrown from `handle()` are auto-wrapped.
- **DI integration** — tool/resource/prompt classes resolve via the framework's container when available; falls back to `new T()`.
- **`McpTestClient`** — in-memory client for testing servers without spinning up a transport.

## Examples

See `packages/mcp/src/index.test.ts` for end-to-end tests and `playground/app/Mcp/` for a working server (`EchoMcpServer` + secured variant).
