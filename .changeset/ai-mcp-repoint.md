---
"@rudderjs/ai": patch
---

Repoint the deprecated `@rudderjs/ai/mcp` subpath onto `@gemstack/ai-mcp`. The agent<->MCP bridge graduated out of `@gemstack/ai-sdk` at 0.3.0 (which dropped its `./mcp` subpath), so the shim now re-exports `@gemstack/ai-mcp` and tracks `@gemstack/ai-sdk` `^0.3.0`. `@rudderjs/ai/mcp` keeps working and the shim is no longer stranded on the `ai-sdk` 0.2.x line.
