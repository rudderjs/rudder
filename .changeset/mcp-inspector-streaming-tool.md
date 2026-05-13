---
"@rudderjs/mcp": patch
---

`mcp:inspector` now correctly consumes streaming tools (`async *handle()`). Previously, calling a streaming tool through the inspector returned an empty `{}` because `tool.handle()` was JSON-serialized as the iterator object instead of being drained. The inspector now runs the same `consumeToolReturn` path as the SDK and test client — progress yields are dropped (the inspector is a synchronous UI), and the final result is returned.

Also deduplicates the URI-template matcher between the SDK runtime and inspector (previously two near-identical copies in `runtime.ts` and `commands/inspector.ts`) by extracting it to `src/uri-template.ts`.
