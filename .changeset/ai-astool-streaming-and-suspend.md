---
'@rudderjs/ai': minor
---

`Agent.asTool()` — streaming + sub-agent suspend/resume (A2.5):

`asTool()` gains two new options that absorb ~700 LOC of bespoke sub-agent plumbing previously maintained downstream:

- **`streaming: true | (chunk) => SubAgentUpdate | null`** — surfaces inner-agent progress as `tool-update` chunks on the parent stream. The default projection emits `{ kind: 'agent_start' }` once, `{ kind: 'tool_call', tool, args }` per inner tool call, and `{ kind: 'agent_done', steps, tokens }` at the end. Pass a custom projector for different cadence (e.g. surfacing inner `text-delta` previews).
- **`suspendable: { runStore: SubAgentRunStore }`** — when the inner agent's model emits a *client* tool call (no `execute` — handled by the browser), the inner loop stops on `client_tool_calls`, the snapshot persists in the run store, the parent loop halts with the inner `pendingClientToolCalls`, and the wrapper yields `pauseForClientTools(pending, subRunId)`. Suspend without streaming throws at builder time.

```ts
import { Agent, CachedSubAgentRunStore } from '@rudderjs/ai'

const research = new ResearchAgent().asTool({
  name:        'research',
  description: 'Research with browser-side tools.',
  streaming:   true,
  suspendable: { runStore: new CachedSubAgentRunStore() },
})
```

New static `Agent.resumeAsTool(subRunId, clientToolResults, { runStore, agent })` is the host's continuation entry point — atomically consumes the snapshot, validates incoming tool-result ids against the pending set (forgery guard), appends them to the inner conversation, and re-runs the inner loop in `messages` mode. Returns `{ kind: 'completed', response }` or `{ kind: 'paused', subRunId, pendingToolCallIds }` for multi-pause flows.

New `SubAgentRunStore` interface and two impls ship in this release:

- **`InMemorySubAgentRunStore`** — `Map`-backed, single-process; fine for tests and single-worker dev.
- **`CachedSubAgentRunStore`** — lazy adapter on top of `@rudderjs/cache`. Cross-process / cross-restart when the cache is configured with redis. The cache module is loaded via dynamic `import('@rudderjs/cache')` only when first used, so `@rudderjs/ai`'s static-import surface stays zero-required-peer.

Hosts may implement their own (Redis directly, Prisma, etc.) by satisfying the interface.

The 1.2.0 zero-config `asTool({ name, description })` shape is unchanged — these options are purely additive.
