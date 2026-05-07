---
'@rudderjs/ai': minor
---

Validate tool call arguments against `inputSchema` at runtime. Before this, a misbehaving model returning malformed JSON or wrong types silently passed garbage to the tool's `execute`. The agent loop now runs `safeParse` on every tool call's arguments — on failure it skips `execute` and feeds a structured `{ error: 'invalid_arguments', message, issues }` result back to the model so it can correct itself. Applies to non-streaming `prompt()`, `stream()`, and the approval-resume continuation path.

Behavior change: `execute` now receives the **parsed** value, so zod transforms and defaults take effect (e.g. `z.number().default(10)` on a missing field is now `10` rather than `undefined`). Tools whose schema is permissive (`z.any()` / `z.unknown()` / no transforms) see no change.

The new `InvalidToolArgumentsError` type is exported from the package root for middleware authors who want to disambiguate a validation failure from a runtime error.
