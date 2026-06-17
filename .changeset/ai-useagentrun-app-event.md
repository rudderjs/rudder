---
"@rudderjs/ai": patch
---

Add `onAppEvent` callback to `AgentStreamCallbacks` and `UseAgentRunOptions` so consumers can observe app-specific SSE events (e.g. a server-issued `run_started { runId }`) without consuming the response body twice.

- `AgentStreamCallbacks.onAppEvent?(event, data)` is fired from a new `default:` branch in `applyAgentSseEvent` for any event outside the standard protocol vocabulary; known-event behavior is unchanged.
- `UseAgentRunOptions.onAppEvent?` is forwarded into the internal callbacks built by the hook's `drive` loop, threading it through `driveAgentRun` -> `readAgentStream`.
