---
'@rudderjs/ai': minor
---

`handoff()` — control transfer between agents (A2):

`asTool()` lets a parent agent *call* a subagent and use its result. `handoff()` lets the parent *step out* — the child agent owns the rest of the conversation.

```ts
import { Agent, handoff } from '@rudderjs/ai'

class SalesAgent extends Agent {
  instructions() { return 'You handle pricing and plans.' }
}
class SupportAgent extends Agent {
  instructions() { return 'You triage bugs.' }
}

class TriageAgent extends Agent {
  instructions() { return 'Greet, then route to the right specialist.' }
  tools() {
    return [
      handoff(SalesAgent,   { when: 'pricing or sales questions' }),
      handoff(SupportAgent, { when: 'bug reports or technical issues' }),
    ]
  }
}

const r = await new TriageAgent().prompt('What does the Pro plan cost?')
console.log(r.text)         // SalesAgent's reply — TriageAgent's loop ended
console.log(r.handoffPath)  // ['TriageAgent', 'SalesAgent']
```

**Default behavior:**
- Tool name: `handoffTo${AgentClass.name}` (override via `name`).
- Description: `'Hand off the conversation to ${AgentClass.name}'` (+ `' for ${when}.'` if `when` is set; or fully replaced via `description`).
- Input schema: `{ message: string }` — the parent's model writes a transition prompt that becomes the child's first user message.
- Carried history: full conversation flows to the child; the parent's system message is stripped and the child prepends its own `instructions()`.
- Multi-hop is supported (Triage → Sales → Billing). Cycles are bounded by `MAX_HANDOFFS = 5`; exceeding throws a clear error.
- Sibling tool calls in the same step as a handoff are skipped with a synthetic `'Skipped: parent agent handed off to another agent.'` tool result so the message log stays well-formed for persistence/replay.
- Handoffs force serial dispatch (override of `parallelTools: true`) — running siblings concurrently while the parent is being torn down is wasted work.

**Streaming:** a new `'handoff'` `StreamChunk` is emitted right before control transfers, with `{ from, to, message? }` — UIs can render a transition indicator before the next agent's chunks arrive. The same `AsyncIterable<StreamChunk>` flows through every hop; the resolved `response` carries the merged final state.

**Response shape:**
- `text` — final text from the agent that produced the terminal answer.
- `steps` — every hop's steps merged in order.
- `usage` — summed across all hops.
- `finishReason` — the terminal hop's reason.
- `handoffPath` — chain of class names traversed (absent when no handoff occurred).

**Implementation notes:**
- Detection: handoff tools are tagged with `Symbol.for('rudderjs.ai.handoff')`. The loop checks via `isHandoffTool()` before the client-tool branch in `runToolPhaseSerial`.
- The non-streaming entry point now wraps `runAgentLoopOnce` and drives handoffs iteratively in `driveHandoffs`. The streaming entry point inlines the same iterative driver so chunks flow per-hop.
- New types: `HandoffTool`, `HandoffOptions`, `HandoffSpec`. New stream chunk: `type: 'handoff'` with `handoff: { from, to, message? }`. New optional field: `AgentResponse.handoffPath?: string[]`.

Distinct from `asTool()`:

|  | `asTool` (call-and-return) | `handoff` (control transfer) |
|---|---|---|
| Parent loop | continues | ends |
| Conversation owner | parent | child |
| Final `text` | parent's | last child in chain |
| Use case | "look something up" | "transfer to specialist" |
