---
"@rudderjs/telescope": patch
"@rudderjs/orm-prisma": patch
"@rudderjs/orm-drizzle": patch
---

Repoint the optional AI integration from the deprecated `@rudderjs/ai` shim onto `@gemstack/ai-sdk` directly. `orm-prisma`/`orm-drizzle` resolve the AI embedder for `whereVectorSimilarTo` string auto-embed via `@gemstack/ai-sdk`; `telescope`'s AI collector hooks `@gemstack/ai-sdk/observers`. No behavior change (same symbols; `@gemstack/ai-sdk` is present transitively for anyone still on the shim). The optional peer dependency is now `@gemstack/ai-sdk` instead of `@rudderjs/ai`.
