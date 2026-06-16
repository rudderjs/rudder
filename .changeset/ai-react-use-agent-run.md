---
'@rudderjs/ai': minor
---

feat(ai): `@rudderjs/ai/react` `useAgentRun` hook

Add a React client runtime over the named-event agent-SSE protocol (`readAgentStream`). `useAgentRun({ request, clientTools? })` drives a streamed agent run from a component: it returns `status`, an `outputs` transcript (text coalesced; tool calls/results, `approval_request`, handoff, error entries), `pendingClientTools`, `pendingApproval`, and `error`, plus imperative `run` / `respond` / `approve` / `reject` / `reset`. Client-tool pauses auto-resume when a `clientTools` resolver is supplied; approval gates always wait for an explicit decision.

React lives behind the new `@rudderjs/ai/react` subpath (peer `react>=19.2.0`, optional); the main entry stays runtime-agnostic, same split as `@rudderjs/sync/react`. The state machine and stream driver are exported framework-free — `driveAgentRun`, `executeClientTools`, `appendAgentOutput` — for non-React use and testing.
