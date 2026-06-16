---
"@rudderjs/ai": minor
---

Add a named-event SSE protocol for streaming an agent loop to a browser, as a sibling to the existing Vercel data-stream protocol.

`@rudderjs/ai` already ships `toVercelResponse()` (the numeric-prefix wire). For apps that want a plain `text/event-stream` with self-describing event names, this adds a matched server framer + browser reader so the wire vocabulary can never drift:

- Server: `toAgentSseStream(streaming)` / `toAgentSseResponse(streaming)` project an `agent.stream()` result onto named SSE events (`text`, `tool_call`, `tool_update`, `tool_result`, `pending_client_tools`, `tool_approval_required`, `handoff`) and a terminal `complete` event carrying `{ done, finishReason, awaiting, steps, usage }`, or an `error` event if the run throws.
- Browser: `readAgentStream(resp, callbacks?)` decodes the same events back into an accumulated `AgentStreamTurn` and fires per-event callbacks. `applyAgentSseEvent(...)` is exported for unit-testing the reducer, and `newAgentStreamTurn()` seeds an empty turn.

Runtime-agnostic (web globals only, no `node:` imports); shipped from the main entry. App-specific events (conversation ids, billing, sub-run fan-out) stay on a separate channel.
