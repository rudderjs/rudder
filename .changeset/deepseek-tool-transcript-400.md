---
'@rudderjs/ai': patch
---

fix(ai): normalize tool-call/tool-result adjacency before OpenAI-compatible wire calls

Strict OpenAI-protocol providers (DeepSeek, OpenRouter, Azure, OpenAI) reject a `messages` array where a `role:'tool'` message does not immediately follow its parent `assistant`+`tool_calls`, or where a `tool_calls` entry goes unanswered — surfacing as `400 Messages with role 'tool' must be a response to a preceding message with 'tool_calls'`. A persist→resume cycle (client-tool pause, approval round-trip, or an app that re-stores assistant turns without their `toolCalls`) could produce such a transcript. Anthropic was unaffected because it carries tool results inside user turns.

`toOpenAIMessages` now runs a bidirectional repair pass (`normalizeToolTranscript`): detached/out-of-order results are pulled adjacent to their parent, unanswered `tool_calls` get a synthesized stub result, and orphan results (no declaring assistant) are dropped. Already-valid transcripts pass through unchanged.
