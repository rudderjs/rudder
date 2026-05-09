---
'@rudderjs/ai': minor
---

Add `Agent.asTool()` for the subagents pattern. Wrap any agent as a tool another agent can call: `new ResearchAgent().asTool({ name: 'research', description: '...' })`. Defaults to `{ prompt: string }` input schema and feeds only `response.text` to the parent model on its next step (the UI still sees the full `AgentResponse`). Pass `inputSchema` + `prompt` for a typed input shape.
