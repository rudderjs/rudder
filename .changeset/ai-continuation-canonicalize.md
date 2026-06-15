---
"@rudderjs/ai": patch
---

Fix `validateContinuation` falsely rejecting legitimate continuations whose tool-call arguments were reordered.

The prefix check compared messages with a key-order-sensitive `JSON.stringify`, so a tool-call `arguments` object (or structured `content`) whose keys came back in a different order, for example reloaded from a Postgres `jsonb` column, which does not preserve key order, or rebuilt client-side before re-sending, was read as a forged history and rejected with `not-a-prefix`. Comparison is now order-insensitive (recursive key sort), so semantically equal messages match while genuinely different ones are still rejected. Rejection reasons now name the diverging field (`content`, `toolCallId`, `toolCalls[i].arguments`, ...).
