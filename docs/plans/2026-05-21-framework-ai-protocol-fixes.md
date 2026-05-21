# Framework AI protocol fixes

**Status:** OPEN 2026-05-21
**Scope:** `@rudderjs/ai` (`/Users/sleman/Projects/rudder/packages/ai/`)
**Source:** Senior-engineer code review pass, 2026-05-21
**Severity:** 5 findings — 1 Gemini tool-call protocol break, 1 OpenAI parallel-tool corruption, 1 cross-runtime safety (browser/RN), 1 silently-broken public API, 1 Anthropic 400-error trigger

The AI package is the largest single-feature surface in the framework (17K LOC) and recently completed A1-A7 + B1-B10 (per memory). These are stabilization fixes — the bones are good, but five protocol-level bugs slip through the type system because TS doesn't catch wire mismatches.

---

## Phase 1 — Gemini tool-result `name` field

**Severity:** high — Gemini tool round-trips are broken at the wire; model never gets results keyed to the function it called
**Effort:** ~30 min + test

### The bug

`packages/ai/src/providers/google.ts:274`:

```ts
functionResponse: { name: m.toolCallId ?? 'unknown', ... }
```

Gemini's protocol requires `functionResponse.name` to match the original `functionCall.name` (the function name like `"search"`), but the code sends the synthesized call id (`call_1234_abc`). Worse, the adapter itself *generates* the synthetic call id at lines 206 + 426 — so the receiving end has no way to recover the function name from the id.

No test exercises this round-trip (`rg "functionResponse" packages/ai/` returns one hit, none assert the `name` field).

### Fix

Store the function name on the `ToolCall` shape and look it up when emitting `functionResponse`. Either:

**Option A (cleanest)**: extend `ToolCall` with `name`:

```ts
interface ToolCall {
  id:        string
  name:      string  // <-- add
  arguments: Record<string, unknown>
}
```

Then in `toGeminiContents`, look up the originating assistant message by `toolCallId` and pull the `.name`:

```ts
const callName = findCallName(history, m.toolCallId)
functionResponse: { name: callName, response: m.content }
```

**Option B (smaller diff)**: pass an id → name map alongside the history when building Gemini contents. Less typed but contained.

Either way, add the round-trip test:

### Regression test

`providers/google.test.ts`:
```ts
it('round-trips tool calls with the function name, not the call id', async () => {
  const history = [
    { role: 'assistant', toolCalls: [{ id: 'call_abc', name: 'search', arguments: { q: 'x' } }] },
    { role: 'tool', toolCallId: 'call_abc', content: '[results]' },
  ]
  const contents = toGeminiContents(history)
  const fnResponse = contents[1].parts[0].functionResponse
  assert.equal(fnResponse.name, 'search')  // not 'call_abc'
})
```

---

## Phase 2 — OpenAI parallel tool-call arg-delta tracking

**Severity:** high — two parallel tool calls have their JSON arg streams concatenated into one partial; results in `{}` args or wrong args silently
**Effort:** ~1h + test

### The bug

`packages/ai/src/agent.ts:1681-1684`:

```ts
// when a tool-call-delta chunk carries only the arg JSON fragment:
const partial = Array.from(partialToolCalls.values()).pop()
partial.text += chunk.text
```

OpenAI streams parallel tool calls interleaved by `index` (each chunk has `tool_calls[i].index = 0 | 1 | 2 | ...`). The adapter at `providers/openai.ts:167-175` discards the index when emitting `tool-call-delta` chunks.

With ≥2 parallel tool calls, args from `index=1`'s delta land on `index=0`'s partial (or vice versa, depending on which was created most recently). `JSON.parse` either fails silently (line 1702 catches → `{}` args) or succeeds with wrong args (truncated JSON object that happens to parse).

### Fix

1. **Adapter passes index through StreamChunk**:

```ts
// providers/openai.ts
case 'tool_calls':
  yield {
    type: 'tool-call-delta',
    text: delta.function?.arguments ?? '',
    toolCallIndex: delta.index,  // <-- add
    toolCallId:    delta.id ?? undefined,
  }
```

2. **Agent loop appends by index**:

```ts
// agent.ts:1681
if (chunk.type === 'tool-call-delta') {
  const idx = chunk.toolCallIndex
  let partial = partialsByIndex.get(idx)
  if (!partial) {
    partial = { text: '', id: chunk.toolCallId }
    partialsByIndex.set(idx, partial)
  }
  partial.text += chunk.text
  if (chunk.toolCallId) partial.id = chunk.toolCallId
}
```

3. **Same `StreamChunk` shape extension goes into the types module**:

```ts
// types.ts
interface ToolCallDeltaChunk {
  type:           'tool-call-delta'
  text:           string
  toolCallIndex?: number   // optional for back-compat
  toolCallId?:    string
}
```

Other providers (Anthropic, Google) don't have an analogous concept (their tool calls come fully formed per block) — `toolCallIndex` is optional on the union.

### Regression test

```ts
it('parallel OpenAI tool calls do not cross-contaminate args', async () => {
  const stream = mockOpenAIStream([
    // index=0 tool call, args delta "{"
    { tool_calls: [{ index: 0, id: 'call_a', function: { name: 'search', arguments: '{' } }] },
    // index=1 tool call, args delta "{\"
    { tool_calls: [{ index: 1, id: 'call_b', function: { name: 'fetch',  arguments: '{\"' } }] },
    // index=0 continues "name":"foo"}
    { tool_calls: [{ index: 0, function: { arguments: '"name":"foo"}' } }] },
    // index=1 continues "url":"x"}
    { tool_calls: [{ index: 1, function: { arguments: 'url":"x"}' } }] },
  ])

  const result = await agent.streamToCompletion(stream)
  const calls = result.toolCalls
  assert.deepEqual(calls.find(c => c.id === 'call_a').arguments, { name: 'foo' })
  assert.deepEqual(calls.find(c => c.id === 'call_b').arguments, { url: 'x' })
})
```

---

## Phase 3 — `Buffer.from(...)` in runtime-agnostic main entry

**Severity:** high — first doc/image attachment in browser/RN/Electron renderer throws `ReferenceError: Buffer is not defined`
**Effort:** ~1h + extended isomorphic-check

### The bug

The framework documents (per memory: `project_client_runtime_strategy`) that `@rudderjs/ai` main entry is runtime-agnostic (browser/RN/Electron renderer). The `isomorphic-check.test.ts:15` enforces this — but only via regex against `import 'node:...'` statements. It doesn't catch *global* usage.

Four sites use `Buffer.from(...)` in the main entry:
- `packages/ai/src/providers/anthropic.ts:185`
- `packages/ai/src/providers/openai.ts:208`
- `packages/ai/src/providers/google.ts:245`
- `packages/ai/src/image.ts:103,107`

All four run in `contentTo*Parts` paths that fire on the first document or image attachment.

### Fix

Use the existing `base64.ts` `globalThis.Buffer ?? atob` pattern uniformly. Likely there's already a `toBase64()` / `fromBase64()` helper there — if so, route the four sites through it.

If `base64.ts` doesn't expose the right helper yet:

```ts
// base64.ts
export function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64')
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

export function base64ToBytes(base64: string): Uint8Array {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(base64, 'base64'))
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}
```

Then extend the isomorphic check to flag `\bBuffer\b` outside `/node`, `/server`, and `base64.ts`:

```ts
// isomorphic-check.test.ts
const BUFFER_USAGE = /\bBuffer\b/
const EXCLUDED_PATHS = ['/node/', '/server/', 'base64.ts']

it('no Buffer references in runtime-agnostic code', () => {
  for (const file of allMainEntryFiles) {
    if (EXCLUDED_PATHS.some(p => file.includes(p))) continue
    const src = readFileSync(file, 'utf8')
    assert.equal(BUFFER_USAGE.test(src), false, `${file}: contains \`Buffer\` reference`)
  }
})
```

### Regression test

The extended isomorphic-check is itself the regression test. It would fail today on the four sites listed above; after fix, it passes.

Bonus: add a browser/RN smoke test that mounts the AI provider with an image attachment and asserts no `ReferenceError`. Likely a deferred follow-up (needs jsdom or happy-dom infra — the framework still doesn't have it).

---

## Phase 4 — `AI.embed({ cache: true })` cache keying

**Severity:** medium — silently broken public API; users opt into caching and get zero cache hits
**Effort:** ~15 min + test

### The bug

`packages/ai/src/facade.ts:127-130`:

```ts
const inner = factory.createEmbedding(modelId)
const cached = AI.cachedAdapters.get(inner)  // WeakMap<EmbeddingAdapter, CachedEmbeddingAdapter>
if (cached) return cached
const newCached = new CachedEmbeddingAdapter(inner)
AI.cachedAdapters.set(inner, newCached)
return newCached
```

Every call constructs a fresh `inner` adapter. The `WeakMap.get(inner)` lookup always misses (different identity each call). A brand-new `CachedEmbeddingAdapter` is constructed with an empty cache. `cache: true` is effectively a no-op.

### Fix

Key the cache by `(providerName, modelId)` string, not adapter identity:

```ts
const cacheKey = `${providerName}::${modelId}`
let cached = AI.cachedAdapters.get(cacheKey)
if (!cached) {
  const inner = factory.createEmbedding(modelId)
  cached = new CachedEmbeddingAdapter(inner)
  AI.cachedAdapters.set(cacheKey, cached)
}
return cached
```

Update `AI.cachedAdapters` type from `WeakMap<EmbeddingAdapter, CachedEmbeddingAdapter>` to `Map<string, CachedEmbeddingAdapter>`.

Note: this also fixes the documented "process-wide unscoped state" yellow item — the cache is no longer keyed on identity, so we can tie its lifetime to `AiRegistry` reset (call `AI.cachedAdapters.clear()` from `AiRegistry.reset()`).

### Regression test

```ts
it('embed({ cache: true }) actually caches across calls', async () => {
  let networkCalls = 0
  const fakeAdapter = {
    embed: async (text) => { networkCalls++; return [0.1, 0.2] },
  }
  registerFakeProvider('test', fakeAdapter)

  const a = await AI.embed({ provider: 'test', model: 'm', input: 'hello', cache: true })
  const b = await AI.embed({ provider: 'test', model: 'm', input: 'hello', cache: true })

  assert.deepEqual(a, b)
  assert.equal(networkCalls, 1, 'second call should hit cache')
})
```

---

## Phase 5 — `resume-approval.ts` orphan tool_use synthesis

**Severity:** medium — when approval is pending on tool N of M, tools N+1..M never get tool messages; next Anthropic request 400s with "tool_use must have matching tool_result"
**Effort:** ~30 min + test

### The bug

`packages/ai/src/resume-approval.ts:70-75` iterates an assistant message's pending `toolCalls` and `break`s on the first `pending`-status call. Tool calls *after* that one in the same assistant message never receive any tool message in the persisted history.

Anthropic specifically rejects the next request because every `tool_use` in an assistant message must have a matching `tool_result` block.

The serial tool-phase path at `tool-execution.ts:170` has the same iteration shape but synthesizes "skipped" tool results when handing off — approval-resume just doesn't.

### Fix

After breaking out of the loop on the first pending tool call, synthesize placeholder tool messages for any unfulfilled siblings:

```ts
for (let i = 0; i < assistantMsg.toolCalls.length; i++) {
  const call = assistantMsg.toolCalls[i]
  const decision = approvals[call.id]
  if (!decision) {
    // Append a "still pending" placeholder for ALL remaining siblings, including this one
    for (let j = i; j < assistantMsg.toolCalls.length; j++) {
      history.push({
        role:       'tool',
        toolCallId: assistantMsg.toolCalls[j].id,
        content:    'Tool call pending user approval — execution deferred.',
        _pending:   true,  // marker so the next-pause loop knows to revisit
      })
    }
    break
  }
  // … handle approved/denied as before
}
```

The `_pending: true` marker lets the next iteration of the agent loop detect that these placeholder messages need to be replaced when approval lands — the loop should strip them before re-prompting and re-emit the pending-approval pause.

### Regression test

```ts
it('multi-tool approval with one pending preserves tool_use coverage', async () => {
  const assistantMsg = {
    role: 'assistant',
    toolCalls: [
      { id: 'a', name: 't1', arguments: {} },
      { id: 'b', name: 't2', arguments: {} },
      { id: 'c', name: 't3', arguments: {} },
    ],
  }
  const approvals = { a: 'approved' }  // b and c not decided yet

  const history = await resumeApproval([assistantMsg], approvals)
  const toolMsgs = history.filter(m => m.role === 'tool')

  // Every tool_use must have a matching tool message — even the pending ones
  assert.equal(toolMsgs.length, 3)
  assert.equal(toolMsgs.find(m => m.toolCallId === 'a').content, '<approved result>')
  assert.ok(toolMsgs.find(m => m.toolCallId === 'b')._pending)
  assert.ok(toolMsgs.find(m => m.toolCallId === 'c')._pending)
})
```

---

## Notable (yellow — track and decide, not in this sweep)

- **`finishReason` collapsed to `'stop' | 'tool_calls'`** in every adapter (anthropic.ts:134, openai.ts:180, google.ts:217, bedrock.ts:236). `length`, `content_filter`, `max_tokens` truncation all flattened. The `FinishReason` union in `types.ts:56` already includes the right values — just unused. Apps can't detect "output truncated" → confused error UX.
- **`zod-to-json-schema.ts` drops `.describe()` on composite types** (object/array/enum/union/literal/default/record/nullable). Tool authors lose schema annotations on non-scalar fields. Missing types: `intersection`, `tuple`, `lazy`, `discriminatedUnion`, `refine`/`effects` — silently fall through to `{ type: 'string' }`.
- **`zod-to-json-schema.ts` emits OpenAPI-3.0 `nullable: true`** (line 65). Tool-call validation runs JSON Schema draft-07; `nullable` is ignored. Should be `type: ['x', 'null']` or `anyOf: [..., { type: 'null' }]`.
- **`toVercelDataStream` drops `'tool-result'` chunks** (`vercel-protocol.ts:39-41`). Vercel UIs see tool calls without their results. `'pending-client-tools'`, `'pending-approval'`, `'handoff'`, `'tool-update'` also dropped. Approval flow can't work over Vercel protocol.
- **`AbortSignal` never reaches tool `execute()`**. `ToolCallContext` carries only `toolCallId`. Long-running tools can't honor `agent.prompt(..., { signal })`. Loop only checks signal between iterations.
- **Parallel tool dispatch races on `loopCtx.pendingApprovalToolCall`** (`tool-execution.ts:545`). Two concurrent tools yielding `pauseForApproval` — last write wins, only one approval surfaces.
- **`applyToModelOutput` fallback crashes on circular refs / BigInt** (`tool-helpers.ts:96-98`). Wrap in try/catch with `String(value)` as final safety net.
- **`AiRegistry.resolve()` re-instantiates adapter every prompt** (`registry.ts:101-105`). SDK client re-instantiated per call (its `getClient()` cache is per-adapter). Compounds in `runFailover` retry loops.
- **Google streaming emits non-stable synthetic ids per chunk** (`providers/google.ts:206`). If `@google/genai` splits a `functionCall` across stream chunks, the agent treats them as two distinct tool calls.
- **Stream provider failover not actually reachable** (`agent.ts:1148-1163`). Mid-stream errors fire on the consumer's `for await`, not in `runFailover`. Only pre-first-yield errors trigger failover.

---

## Suggested PR order

All five phases are independent and small. Ship in any order:

1. **Phase 1** — `fix(ai): Gemini tool-result name uses function name not call id` (changeset patch)
2. **Phase 2** — `fix(ai): track OpenAI parallel tool-call args by index` (changeset patch)
3. **Phase 3** — `fix(ai): no Buffer in runtime-agnostic main entry` (changeset patch + isomorphic-check extension)
4. **Phase 4** — `fix(ai): AI.embed cache keying by (provider, model)` (changeset patch)
5. **Phase 5** — `fix(ai): synthesize pending tool messages on partial approval` (changeset patch)

Phase 3 is the only one with infra changes (test runner). Phase 1 and Phase 2 are the only items that fix protocol-level breaks. Phase 4 is the easiest credibility win.

---

## Strengths noted (context)

- Tight escape-hatch discipline — only 5 `as any` / `@ts-ignore` across 17K LOC, all in `zod-to-json-schema.ts` (justified — walking `_def`) plus a single comment.
- Anthropic stream-usage state machine correctly handles split prompt/completion events (memory: `feedback_anthropic_stream_token_protocol`). `mergeUsage` MAX-per-field invariant defends against bad emitters.
- Runtime-agnostic split discipline (`/node` / `/server` / `/mcp` / `/memory-orm` / `/budget-orm` / `/eval`) is well-separated. `package.json` `providerSubpath` wiring auto-discovery to the right export. The Buffer issue (Phase 3) is the only gap in the otherwise-rigorous separation.
- Bedrock-Anthropic event mapper factored out as `mapBedrockAnthropicEvent` instead of duplicating Anthropic's parser — future model families drop in cleanly.
- `LoopContext` + shared `initializeLoop` / `runIterationPrelude` unifies `prompt()` and `stream()` control flow without duplicating middleware/observer/cache logic.
- `asTool` + `Agent.resumeAsTool` symmetric pause-kinds (client_tool vs approval) is genuinely sophisticated. Forgery guards rigorous.
- Suspend-without-streaming fails at builder time (`agent.ts:339`) — "loud failure now beats silent failure later" is the right posture.
