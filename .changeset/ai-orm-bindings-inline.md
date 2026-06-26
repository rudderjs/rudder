---
"@rudderjs/ai": patch
---

The ORM-backed AI bindings (`@rudderjs/ai/conversation-orm`, `/memory-orm`, `/budget-orm`, `/memory-embedding`) are now first-class implementations in this package instead of re-exports of `@gemstack/ai-sdk`. They are the Rudder-specific bindings that couple the AI engine to `@rudderjs/orm`, so they belong here, not in the agnostic `@gemstack/ai-sdk`. Public exports and import paths are unchanged. This makes `@rudderjs/ai` self-contained ahead of `@gemstack/ai-sdk` dropping those subpaths.
