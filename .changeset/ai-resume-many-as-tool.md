---
"@rudderjs/ai": minor
---

Add `Agent.resumeManyAsTool` for batch sub-agent resume.

When an orchestrator dispatches several sub-agents in one parent turn and more than one pauses on a client tool or approval gate, the host previously had to loop over the singular `Agent.resumeAsTool` and stitch the pending tool-call sets back together by hand. `resumeManyAsTool(requests, { runStore })` does that: it resumes each `(subRunId, agent)` snapshot and returns a combined result set.

```ts
const batch = await Agent.resumeManyAsTool(
  paused.map(p => ({ subRunId: p.subRunId, agent: rebuild(p), clientToolResults: results[p.subRunId], key: p.subRunId })),
  { runStore },
)
// batch.completed / batch.paused / batch.errors partition the outcomes;
// batch.pendingToolCallIds is the aggregated single round-trip; loop until batch.allCompleted.
```

Each request carries its own `agent` (the sub-agents may be different classes) plus optional `key` echoed back for correlation. Options: `onError: 'capture'` (default, a failed item becomes a `{ kind: 'error' }` outcome and the rest still resume) or `'throw'`; `concurrency: 'parallel'` (default) or `'serial'`. New exported types: `SubAgentResumeRequest`, `SubAgentResumeOutcome`, `SubAgentResumeManyOptions`, `SubAgentResumeManyResult`.
