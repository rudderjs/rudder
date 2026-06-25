---
"@rudderjs/ai": major
---

Deprecate `@rudderjs/ai`: the AI engine has moved to `@gemstack/ai-sdk` under the GemStack umbrella. This package is now a thin compatibility shim that re-exports `@gemstack/ai-sdk` (and every subpath: `/server`, `/node`, `/mcp`, `/eval`, `/computer-use`, `/gateway`, `/conversation-orm`, `/memory-orm`, `/budget-orm`, `/memory-embedding`, `/react`, `/doctor`, `/observers`, `/chat-mentions`, `/commands/*`). The public API is unchanged; existing imports keep working. New code should import from `@gemstack/ai-sdk` directly.
