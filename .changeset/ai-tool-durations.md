---
'@rudderjs/ai': patch
---

Fill in the previously-hardcoded `0` for `AiObserverStep.toolCalls[].duration` in agent observer events. The agent loop now wraps each tool's `execute` in a `performance.now()` pair and surfaces the wall-clock duration through `ToolResult.duration` (new, optional field). Telescope/Pulse now show meaningful per-tool latency instead of a flat 0ms.

Captured for both success and error paths in the streaming and non-streaming loops. Paths where no `execute` ran (unknown tool, rejected, middleware-skipped, validation failure, client-tool placeholder) report `0` since there is nothing to time.
