---
"@rudderjs/ai": minor
---

Add a continuation-validation hook for the conversation-persistence path.

`runWithPersistence` (the `conversational()` auto-persist path, plus the explicit `forUser()`/`continue()` form and their streaming variants) previously trusted the caller's incoming history verbatim. A continuation after a client-tool or approval round-trip carries the prior messages back from the client, so a malicious caller could rewrite history to continue another user's thread (IDOR), forge a `tool` result for a tool the server never ran, or claim an approval that was never pending.

New `validate?: ContinuationValidator` option on `AgentPromptOptions`: when set, it runs against the server-persisted history just before the agent loop, and throwing rejects the request. Shipped helpers (all from the main entry):

- `defaultContinuationValidator()` - ready-made hook with the built-in gate (prefix equality + tool-result-forgery + approval-forgery).
- `validateContinuation(persisted, incoming, opts?)` - pure function returning a `{ ok, code, reason, index }` verdict for custom policy.
- `assertValidContinuation(...)` - throwing variant; rejects with `ContinuationValidationError`.

Fully backward compatible: with no `validate` option the path behaves exactly as before. Stateless calls (no persistence) never invoke the hook.
