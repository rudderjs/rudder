# AI Loop Parity Plan

Close the three remaining gaps between `@rudderjs/ai` and the Vercel AI SDK / TanStack AI loop, treating them as one coherent multi-phase initiative because they share data flow: a server tool produces preliminary output → that output flows through the agent stream → the browser renders it as a UI component.

**Status:** **DONE 2026-04-09.** All four phases shipped (PRs #10 / #11 / #12 / #13). Verified end-to-end against the playground:
- Phase 1 — generator yields surface as `tool-update` chunks (slow_search smoke test)
- Phase 2 — `.modelOutput()` decouples model-input from UI/result (`PHASE2_OK` smoke test)
- Phase 3 — SSE forwarding + renderer registry wired through to the chat UI
- Phase 4 — `runAgentTool` migrated, bypass deleted, `AgentRunRenderer` rendering live updates inline

Caught + fixed during execution:
- `.server()` overload-order bug (commit `13211090`) — TS bound `TReturn = AsyncGenerator<...>` for plain-async overload first, breaking chained `.modelOutput(result => ...)`. Fixed by reordering overloads + regression test.
- `loadAi()` lazy-import declares `toolDefinition: any` to keep `@rudderjs/ai` from being a hard type dep, which strips chained-builder return types in panels. Worked around in `runAgentTool.ts` with an explicit `r: RunAgentResult` annotation. Proper fix (typing `loadAi()`'s return value) deferred as a separate cleanup.
- Plan-doc deviations from actual codebase: SSE forwarding lives in `agentStream/index.ts` (not `chatHandler.ts`) since `standalone-client-tools-plan` Phase 1 extracted it; builder method renamed `.toModelOutput(fn)` → `.modelOutput(fn)` because the original name collides with the `Tool.toModelOutput` field on the same class.

Surfaced (NOT fixed — pre-existing, separate scope): when a sub-agent invoked via `run_agent` calls a client tool like `update_form_state`, the sub-agent loop runs in placeholder mode and the browser never executes the tool. The model thinks the call succeeded but the form never changes. R7-adjacent. Tracked as `bug_subagent_client_tools` in memory.

**Packages affected:** `@rudderjs/ai` (types, agent loop, tool builder), `@rudderjs/panels` (agentStream forwarder, AiChatContext, chat UI registry, runAgentTool, AgentRunRenderer)
**Depends on:**
- `mixed-tool-continuation-plan.md` (DONE 2026-04-08) — this plan extends the same SSE protocol with a new event class
- `standalone-client-tools-plan.md` (DONE 2026-04-08) — restored standalone field AI actions before this plan started, so chat machinery wasn't built on misrouted actions

**Related memory:** `project_ai_loop_parity.md`, `project_ai_system_identity.md`, `feedback_inline_over_modal.md`, `feedback_authoring_streaming_tools.md`, `bug_subagent_client_tools.md`

---

## Goal

After this plan, three things are true:

1. A server tool can be authored as an `async function*` and `yield` partial updates while it runs. The yields flow through the agent stream as first-class chunks, get forwarded over SSE, and become live UI updates in the chat — without each tool having to invent its own `send()` side channel.

2. A tool definition can declare a `toModelOutput(result)` transform so the value the **parent model** sees on its next step can differ from the value the **UI** sees in the tool result chunk. This unlocks summarization of subagent runs, redaction of large/binary outputs, and "model sees text, UI sees component" patterns.

3. A panels chat UI can register **client-side renderers** keyed by tool name. When a `tool-result` (or preliminary `tool-update`) chunk arrives for a tool with a registered renderer, the chat bubble renders that component inline instead of (or in addition to) a default JSON pill — this is generative UI.

The reference benchmark is the existing `runAgentTool` (`packages/panels/src/handlers/chat/tools/runAgentTool.ts`), which today bypasses the agent stream by calling `send('agent_start', ...)` directly inside its `execute` body. After this plan, that bypass should be deletable: the same effect should be achievable by `yield`ing from an async-generator `execute`.

---

## Non-Goals

- **Replace the Vercel data-stream protocol exporter.** `vercel-protocol.ts` stays a one-way export shim; we are not adopting Vercel's wire format internally.
- **Build a generic "AI Elements" component library.** Renderers are owned by application code (panels, in this repo). We provide the registry + the data flow, not a catalog of pre-built UI.
- **Server-side React rendering of tool components.** Renderers are pure client-side React. Tool *output* may be a structured payload (object), but the rendering happens in the browser.
- **Streaming structured-output (`outputSchema`) generation.** That is a provider-level concern (partial JSON parsing during model output), distinct from streaming tool *execution*. Out of scope.
- **Change the agent class API surface.** `Agent`, `tools()`, `prepareStep`, `stopWhen`, middleware, etc. all stay as they are. New surface area is on `Tool` (one new optional builder method, one new optional definition field) and on `StreamChunk` (one new chunk type).
- **Subagent identity / tracing.** `runAgentTool` already emits `agent_start` / `agent_complete` events. We replace the *transport* (raw `send` → `yield`) but do not redesign what those events mean.
- **Panels-side approval UI for streaming tools.** `needsApproval` interactions are unchanged.

---

## Background

### What the agent loop does today

`packages/ai/src/agent.ts` runs server tools as single `await tool.execute(args)` calls in both `runAgentLoop` (`:546`) and `runAgentLoopStreaming` (`:849`). The result is:

- Stringified once via `typeof result === 'string' ? result : JSON.stringify(result)`
- Pushed to `messages` as a `{ role: 'tool', content, toolCallId }` (this is what the next model step sees)
- Pushed to `step.toolResults` (this is what `AgentResponse` exposes)
- In streaming mode, also yielded as a single `{ type: 'tool-result', toolCall, result }` chunk — the same value goes to both the UI and the next model step

There is **one value** for both audiences and **one moment** at which it materializes (after the tool finishes).

### How tools route partial state today

Tools that need to surface in-flight progress have to inject a transport into their closure. `runAgentTool` is the canonical example:

```ts
buildRunAgentTool(agents, agentCtx, message, send) // ← `send` is an SSE writer
  ...
  return toolDefinition({...}).server(async (input) => {
    send('agent_start', {...})
    for await (const chunk of agentStream) {
      if (chunk.type === 'tool-call') send('tool_call', {...})
    }
    send('agent_complete', {...})
    return `Agent "..." completed successfully. ${result.text}`
  })
```

This works but has four problems:

1. **Tools cannot be authored without knowing the transport.** The tool has to be built per-request inside the chat handler so it can close over `send`. It cannot live alongside other tools that are built once.
2. **The agent loop is bypassed.** Middleware (`onChunk`, `onAfterToolCall`) never sees the progress events.
3. **The Vercel data-stream exporter sees nothing.** Anyone consuming `toVercelDataStream` to integrate with non-panels frontends gets only the final string.
4. **Conversation persistence sees only the final string.** That's actually the right behavior in this case — but it's right *by accident*: today there's no other choice. If we want partial-state events to ever be persistable in the future, they need to live in the same stream as everything else, not in a parallel side channel.

### How the chat UI consumes tool results today

`packages/panels/pages/_components/agents/AiChatContext.tsx` (~870 LOC) reads SSE events and builds a `wireMessagesRef` that mirrors persisted state. Tool results show up as plain text (the `content` field of the `tool` SSE event). There is no notion of a typed component rendered for a specific tool. `AgentOutput.tsx` is the closest thing — it has a hard-coded `if (toolData.tool === 'update_field') ...` branch — which is exactly the kind of switch statement a registry replaces.

### What Vercel AI SDK does

Two relevant pieces of their loop API:

```ts
tool({
  inputSchema: z.object({...}),
  execute: async function* (input) {
    yield { state: 'searching', query: input.q }    // preliminary
    const results = await search(input.q)
    yield { state: 'ranking', count: results.length } // preliminary
    return results                                     // final
  },
  toModelOutput: (result) => `Found ${result.length} results: ${result.slice(0,3).map(r => r.title).join(', ')}`,
})
```

- The `async function*` execute lets the tool emit preliminary states. Each yield becomes a stream chunk the UI can render.
- `toModelOutput` decouples "what the UI gets" (the full `results` array) from "what the next model step sees" (a short summary). This is critical for subagents — you don't want to dump 50KB of subagent transcript back into the parent model's context.
- Generative UI on the React side is then `useChat`'s `addToolResult` + a switch keyed by tool name; no formal registry exists in their API but the pattern is well-known.

### Why all three gaps are one plan

If we ship just async-generator execute, the tool can stream progress *but the model still sees the same content the UI does* — which means streaming a 1MB binary subagent result blows up the next model step. We need `toModelOutput` to decouple the two channels.

If we ship just generator + `toModelOutput`, the panels chat UI has a new chunk type (`tool-update`) but no way to render it except as raw JSON. The whole point of streaming tool progress is to render it as something a user can read — that's the renderer registry.

So all three land together, in the order: chunk type → tool builder API → SSE forwarding → UI registry → migrate `runAgentTool` → delete the bypass.

---

## Approach Decisions

### D1: Async-generator vs. callback parameter

**Decision:** Async-generator (`async function*`).
**Why:** Vercel chose generators because they're typed (the yield type and return type are different in TS), they work without injecting a transport into closure, and they compose with normal control flow (`try/finally`, `for await`, early `return`). A callback parameter (`execute: async (args, { yield }) => ...`) would also work but conflates the tool's closure with framework state. Generators also let us preserve a single exit point (`return value` is what goes to the model; `yield value` is what the UI sees) which keeps the type story clean.

### D2: Where preliminary updates land in the stream

**Decision:** A new `StreamChunk` type: `{ type: 'tool-update', toolCall, update }`.
**Why:** Reusing `tool-result` would conflict with the existing semantics — `tool-result` already implies "this is the value the model sees; persist it; the tool is done." Preliminary updates are none of those things. A new chunk type also lets the SSE handler emit a distinct event (`tool_update`), which the browser can route to renderers without misinterpreting it as a final result.

### D3: Where `toModelOutput` is declared

**Decision:** A new optional field on `Tool`, exposed via a builder method `.toModelOutput(fn)`.
**Why:** It belongs on the tool definition (it's a property of the tool, not of any single call). A method on the builder keeps the existing chained-builder API style:

```ts
toolDefinition({...})
  .server(async function* (input) { yield {...}; return finalValue })
  .toModelOutput((finalValue) => 'short summary string')
```

### D4: What `toModelOutput` returns

**Decision:** A `string` (or `string | Promise<string>`). Not a structured `AiMessage`.
**Why:** Tool result messages currently have `content: string`. Letting `toModelOutput` return arbitrary content shapes would force changes through the entire `AiMessage` type and every provider adapter. A string covers the dominant use cases (summarize a subagent result, redact a binary, replace a structured object with `'OK'`) and can be lifted later if a real need emerges. **Default behavior** when `toModelOutput` is absent is unchanged: stringify the same way we do today.

### D5: Where the renderer registry lives

**Decision:** In `packages/panels/pages/_components/agents/`, parallel to `clientTools.ts`, named `toolRenderers.ts`. Same `register*` / `Map<string, Renderer>` shape.
**Why:** It's a panels concern, not an `@rudderjs/ai` concern. `@rudderjs/ai` produces stream chunks; panels decides how to render them. Putting the registry in `@rudderjs/ai` would couple the loop package to React. The shape mirrors `clientTools.ts` deliberately so the mental model is consistent: "tools you author on the server, renderers you author on the client, both keyed by tool name."

### D6: Persistence semantics for `tool-update`

**Decision:** Do NOT persist `tool-update` chunks. They are ephemeral, like text deltas during streaming.
**Why:** Preliminary states are interesting *while* the tool is running. Once the final result arrives, the model only ever sees the final value (or `toModelOutput(finalValue)`). Replaying a conversation should not replay a stale "searching..." state. The persistence layer (`persistence.ts`) continues to write only the final tool result to the conversation store. The browser's `wireMessagesRef` already only includes `tool-result` events, not `tool-update`, so the continuation prefix check is unaffected.

### D7: Backwards compat

**Decision:** Both new features are purely additive. A tool with a regular `async` execute, no `toModelOutput`, behaves exactly as today. No deprecations.

---

## Phase Breakdown

Ordered so each phase is independently testable and the next phase has its dependency landed.

### Phase 1 — `tool-update` chunk type and async-generator execute (`@rudderjs/ai`)

**Files:**
- `packages/ai/src/types.ts`
- `packages/ai/src/tool.ts`
- `packages/ai/src/agent.ts` (both loops)
- `packages/ai/src/index.test.ts`

**Changes:**

1. `types.ts` — Extend `StreamChunk['type']` union with `'tool-update'`. Add an optional field `update?: unknown` to the `StreamChunk` interface. Document it as "preliminary tool progress; not persisted; not seen by the model."

2. `types.ts` — Extend `ToolExecuteFn` to allow returning `AsyncGenerator<TUpdate, TOutput>` in addition to `TOutput | Promise<TOutput>`. Add a `TUpdate` type parameter (defaulting to `unknown`) on `Tool`, `ToolExecuteFn`, and `ToolBuilder`. Concretely:

   ```ts
   export type ToolExecuteFn<TInput = unknown, TOutput = unknown, TUpdate = unknown> =
     (input: TInput) => TOutput | Promise<TOutput> | AsyncGenerator<TUpdate, TOutput, void>
   ```

3. `tool.ts` — `ToolBuilder.server` already accepts `execute`. No signature change needed at the call site for the common case (TS infers `TUpdate = unknown`); the only addition is that the type now permits async generators. Add type tests in `index.test.ts` to confirm a generator-returning execute is accepted.

4. `agent.ts` — In `runAgentLoopStreaming` (the only loop that streams; the non-streaming loop drains the generator silently — see step 6), the tool-call inner block currently does:

   ```ts
   const result = await tool.execute(toolArgs)
   ```

   Replace with a helper `executeMaybeStreaming(tool, toolArgs)` that detects an async iterator on the return value and, if present, iterates yielding `{ type: 'tool-update', toolCall: tc, update }` chunks for each yield, then captures the generator's `return` value as the final `result`. Otherwise behaves exactly as `await`.

5. `agent.ts` — When yielding `tool-update`, also pass through `runOnChunk` so middleware sees it. No new middleware hook is added (`onChunk` is sufficient).

6. `agent.ts` — In the non-streaming `runAgentLoop`, an async-generator execute is still allowed: drain it with `for await` and discard yields (or collect them into a debug-only field; see Open Questions). The final value is the generator's `return`. Rationale: the same tool definition should work in both `prompt()` and `stream()` modes.

7. Tests in `index.test.ts`:
   - Generator tool yields three values; assert that the stream emits exactly three `tool-update` chunks with the right `update` payload, followed by one `tool-result` chunk with the return value.
   - Generator tool used with `agent.prompt()` (non-streaming): assert the return value is captured and yields are silently drained.
   - Middleware `onChunk` sees `tool-update` chunks.

**Done when:** Tests pass; `pnpm --filter @rudderjs/ai build && pnpm --filter @rudderjs/ai test` is green.

**Estimated LOC:** ~120

---

### Phase 2 — `toModelOutput` on tool definitions (`@rudderjs/ai`)

**Files:**
- `packages/ai/src/types.ts`
- `packages/ai/src/tool.ts`
- `packages/ai/src/agent.ts` (both loops)
- `packages/ai/src/index.test.ts`

**Changes:**

1. `types.ts` — Add `toModelOutput?: (result: TOutput) => string | Promise<string>` to `Tool<TInput, TOutput>`. (Decision D4: string only.)

2. `tool.ts` — Add a chained method on `ToolBuilder`. Because `.server(execute)` currently returns `Tool<...>` (not a builder), we have two options:
   - **Option A:** Make `.server(execute)` return a richer builder that exposes `.toModelOutput(fn)` which finalizes to `Tool`.
   - **Option B:** Accept `toModelOutput` as a second argument to `.server()`, e.g. `.server(execute, { toModelOutput: ... })`.

   **Choosing Option A** because it preserves the chained-builder ergonomics that match `.server()` itself, and because a future `.onError(...)` or `.middleware(...)` would slot in the same way. Concretely: introduce a `ServerToolBuilder<TInput, TOutput>` that wraps the resolved `Tool` and exposes `.toModelOutput(fn)` returning a new `Tool` with the field populated. The builder is still a valid `Tool` (implements the interface), so `tools()` arrays accept it without an extra `.build()` call.

3. `agent.ts` — In both loops, after a tool's final value is captured (whether from `await` or from a generator's return), apply `tool.toModelOutput?.(value) ?? defaultStringify(value)` when constructing the `tool` role message that gets pushed to `messages`. The `step.toolResults` and the `tool-result` chunk both still carry the *original* `result` value (so the UI sees the rich data); only the message that goes to the next model step uses the transformed string.

4. Tests in `index.test.ts`:
   - Tool returns `{ items: [...] }`, declares `toModelOutput: r => "${r.items.length} items"`. Assert the next model step's `messages` last entry has the short string. Assert the `tool-result` chunk and `step.toolResults[0].result` carry the original object.
   - Tool with no `toModelOutput` is unchanged (regression test).

**Done when:** Tests pass; the existing `runAgentTool` could (in principle) declare `toModelOutput: r => 'Agent finished.'` and the parent loop would no longer have the full agent transcript stuffed into its context.

**Estimated LOC:** ~80

---

### Phase 3 — SSE forwarding and panels renderer registry (`@rudderjs/panels`)

**Why a registry (and not Vercel's inline-switch pattern):** RudderJS uses the registry pattern as its default extension mechanism — there are ~30 registries across the monorepo (`CacheRegistry`, `StorageRegistry`, `PanelRegistry`, `FormRegistry`, `ModelRegistry`, etc.), and the closest siblings (`clientTools.ts`, `lexicalRegistry.ts`) live in the **exact same folder** as where `toolRenderers.ts` will go. Vercel renders tool UIs with an inline JSX switch inside the chat component, which is simpler but **closes the extension surface** — adding a new tool UI means editing the framework's chat component. The registry keeps the surface open: a downstream package (e.g. a hypothetical `@rudderjs/blog-ai`) can ship its own tool *and* its own renderer, register both from a service provider's `boot()`, and have them appear in the chat without forking `@rudderjs/panels`. This is the same plug-and-play story Laravel packages get from Laravel's container, and it's the consistent mental model for any app dev who has already learned `registerClientTool`.

**Files:**
- `packages/panels/src/handlers/chat/chatHandler.ts`
- `packages/panels/pages/_components/agents/toolRenderers.ts` (new)
- `packages/panels/pages/_components/agents/AiChatContext.tsx`
- `packages/panels/pages/_components/agents/AiChatPanel.tsx` (renderer dispatch)

**Changes:**

1. `chatHandler.ts` — Add a `case 'tool-update':` branch in the SSE forwarding switch (currently lines 201–235). Emit a new SSE event:

   ```ts
   case 'tool-update':
     send('tool_update', {
       id:     chunk.toolCall?.id,
       tool:   chunk.toolCall?.name,
       update: chunk.update,
     })
     break
   ```

   Do NOT touch `persistence.ts`. Do NOT touch `continuation.ts`. `tool_update` events are not part of the persisted message list and not part of the prefix check. They are pure UI signal.

2. `toolRenderers.ts` — New file, ~60 LOC. Mirror the shape of `clientTools.ts`:

   ```ts
   export type ToolRenderer = (props: {
     toolCallId: string
     args:    unknown
     updates: unknown[]      // accumulated tool-update payloads, in order
     result?: unknown        // present once tool-result arrives
     status:  'running' | 'complete' | 'error'
   }) => React.ReactNode

   export function registerToolRenderer(name: string, renderer: ToolRenderer): () => void
   export function getToolRenderer(name: string): ToolRenderer | undefined
   export function hasToolRenderer(name: string): boolean
   ```

   Components register renderers in a `useEffect`, just like `registerClientTool`.

3. `AiChatContext.tsx` — In the SSE event reader (the same area that handles `tool_call`, `tool_result`, `pending_client_tools`), add a `case 'tool_update':` branch that pushes the update payload onto an in-memory map keyed by `toolCallId`. This map needs to survive across renders for the assistant message currently being streamed. Concretely, extend the existing per-message tool-call state shape with `updates: unknown[]`. When a `tool_update` event arrives, append to `updates[toolCallId]`. When a `tool_result` event arrives for the same id, mark the entry complete.

   Expose the map (or per-tool-call state) on the assistant message object that `AiChatContext` already builds for the chat UI. The exact shape is whatever `AiChatPanel` currently consumes for tool calls plus an `updates` array and a `status` field.

4. `AiChatPanel.tsx` — Where tool calls are currently rendered (the chat bubble), add a lookup: `const Renderer = getToolRenderer(toolCall.name)`. If a renderer exists, render `<Renderer toolCallId={...} args={...} updates={...} result={...} status={...} />`. Otherwise fall back to the existing default rendering. This is a pure additive branch; no existing tool's UI changes unless someone registers a renderer for it.

5. **No changes** to `clientTools.ts`, `lexicalRegistry.ts`, `updateFormStateHandler.ts`. These are about *executing* client tools, not rendering tool *output*.

**Done when:** A throwaway test renderer registered against any tool name shows up in the chat bubble; `pnpm rudder vendor:publish --tag=panels-pages --force` from playground/ deploys updated bundles (per `feedback_panels_pages_parallel_copy.md`).

**Estimated LOC:** ~180

---

### Phase 4 — Migrate `runAgentTool` and delete the bypass

**Files:**
- `packages/panels/src/handlers/chat/tools/runAgentTool.ts`
- `packages/panels/src/handlers/chat/chatHandler.ts` (cleanup the `send` plumbing into `buildRunAgentTool`)
- `packages/panels/pages/_components/agents/agentRunRenderer.tsx` (new — the inline progress UI)
- `packages/panels/pages/_components/agents/AiChatPanel.tsx` (register the renderer)

**Changes:**

1. `runAgentTool.ts` — Rewrite as an async generator. Stop accepting `send` as a parameter. The new shape:

   ```ts
   return toolDefinition({...}).server(async function* (input: { agentSlug: string }) {
     const targetAgent = ...
     yield { kind: 'agent_start', agentSlug, agentLabel }

     const { stream: agentStream, response: agentResponse } = await targetAgent.stream(agentCtx, message)

     for await (const chunk of agentStream) {
       if (chunk.type === 'tool-call') {
         yield { kind: 'tool_call', tool: chunk.toolCall?.name, input: chunk.toolCall?.arguments }
       }
     }

     const result = await agentResponse
     yield { kind: 'agent_complete', steps: result.steps.length, tokens: result.usage?.totalTokens ?? 0 }

     return { agentSlug, label: agentLabel, summary: result.text }
   }).toModelOutput((r) => `Agent "${r.label}" completed: ${r.summary}`)
   ```

   `buildRunAgentTool` no longer needs `send` in its closure, no longer needs `agentCtx`/`message` to be threaded as separate args (well, those are still inputs — but the `send` parameter goes away). Update the call site in `chatHandler.ts` to drop the `send` argument.

2. `agentRunRenderer.tsx` — New ~80 LOC component. Receives `updates` (the array of `{ kind: 'agent_start' | 'tool_call' | 'agent_complete', ... }` payloads in order) plus `status`. Renders an inline collapsible card showing:
   - Header with agent label and a spinner while running
   - Per-step list of tool calls observed
   - Token + step count once `agent_complete` arrives
   This replaces the current `AgentOutput.tsx` styling for the chat-embedded path. (`AgentOutput.tsx` itself may stay for the standalone agent runner used outside chat — confirm during implementation.)

3. `AiChatPanel.tsx` — Register `agentRunRenderer` against the `'run_agent'` tool name in a `useEffect`. The lookup added in Phase 3 will pick it up automatically.

4. Manual smoke test (record in the plan, not automated): in the playground, ask the assistant to run a resource agent. Verify the inline card streams updates as the agent progresses, and that the parent assistant message's next reply does NOT include the full agent transcript (because `toModelOutput` summarizes it).

**Done when:** `runAgentTool.ts` no longer imports `SSESend`; smoke test passes; the `send` parameter is removed from its signature.

**Estimated LOC:** ~150

---

## Total Estimated LOC

~530 across 4 phases.

| Phase | Package | LOC |
|---|---|---|
| 1 — tool-update chunk + generator execute | `@rudderjs/ai` | ~120 |
| 2 — toModelOutput | `@rudderjs/ai` | ~80 |
| 3 — SSE forwarding + renderer registry | `@rudderjs/panels` | ~180 |
| 4 — runAgentTool migration + reference renderer | `@rudderjs/panels` | ~150 |

Crosses two packages → matches the "plan doc warranted" criterion in `feedback_when_to_write_plan_doc.md`.

---

## Risks and Mitigations

**R1: Type inference for generator return type breaks existing tool definitions.**
The signature change to `ToolExecuteFn` adds a third type parameter. If TS can't infer `TUpdate = unknown` cleanly, every existing `.server(...)` call site will fail to type-check. Mitigation: add a default `TUpdate = never` (not `unknown`) so non-generator executes carry no update channel in their type. Verify with `pnpm typecheck` across the monorepo before merging Phase 1.

**R2: A misbehaving generator never returns.**
A tool that yields forever stalls the agent loop. This is no worse than a regular tool whose `await` never resolves, so no new mitigation is needed — but worth noting that `runOnAbort` middleware is still the escape hatch.

**R3: `tool-update` chunks pollute the Vercel data-stream exporter.**
`vercel-protocol.ts` switches on `chunk.type`. An unhandled `tool-update` would just be silently ignored, which is the right default (Vercel's protocol doesn't have a slot for it). Add an explicit `case 'tool-update': break;` to make the intent obvious.

**R4: Renderer registry collides with React rendering rules.**
The registry stores function references — fine. The lookup happens during render. The risk is that registering inside `useEffect` means the renderer isn't available on the *first* render of the message that triggers the tool. Mitigation: the renderer registration should happen at module load (top-level) for tools that always exist (`run_agent`), or in a parent `useEffect` that runs before the chat panel mounts. Document this in the registry file's header comment.

**R5: Updates accumulate unboundedly for long-running tools.**
A tool that yields 10,000 updates fills `updates[toolCallId]` in the chat context. Mitigation: cap the array length in the context reducer (e.g. last 200) and document the cap. Renderers that need every update should declare so explicitly.

**R6: `toModelOutput` runs synchronously inside the loop and can throw.**
Wrap the call in a try/catch; on error, fall back to `defaultStringify(value)` and surface the error via `runOnError` middleware so it's observable but not fatal.

**R7: Subagents-in-subagents (nested `tool-update`).**
If `runAgentTool`'s subagent itself uses a generator-execute tool, those updates surface in the subagent's stream — but the parent's `for await (const chunk of agentStream)` only forwards `tool-call` events today. Decide whether to also bubble up nested `tool-update` chunks. **Default for v1: do NOT bubble** — the subagent renderer summarizes its own progress, the parent only sees subagent-level events. Re-evaluate after the migration.

---

## Open Questions for Sign-Off

1. **Q1: `toModelOutput` return type — string only, or `string | ContentPart[]`?** — RESOLVED: **string only.** Multimodal (`ContentPart[]`) deferred as a future follow-up if a real need shows up. Matches D4.

2. **Q2: Does the non-streaming `runAgentLoop` need to expose generator yields?** — RESOLVED: **No, drain and discard.** Matches Vercel: `generateText` discards intermediate yields, only the final return value is captured. If a consumer needs to inspect yields, they should call `agent.stream()`.

3. **Q3: Should `tool-update` updates be typed?** — RESOLVED: **No, keep `update: unknown`.** Matches Vercel: yields are not threaded through a `TUpdate` generic. Renderers narrow at the use site with `as const` or in-component type guards.

4. **Q4: `AgentOutput.tsx` deletion or coexistence?** — RESOLVED: **Keep both paths.**
   Standalone field actions (button → result streams into the field, no chat) and chat are two distinct UX patterns and should stay distinct — Vercel's own guidance is that `useChat` / `useCompletion` / `useObject` are not meant to be combined. `AgentOutput.tsx` and the `/_agents/${agentSlug}` endpoint stay as the standalone path. The renderer registry in Phase 3 is **chat-only** — standalone field actions do not consume it.

   **Prerequisite cleanup (separate PR, not part of this plan):** field AI actions (summarize / expand / etc.) currently route through chat by injecting a synthetic user message. They need to be restored to the standalone path so the result streams directly into the field instead of into a chat bubble. Tracked separately; estimated ~150 LOC; should land **before** this plan to avoid building chat machinery on top of misrouted actions. See `feedback_standalone_field_actions_vs_chat.md`.

5. **Q5: Renderer registry — single global Map, or scoped to a chat instance?** — RESOLVED: **Global Map**, mirroring `clientTools.ts` shape. Rationale captured in Phase 3 header. RudderJS uses registries as its default extension mechanism (~30 of them across the monorepo); Vercel's inline-switch pattern would close the extension surface and break consistency with `clientTools.ts`/`lexicalRegistry.ts` in the same folder.

6. **Q6: PR bundling — one PR per phase, or bundle phases?** — RESOLVED: **One PR per phase.** Four PRs landing in order (Phase 1 → 2 → 3 → 4). Smaller PRs, easier review, easier bisect, each phase is independently useful.

---

## Out-of-Scope Follow-Ups (track separately if shipped)

- **Generative UI on the standalone (non-chat) agent runner.** `AgentOutput.tsx` is a different UI and a different SSE consumer; harmonizing it is its own task.
- **Streaming `outputSchema` partials.** When a tool returns structured output, stream partial JSON as it parses.
- **Bubble subagent `tool-update` chunks through the parent loop** (R7 above).
- **Persist a redacted form of `tool-update` history for debugging.** Not for the model, but for telescope/inspection. Belongs in the monitoring plan.
- **Memory/snapshot updates.** After Phase 4, update `project_ai_loop_parity.md` to mark all three gaps closed, and add a `feedback_*.md` entry about authoring streaming tools (canonical example: `runAgentTool`).

---

## Sign-Off Checklist

Before any code is written, confirm:

- [ ] D1–D7 decisions are accepted (or amended)
- [ ] Q1–Q6 open questions have answers
- [ ] Phase order is acceptable (one PR per phase, or bundled)
- [ ] No additional gaps from `project_ai_loop_parity.md` need folding in
