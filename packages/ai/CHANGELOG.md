# @rudderjs/ai

## 1.16.0

### Minor Changes

- 8968835: feat(ai): non-destructive `load()` on `SubAgentRunStore`

  `SubAgentRunStore` gains an optional `load(subRunId)` that reads a paused sub-agent snapshot without deleting it, alongside the existing atomic `consume()`. Both reference implementations (`InMemorySubAgentRunStore`, `CachedSubAgentRunStore`) implement it.

  This is for hosts that need a validate-then-resume pre-flight: inspect a paused snapshot's `meta` (per-user / per-resource ownership, tool-result coverage) before handing the id to `Agent.resumeAsTool` / `resumeManyAsTool`, which own the single `consume`. Previously a host had to `consume` then re-`store` to peek, because the resume path consumes internally. `load` removes that round-trip.

  Additive and non-breaking: `load` is optional on the interface, so existing custom `SubAgentRunStore` implementations are unaffected, and the resume paths are unchanged (still `consume`). Mirrors the sibling `AgentRunStore.load`.

### Patch Changes

- a48a97a: feat(core): polish the dev-boot notices block

  Refines the non-fatal boot-notices output rendered during `pnpm dev`:

  - The notices block now prints AFTER the `App is ready` line as a trailing footnote, instead of being wedged above it.
  - The block header uses a solid triangle (`▲`, yellow) instead of the `⚠` warning glyph, which renders narrow/ragged in many monospace fonts; each notice row now leads with a yellow `→` arrow to echo the Vike/Rudder banner lines above it.
  - `@rudderjs/ai`'s provider-skip notice is shorter and points at where the key is really set: `<name> skipped, no API key (set it in .env)`.
  - `@rudderjs/auth` and `@rudderjs/passport` notice messages drop the em-dash so the block reads consistently.

  Dev-output only. Production still prints `[RudderJS] ready` and flushes notices.

- Updated dependencies [a48a97a]
  - @rudderjs/core@1.13.1

## 1.15.0

### Minor Changes

- 1d77656: feat(ai): thread correlation ctx into the streaming `ChunkProjector` on the resume paths

  `ChunkProjector` now receives an optional 2nd arg `ctx: { originalSubRunId, key? }` on the `resumeAsTool` / `resumeManyAsTool` streaming paths. A batch host fanning N paused sub-agents through one `resumeManyAsTool` call can now route each raw `StreamChunk` to the correct per-sub-agent channel directly from a side-effect projector (`streaming: (chunk, ctx) => { pumpToChannel(ctx.originalSubRunId, chunk); return null }`), instead of having the rich chunk data in the projector but the correlation only in `onUpdate`.

  Additive and non-breaking: `ctx` is optional, `defaultSubAgentProjector` ignores it, and every existing projector and `onUpdate` semantics are unchanged.

## 1.14.0

### Minor Changes

- e314cd6: Add a named-event SSE protocol for streaming an agent loop to a browser, as a sibling to the existing Vercel data-stream protocol.

  `@rudderjs/ai` already ships `toVercelResponse()` (the numeric-prefix wire). For apps that want a plain `text/event-stream` with self-describing event names, this adds a matched server framer + browser reader so the wire vocabulary can never drift:

  - Server: `toAgentSseStream(streaming)` / `toAgentSseResponse(streaming)` project an `agent.stream()` result onto named SSE events (`text`, `tool_call`, `tool_update`, `tool_result`, `pending_client_tools`, `tool_approval_required`, `handoff`) and a terminal `complete` event carrying `{ done, finishReason, awaiting, steps, usage }`, or an `error` event if the run throws.
  - Browser: `readAgentStream(resp, callbacks?)` decodes the same events back into an accumulated `AgentStreamTurn` and fires per-event callbacks. `applyAgentSseEvent(...)` is exported for unit-testing the reducer, and `newAgentStreamTurn()` seeds an empty turn.

  Runtime-agnostic (web globals only, no `node:` imports); shipped from the main entry. App-specific events (conversation ids, billing, sub-run fan-out) stay on a separate channel.

- 8f2982e: Add `sanitizeConversation()` and apply it in `OrmConversationStore.load()` so persisted histories are replay-safe.

  A conversation interrupted mid-turn (a crash after the assistant message persisted but before all of its tool-result rows landed) leaves a malformed graph in the store. Replaying it 400s: Anthropic rejects a dangling `tool_use` with no matching `tool_result`, and OpenAI-compatible providers (DeepSeek, OpenRouter, Azure) reject an orphan `role:'tool'` not preceded by `tool_calls`.

  `sanitizeConversation(messages)` walks the history and enforces the tool-call / tool-result invariant in both directions: complete tool turns are kept (results re-emitted in `toolCalls` order, one per call, extras dropped), dangling turns have their `toolCalls` stripped while preserving any text, and orphan tool results are dropped. It is pure and idempotent. `OrmConversationStore.load()` now applies it automatically; a custom `ConversationStore` can call the exported function from its own `load()`.

- 9eb2d7e: Add `@rudderjs/ai/gateway` — an abstract template for normalizing an upstream LLM gateway behind the `ProviderAdapter` contract.

  `HttpGatewayAdapter` is the Laravel custom-driver pattern (Template Method) for AI providers: the base class owns the reusable lifecycle — `fetch`, JSON / SSE handling, `AbortSignal` wiring, and error mapping — and leaves four `protected` hooks for the gateway's wire format (`buildHeaders`, `buildRequestBody`, `parseResponse`, `parseStreamEvent`). Subclass it, then register via the usual `AiRegistry.register()` path (the framework's `extend()` equivalent).

  Reach for this only when the gateway's wire format matches no built-in provider. An OpenAI- or Anthropic-compatible gateway needs no subclass — register the `openai` / `anthropic` driver with a `baseUrl` override instead.

  The subpath also exports `parseSseStream(body, signal)` + `SseEvent` for adapters that need raw `text/event-stream` framing. Runtime-agnostic (any `fetch`-capable runtime; no `node:` imports).

## 1.13.0

### Minor Changes

- 8ce9004: Add a streaming projector to the sub-agent resume surface. `Agent.resumeAsTool` and `Agent.resumeManyAsTool` now accept `streaming?: AsToolStreamingOption` (`boolean | (chunk) => SubAgentUpdate | null`, the same projector as `asTool({ streaming })`) plus an `onUpdate` sink. When set, the resume runs the inner loop via `stream()` instead of `prompt()` and forwards each projected update as it arrives — the singular form calls `onUpdate(update)`, the batch form calls `onUpdate(update, { key?, originalSubRunId })` so a host can correlate a chunk back to its originating request and fan it out (e.g. to a per-sub-agent SSE channel). This closes the gap where a resumed sub-agent emitted nothing until it completed or re-paused, freezing the in-bubble progress UI. The pause/completion partition is unchanged; this only adds an opt-in live-progress channel. Leaving `streaming` unset keeps the existing non-streaming resume. Also exports `SubAgentResumeOptions`, `AsToolStreamingOption`, and `ChunkProjector`.
- b89dc2b: Add a standalone agent run store for `stream()` pauses. `CachedAgentRunStore` / `InMemoryAgentRunStore` (plus `newAgentRunId()` and the `AgentRunState` type) persist the run state of a top-level `agent.stream()` that parks on a client tool or approval gate across an HTTP boundary, so consumers no longer hand-roll cache-backed run persistence. The standalone sibling of `CachedSubAgentRunStore`, with a `store` / `load` (non-destructive peek) / `consume` (atomic single-use) surface and a 5-minute default TTL. Stays runtime-agnostic on the main entry (lazy `@rudderjs/cache` load).

## 1.12.0

### Minor Changes

- 4a9eeb9: Add `@rudderjs/ai/chat-mentions` for `@slug` agent routing in chat UIs.

  A chat UX where the user types `@<agent-slug>` to explicitly invoke an agent (overriding the orchestrator's routing) is generic across chat panels, bots, and CLIs, but every consumer had to hand-roll the parsing and the system-prompt rule. This subpath ships both:

  - `parseMentions(message, knownSlugs)` extracts and validates `@<slug>` tokens (unknown mentions stay as plain text, `email@host` is not a mention), dedupes in first-seen order, lower-cases, and returns the matched slugs plus the message with the tokens stripped.
  - `buildMentionRoutingRule(slugs, opts?)` renders a system-prompt rule forcing the orchestrator to dispatch the mentioned agents in order. The dispatch tool name and argument key are parameterized (`toolName` / `argKey`, default `run_agent` / `agentSlug`).

  `MENTION_REGEX` is exported too; `parseMentions` clones it internally so the global's `lastIndex` never leaks across calls.

  ```ts
  import {
    parseMentions,
    buildMentionRoutingRule,
  } from "@rudderjs/ai/chat-mentions";

  const { slugs, cleaned } = parseMentions("@seo audit this", knownSlugs);
  const rule = buildMentionRoutingRule(slugs);
  ```

- 3b2bacf: Add a continuation-validation hook for the conversation-persistence path.

  `runWithPersistence` (the `conversational()` auto-persist path, plus the explicit `forUser()`/`continue()` form and their streaming variants) previously trusted the caller's incoming history verbatim. A continuation after a client-tool or approval round-trip carries the prior messages back from the client, so a malicious caller could rewrite history to continue another user's thread (IDOR), forge a `tool` result for a tool the server never ran, or claim an approval that was never pending.

  New `validate?: ContinuationValidator` option on `AgentPromptOptions`: when set, it runs against the server-persisted history just before the agent loop, and throwing rejects the request. Shipped helpers (all from the main entry):

  - `defaultContinuationValidator()` - ready-made hook with the built-in gate (prefix equality + tool-result-forgery + approval-forgery).
  - `validateContinuation(persisted, incoming, opts?)` - pure function returning a `{ ok, code, reason, index }` verdict for custom policy.
  - `assertValidContinuation(...)` - throwing variant; rejects with `ContinuationValidationError`.

  Fully backward compatible: with no `validate` option the path behaves exactly as before. Stateless calls (no persistence) never invoke the hook.

- 68c9e0f: Add a first-party ORM-backed `ConversationStore` at `@rudderjs/ai/conversation-orm`.

  `@rudderjs/ai` previously shipped only `MemoryConversationStore`, which is in-process and loses every thread on restart, so any production consumer had to hand-roll persistence against the `ConversationStore` interface. `OrmConversationStore` persists conversation threads and their messages through the registered `@rudderjs/orm` adapter (native, Prisma, or Drizzle), so threads survive restarts and are shared across web processes and queue workers. It mirrors the existing `@rudderjs/ai/memory-orm` and `@rudderjs/ai/budget-orm` pattern.

  ```ts
  import { setConversationStore } from "@rudderjs/ai";
  import { OrmConversationStore } from "@rudderjs/ai/conversation-orm";

  setConversationStore(new OrmConversationStore());
  ```

  Exports `OrmConversationStore`, the `ormConversationStore()` factory, the `AiConversationRecord` / `AiConversationMessageRecord` Models (for admin queries), and the `conversationOrmPrismaSchema` reference to copy into your schema. Messages carry a monotonic per-thread position so `load()` returns them in append order; `content` and `toolCalls` are JSON-encoded into portable text columns.

- 98cffb7: Add `Agent.resumeManyAsTool` for batch sub-agent resume.

  When an orchestrator dispatches several sub-agents in one parent turn and more than one pauses on a client tool or approval gate, the host previously had to loop over the singular `Agent.resumeAsTool` and stitch the pending tool-call sets back together by hand. `resumeManyAsTool(requests, { runStore })` does that: it resumes each `(subRunId, agent)` snapshot and returns a combined result set.

  ```ts
  const batch = await Agent.resumeManyAsTool(
    paused.map((p) => ({
      subRunId: p.subRunId,
      agent: rebuild(p),
      clientToolResults: results[p.subRunId],
      key: p.subRunId,
    })),
    { runStore }
  );
  // batch.completed / batch.paused / batch.errors partition the outcomes;
  // batch.pendingToolCallIds is the aggregated single round-trip; loop until batch.allCompleted.
  ```

  Each request carries its own `agent` (the sub-agents may be different classes) plus optional `key` echoed back for correlation. Options: `onError: 'capture'` (default, a failed item becomes a `{ kind: 'error' }` outcome and the rest still resume) or `'throw'`; `concurrency: 'parallel'` (default) or `'serial'`. New exported types: `SubAgentResumeRequest`, `SubAgentResumeOutcome`, `SubAgentResumeManyOptions`, `SubAgentResumeManyResult`.

### Patch Changes

- a15d4b9: Fix `validateContinuation` falsely rejecting legitimate continuations whose tool-call arguments were reordered.

  The prefix check compared messages with a key-order-sensitive `JSON.stringify`, so a tool-call `arguments` object (or structured `content`) whose keys came back in a different order, for example reloaded from a Postgres `jsonb` column, which does not preserve key order, or rebuilt client-side before re-sending, was read as a forged history and rejected with `not-a-prefix`. Comparison is now order-insensitive (recursive key sort), so semantically equal messages match while genuinely different ones are still rejected. Rejection reasons now name the diverging field (`content`, `toolCallId`, `toolCalls[i].arguments`, ...).

## 1.11.2

### Patch Changes

- d741232: fix(ai): normalize tool-call/tool-result adjacency before OpenAI-compatible wire calls

  Strict OpenAI-protocol providers (DeepSeek, OpenRouter, Azure, OpenAI) reject a `messages` array where a `role:'tool'` message does not immediately follow its parent `assistant`+`tool_calls`, or where a `tool_calls` entry goes unanswered — surfacing as `400 Messages with role 'tool' must be a response to a preceding message with 'tool_calls'`. A persist→resume cycle (client-tool pause, approval round-trip, or an app that re-stores assistant turns without their `toolCalls`) could produce such a transcript. Anthropic was unaffected because it carries tool results inside user turns.

  `toOpenAIMessages` now runs a bidirectional repair pass (`normalizeToolTranscript`): detached/out-of-order results are pulled adjacent to their parent, unanswered `tool_calls` get a synthesized stub result, and orphan results (no declaring assistant) are dropped. Already-valid transcripts pass through unchanged.

## 1.11.1

### Patch Changes

- 99611d5: Converge the tool/output zod→JSON-Schema converter onto the shared `@rudderjs/json-schema` package. `zodToJsonSchema(schema, io)` is now a thin shim over the framework-wide converter (Zod 4 native `z.toJSONSchema`, the same one `@rudderjs/openapi` uses) instead of a hand-rolled walker. Tool parameters convert with `io: 'input'`, structured output with `io: 'output'`.

  Internal swap — the public `zodToJsonSchema` export keeps its name and works as before. The emitted JSON Schema is now Zod-native and more complete: unions emit `anyOf` (was `oneOf`), literals emit `{ type, const }` (was `{ type, enum }`), nullable emits an `anyOf` with a `null` branch, and previously-unhandled zod types (refinements, intersections, branded types, etc.) now convert instead of falling back to `{ type: 'string' }`.

- Updated dependencies [085869e]
- Updated dependencies [e8bd81f]
- Updated dependencies [4e6c67d]
  - @rudderjs/json-schema@1.1.0
  - @rudderjs/core@1.11.0

## 1.11.0

### Minor Changes

- 7e6dc85: Require Node ≥ 22.12 (drop Node 20)

  Node 20 ("Iron") reached end-of-life in April 2026, so `engines.node` is now `>=22.12.0` (was `^20.19.0 || >=22.12.0`). CI tests against the current Active LTS lines, Node 22 and 24. Consumers still on Node 20 will see an `engines` warning at install time — upgrade to Node 22 or 24. The scaffolder-generated app template now declares the same floor.

### Patch Changes

- Updated dependencies [e199f5e]
- Updated dependencies [0e7db2c]
- Updated dependencies [fc97c10]
- Updated dependencies [7e6dc85]
- Updated dependencies [0109afb]
- Updated dependencies [0dcecaf]
- Updated dependencies [363d942]
- Updated dependencies [12b4a55]
- Updated dependencies [4085846]
- Updated dependencies [6f8760d]
- Updated dependencies [083672b]
- Updated dependencies [8ba6e7d]
- Updated dependencies [b31d1be]
- Updated dependencies [0d6c280]
- Updated dependencies [3b995b7]
- Updated dependencies [5eb4dd8]
- Updated dependencies [536b64d]
- Updated dependencies [ea9b982]
- Updated dependencies [ad17e79]
- Updated dependencies [f6afdf8]
- Updated dependencies [e25472c]
- Updated dependencies [ca644ad]
- Updated dependencies [bf1cca0]
- Updated dependencies [bc76570]
- Updated dependencies [acc2245]
- Updated dependencies [0b085a6]
- Updated dependencies [468dcd4]
- Updated dependencies [ffbb7f7]
- Updated dependencies [b897950]
- Updated dependencies [caff11d]
- Updated dependencies [26b7acf]
- Updated dependencies [ea510e0]
- Updated dependencies [b08aa1d]
- Updated dependencies [6bd32b0]
- Updated dependencies [370d2ec]
- Updated dependencies [c66e195]
- Updated dependencies [473dfd9]
- Updated dependencies [6e83e26]
- Updated dependencies [5617ec2]
- Updated dependencies [bb07d54]
- Updated dependencies [7b5d000]
- Updated dependencies [f1db9d9]
- Updated dependencies [a93455e]
- Updated dependencies [e9a3319]
- Updated dependencies [534bd8d]
  - @rudderjs/orm@1.14.0
  - @rudderjs/console@1.4.0
  - @rudderjs/core@1.7.0

## 1.10.2

### Patch Changes

- 161c5c4: `stripInternal: true` is now set in `tsconfig.base.json` — symbols annotated `/** @internal */` no longer leak into the published `.d.ts` declarations. Runtime is unchanged; only the TypeScript public-types contract shrinks.

  Consumers using a `@internal`-annotated symbol (typically underscore-prefixed framework helpers like `_match`, `_attachFake`, internal observer registries) will see a fresh `TS2339` / `TS2724` from `tsc`. The fix is to stop reaching into framework internals; if you have a legitimate cross-package use-case, open an issue.

  Cross-package test/HMR escape hatches (`Application.resetForTesting`, observer registry `.reset()` methods, `Session._runWithSession`, `Command._setContext`, `DispatchOptions.__context`, `QueryBuilder._aggregate`, `setConfigRepository`/`getConfigRepository`) had their `@internal` annotations removed — these were legitimate cross-package contract members mis-tagged, and they remain on the public types.

  Found by the Phase 4 public-API-surface audit (`docs/plans/findings/2026-05-28-phase-4-public-api.md`).

- Updated dependencies [161c5c4]
  - @rudderjs/console@1.2.1
  - @rudderjs/core@1.5.1
  - @rudderjs/orm@1.12.10

## 1.10.1

### Patch Changes

- 14a50d9: Second round of CodeQL source hardening.

  - `@rudderjs/orm` (**security**) — `make:migration <name>` ran through `spawn(..., { shell: true })` (load-bearing on Windows, where the `pnpm` shim is `pnpm.cmd`), so a crafted name (`pnpm rudder make:migration "x; rm -rf ."`) was a shell-injection vector. The migration name — the only caller-influenced token in the command — is now validated against a strict identifier allowlist (`assertSafeName`) at both the Prisma and Drizzle sink sites; everything else in the command is a hardcoded literal.
  - `@rudderjs/ai` — the `web_fetch` tool's HTML→text extraction now removes `<script>`/`<style>` blocks with a tag-filter-safe regex (tolerates `</script >`) and strips remaining tags iteratively to a fixed point. Output is fed to the model as text, never rendered as HTML — this improves extraction robustness, not a security boundary. New `htmlToText` export.
  - `@rudderjs/mail` — extracted a shared `stripHtmlTags` helper (loop-to-stable tag removal) used by the Markdown text-alternative and the LogAdapter preview, replacing two single-pass strips.
  - `@rudderjs/support` — `ConfigRepository.set()` now guards prototype-polluting keys (`__proto__`/`constructor`/`prototype`) with a literal comparison directly at each assignment site instead of an upfront set-membership check; behavior is unchanged.

- Updated dependencies [14a50d9]
  - @rudderjs/orm@1.12.7

## 1.10.0

### Minor Changes

- 76da150: Require `@anthropic-ai/sdk` `>=0.91.1` (was `>=0.30.0`) to clear two moderate advisories (Memory Tool path validation + insecure default file permissions). The Anthropic provider loads the SDK via a loose lazy `await import(...)`, so no source changes are needed — apps using the Anthropic provider should upgrade their installed `@anthropic-ai/sdk` to 0.91.1+.

## 1.9.0

### Minor Changes

- d2cf530: Require `@modelcontextprotocol/sdk` `^1.29.0` (was `^1.13.0`) and re-resolve its transitive dependencies to clear high-severity advisories in `express-rate-limit`, `path-to-regexp`, and `fast-uri`. The MCP bridge loads the SDK via loose dynamic imports, so no source changes are needed. Also re-resolves `protobufjs` to 7.6.1, clearing the critical `@google/genai` protobufjs advisory.

## 1.8.4

### Patch Changes

- 649b819: Group non-fatal boot-time warnings into one clean block at the end of dev startup. Previously each provider `console.warn`-ed inline as it booted, scattering messages (AI apiKey-skip, auth dev-secret) between the boot sequence and the provider tree with inconsistent prefixes (`[RudderJS AI]`, `[@rudderjs/auth]`, …). `@rudderjs/core` now exposes `bootNotice(scope, message)` — providers record notices during `boot()` and the framework flushes them as a grouped, scope-aligned `⚠ N notices` block after the provider tree and before `ready`, so the dev boot reads banner → tree → notices → ready. `@rudderjs/ai` (apiKey-empty skips) and `@rudderjs/auth` (dev password secret) now route through it. Notices are still printed in production so warnings aren't lost, and a fully-configured app boots with no notices block.
- Updated dependencies [649b819]
  - @rudderjs/core@1.5.0

## 1.8.3

### Patch Changes

- 2a96269: `rudder doctor` ai:provider-keys — downgrade "all cloud keys missing" from error to warn

  The check now warns (was: errored) when every declared cloud provider in
  `config/ai.ts` is missing its API key. The app boots fine without keys —
  failures only surface when an AI call is actually made (401 from the
  provider), so blocking `predev` on a runtime-intent condition forced CI /
  smoke / no-AI-test environments to write fake keys to pass the gate.

  Mirrors the ethos applied to `env:app-key` in #619 and `env:dotenv-loadable`
  in #626: error on "the app won't boot at all", warn on "the app boots but
  a runtime path will fail later". Severity-only change — message and
  detail text unchanged; fix-text gains the same "(or remove the providers
  from config/ai.ts if unused)" parenthetical the partial-keys branch
  already used, so both branches read consistently.

  Nothing fails-closed becomes fails-open — every state that returned
  `error` before now returns `warn` with the same message.

## 1.8.2

### Patch Changes

- f1660bf: Updated internal calls to `broadcast()` to await its now-async signature (`@rudderjs/broadcast` minor in this release). `BroadcastFn` type widened to `(...) => void | Promise<void>` so streaming jobs that broadcast each chunk back-pressure on the driver round-trip (Redis fan-out) rather than racing ahead.

  No public API change — `agent.queue(...).broadcast(channel)` works exactly as before from app code.

## 1.8.1

### Patch Changes

- d24a914: fix(ai): Gemini `functionResponse.name` + Buffer-free main entry + `AI.embed` cache keying

  Three protocol/runtime fixes from the 2026-05-21 code-review pass (`docs/plans/2026-05-21-framework-ai-protocol-fixes.md`, Phases 1, 3, 4). All three are silent failures that the type system couldn't catch — they live at the wire / runtime boundary.

  **Phase 1 — Gemini tool-call round-trip**

  `toGeminiContents` was setting `functionResponse.name` to `m.toolCallId ?? 'unknown'` (e.g. `call_1234_abc`), but Gemini's protocol requires the originating function name (e.g. `search`). The synthetic id was _also_ generated by the adapter, so the receiving model had no way to recover the function name. Now we pre-build a `(toolCallId → name)` map by walking prior assistant messages' `toolCalls` and emit the right `name`. `toGeminiContents` is now exported for testability.

  **Phase 3 — runtime-agnostic main entry, `Buffer`-free**

  Four `Buffer.from(...)` callsites in the `contentTo*Parts` paths threw `ReferenceError: Buffer is not defined` on the first document/image attachment in browser / React Native / Electron renderer:

  - `providers/anthropic.ts:185`
  - `providers/openai.ts:208`
  - `providers/google.ts:245`
  - `image.ts:103`, `:107`

  Added `base64ToUtf8(base64): string` to `src/base64.ts` (uses `TextDecoder` + the existing `fromBase64`). All four sites route through it. `image.ts` uses `fromBase64` / `new Uint8Array(arrayBuffer)` directly. Three remaining `Buffer` references (`FileContent.data` / `TextToSpeechResult.audio` on the Anthropic + OpenAI file/audio adapters) are unreachable from browser/RN because the underlying SDKs are Node-only and the types document the Node-only contract — widening those is a separate API change, deferred to a follow-up that also extends `isomorphic-check` with a `\bBuffer\b` rule.

  **Phase 4 — `AI.embed({ cache: true })` actually caches**

  The `CachedEmbeddingAdapter` cache was a `WeakMap<EmbeddingAdapter, CachedEmbeddingAdapter>` keyed on adapter identity, but every `AI.embed(...)` call constructed a fresh `inner = factory.createEmbedding(modelId)`. The WeakMap lookup always missed and `cache: true` was a silent no-op. Now keyed by `${provider}::${model}` in a `Map`. Tied to `AiRegistry.reset()` via a new internal `_onAiRegistryReset` subscriber so tests that swap fakes don't bind to a stale inner adapter.

  **Tests**

  `src/protocol-fixes.test.ts` — 11 specs:

  - Gemini `functionResponse.name` for single + parallel tool calls + orphan-tool-message fallback (3)
  - `base64ToUtf8` plus `contentToGeminiParts` / `contentToOpenAIParts` / `contentToAnthropicParts` round-trips with `globalThis.Buffer` deleted, including multi-byte UTF-8 (4)
  - `AI.embed` cache hit / cache off / different-model isolation / cache-clears-on-reset (4)

  Verified: 834 AI tests pass; `orm-prisma`, `orm-drizzle`, `telescope` typecheck clean.

- a99ed3d: fix(ai): OpenAI parallel tool-call args by index + resume-approval placeholder synthesis

  Two streaming-shaped fixes from the 2026-05-21 code review (`docs/plans/2026-05-21-framework-ai-protocol-fixes.md`, Phases 2 + 5). Both are silent corruption bugs — the type system can't catch wire-state issues.

  **Phase 2 — OpenAI parallel tool-call arg-delta tracking**

  The agent loop tracked stream partials in a single `Map<id, partial>` keyed by call id, and routed arg-only deltas to "the last partial in insertion order." When OpenAI streams ≥2 parallel tool calls interleaved by `index`, the second tool's start-delta becomes the most recent insert, so subsequent arg fragments for the first tool land on the second tool's partial (and vice versa). `JSON.parse` then either fails silently → `{}` args, or succeeds with truncated-but-parseable JSON → wrong args.

  Fix:

  1. Add `toolCallIndex?: number` to `StreamChunk`. Optional — adapters whose tool calls arrive whole per block (Anthropic, Google) don't set it.
  2. OpenAI adapter passes `tc.index` through on both the start-delta and arg-only deltas.
  3. Agent loop keeps a parallel `partialsByIndex` map; arg-deltas route via index when present, fall back to the legacy last-insertion behavior when absent (back-compat for non-OpenAI streaming providers). Partials live in both maps by reference — no extra finalization work.

  **Phase 5 — resume-approval orphan `tool_use` synthesis**

  `resumePendingToolCalls` iterated an assistant's pending `toolCalls`, executed approved ones, and `break`'d on the first `'pending'` decision — leaving every subsequent tool call without a matching `tool` message. Anthropic specifically rejects the next request because every `tool_use` block must be followed by a `tool_result`.

  Fix: when `break`ing on `'pending'`, synthesize placeholder `tool` messages for this call AND every still-unresolved sibling, marked with `_pending: true` (new `@internal` field on `AiMessage`). On the next resume, the function strips trailing placeholders, finds the parent assistant message (which is now buried under real + placeholder tool messages from prior resumes), skips tool calls already resolved (their non-`_pending` tool messages are still there), and re-walks. Multi-step approval flows can now make any number of partial-approval round-trips without 400ing Anthropic.

  **Tests** — `src/streaming-and-approval-fixes.test.ts`, 5 specs:

  - Parallel tool-call args interleaved by index don't cross-contaminate
  - Back-compat: `toolCallIndex`-less adapters keep the legacy last-insertion routing
  - Placeholders synthesized for every unresolved sibling on partial approval
  - Placeholders stripped + re-walked on resume without double-executing approved tools
  - Anthropic invariant: every `tool_use` in the parent assistant has a matching tool message after partial approval

  Verified: 839 AI tests pass; `orm-prisma`, `orm-drizzle`, `telescope` typecheck clean.

- Updated dependencies [1553c9a]
- Updated dependencies [41f68b1]
- Updated dependencies [6652117]
  - @rudderjs/core@1.2.0
  - @rudderjs/orm@1.12.0

## 1.8.0

### Minor Changes

- a3a7368: Phase 3 of `rudder doctor` — first wave of package-contributed checks.

  Thirteen framework packages now ship a `<package>/doctor` subpath whose
  side-effect import registers domain-specific health checks on the shared
  doctor registry. The CLI's lazy loader auto-imports them when
  `rudder doctor` runs.

  New checks (14 total, grouped by category):

  - **auth** — `auth:secret` (AUTH_SECRET set + length sane), `auth:views-vendored`
    (vendored when a frontend renderer is installed).
  - **auth** (cont.) — `session:secret` (SESSION_SECRET length when set), `hash:driver`
    (config string ∈ {bcrypt, argon2}; flags missing `argon2` peer).
  - **orm** — `orm-prisma:schema` (schema files present), `orm-prisma:client-generated`
    (mtime check vs schema), `orm-prisma:database-url`, `orm-drizzle:schema`,
    `orm-drizzle:database-url`.
  - **billing** — `cashier-paddle:api-key`, `cashier-paddle:webhook-secret`
    (both conditional on a cashier route being mounted).
  - **queue** — `queue-bullmq:redis-url`, `queue-inngest:event-key`,
    `queue-inngest:signing-key`.
  - **ai** — `ai:provider-keys` (greps `config/ai.ts` for declared driver
    literals, then checks each cloud provider's API key env var).
  - **mcp** — `mcp:route-mounted` (if `app/Mcp/` has tools, mcp route is
    registered).
  - **monitoring** — `telescope:dashboard`, `pulse:dashboard`,
    `horizon:dashboard` (dashboard route reachable from `routes/web.ts`).

  Adding a new contributing package: ship a `<package>/doctor` subpath with
  side-effect `registerDoctorCheck` calls and append the package name to
  `PACKAGES_WITH_CHECKS` in `@rudderjs/cli/src/doctor/load-package-checks.ts`.

  Implementation notes:

  - The CLI's loader resolves doctor subpaths via direct path
    (`<cwd>/node_modules/<pkg>/dist/doctor.js`), not `createRequire.resolve`,
    because the `./doctor` exports condition is `import`-only (no `require`)
    and the strict-mode pnpm node_modules don't expose user-installed
    packages from the CLI's location. Documented as the ESM-only-peer
    resolution workaround.
  - `deps:auth-views` was removed from the CLI's built-in checks — the
    identical concern now lives at `auth:views-vendored` in
    `@rudderjs/auth/doctor`, where it belongs. Net check count for a user
    with `@rudderjs/auth` installed: same (one each); for a user without
    auth, doctor stays silent on the topic instead of saying "auth not
    installed — skip".

  No tests added in this phase — each check is small enough to be tested
  implicitly via integration smoke (the existing temp-dir test suite in
  `@rudderjs/cli`, plus a manual smoke against `playground/`). Per-package
  test suites for these checks may land in a follow-up.

  Phase 4 (`--deep`) and Phase 5 (`--fix`) follow in subsequent releases.

### Patch Changes

- Updated dependencies [b28e51f]
  - @rudderjs/console@1.1.0

## 1.7.2

### Patch Changes

- 23569eb: Fix Anthropic + Bedrock streaming providers clobbering `promptTokens` with 0
  on the `finish` chunk. Anthropic's stream protocol splits prompt + completion
  token counts across two distinct events — `message_start.message.usage.input_tokens`
  carries the prompt count, `message_delta.usage.output_tokens` carries the
  completion count. The providers were emitting `promptTokens: 0` on the
  `finish` chunk derived from `message_delta`, and the agent loop's last-wins
  usage aggregation then overwrote the correct earlier value from
  `message_start`. Result: any streamed call reported `AgentResponse.usage.promptTokens === 0`.

  Impact:

  - Consumers billing on input tokens silently undercharged for streamed calls
    (non-streaming `.prompt()` was unaffected — it reads `input_tokens` directly).
  - `withBudget()` middleware silently over-allowed streamed requests — the
    true-up step subtracted the estimated input cost but never added the real
    one back, so per-user budget caps were under-enforced.

  Surfaced 2026-05-19 by pilotiq-io's meta-model gateway smoke test, which
  asserts `inputTokens > 0` on every Phase B call.

  What changes:

  - `providers/anthropic.ts`: stream loop now threads `lastPromptTokens` from
    `message_start` into the `message_delta` → `finish` chunk so the usage
    object is complete.
  - `providers/bedrock.ts`: same fix; Bedrock-Anthropic streams use the
    identical event protocol. `mapBedrockAnthropicEvent` now takes a
    `BedrockStreamState` parameter to carry the prompt count across events.
  - `agent.ts`: stream-loop usage aggregation switches from last-wins to MAX
    per field (`mergeUsage`). Defensive layer — prevents this class of bug
    if any future provider emits multi-chunk usage with under-reported later
    values. Safe because every chunk is a running snapshot, not a delta.
  - The `usage` chunk from `message_start` no longer claims a `totalTokens`
    that mixes the (final) prompt count with a stale `output_tokens: 0`. The
    authoritative final total is on the `finish` chunk.

  No public API change. The `mapBedrockAnthropicEvent` signature is an
  internal helper (its `state` parameter is `BedrockStreamState`, also exported
  as a type for consumers calling it directly in tests).

## 1.7.1

### Patch Changes

- 765a19d: Route `AiRegistry`'s factories/default/models through `globalThis` so the registry survives the case where `@rudderjs/ai` is loaded twice — typical in a Vite-bundled server where the framework bundles `@rudderjs/ai` inline (every agent path resolves a provider via `AiRegistry.resolve(...)`) but `AiProvider.boot()` runs from a `node_modules` copy of `@rudderjs/ai/server` resolved via the provider auto-discovery manifest. Without a shared store, provider factories registered from the externalized copy would never be visible to agent resolution from inside the bundle and every agent call would throw `[RudderJS AI] Unknown AI provider`.

  No public API change — same `register` / `getFactory` / `setDefault` / `getDefault` / `resolve` / `resolveReranking` / `resolveFiles` / `resolveVectorStores` / `setModels` / `getModels` / `reset` surface. Defensive migration per the #499 static-state singleton audit. Same pattern as PR #498 (`@rudderjs/orm` `ModelRegistry`), #500 (pennant), #501 (cache), #502 (queue), #503 (mail), #504 (storage), #505 (hash).

- Updated dependencies [16f87a4]
- Updated dependencies [4634586]
- Updated dependencies [bdfe575]
  - @rudderjs/orm@1.9.3

## 1.7.0

### Minor Changes

- e12b335: **`AiProvider` now skips providers with empty `apiKey` instead of crashing on boot.**

  Previously, any apiKey-requiring driver (anthropic, openai, google, deepseek, xai, groq, mistral, azure, openrouter, elevenlabs, voyage) would throw `[RudderJS AI] config('ai').providers.X is missing apiKey` from `boot()` if its `apiKey` was empty — killing `pnpm dev` before the framework finished initializing. Fresh-scaffolded apps with the default 3-provider config (anthropic + openai + google reading from env vars) couldn't boot until **all three** keys were set.

  Now `AiProvider.boot()` skips empty-key providers with a one-line warning per skip:

  ```
  [RudderJS AI] Skipped provider "anthropic" (driver "anthropic"): apiKey is empty.
  Set config('ai').providers.anthropic.apiKey (typically via an env var) to enable.
  ```

  The app boots cleanly. The user gets actionable signal at startup. Calling `AI.use('anthropic')` later surfaces the standard `[RudderJS AI] Unknown AI provider "anthropic"` error at the use-site, with the boot warning explaining why.

  Matches Laravel's "drivers as data, missing credentials don't kill the framework" pattern — same as how Cache/Mail/Storage handle unconfigured drivers. Providers with valid keys, and `apiKey`-less drivers like ollama / bedrock, are unaffected.

  No API change beyond the boot-time behavior. Marked minor (not patch) because the observable startup behavior changes — existing apps that relied on the boot-time throw to surface misconfig will need to handle that signal at use-time or check `AiRegistry.getFactory(name)` explicitly.

## 1.6.3

### Patch Changes

- b461123: Declare `engines.node: "^20.19.0 || >=22.12.0"` on every published package and on the scaffolder-generated `package.json` template.

  Matches the actual runtime floor enforced transitively by `vite@7` (`^20.19.0 || >=22.12.0`) and `vike` (`>=20.19.0`). Previously the requirement was only mentioned in the install guide — adding it to `engines.node` surfaces the floor at `pnpm install` / `npm install` time via the package manager's engines warning, rather than waiting for runtime / transitive errors.

  Not a breaking API change — `engines` is advisory by default (package managers warn but don't refuse without `engineStrict=true`).

- Updated dependencies [b461123]
  - @rudderjs/core@1.1.5
  - @rudderjs/orm@1.9.2

## 1.6.2

### Patch Changes

- 9624f24: **Type-tightening + clearer config errors in `@rudderjs/ai/server`.** Three internal cleanups, no public-API change.

  - Drop the `as unknown as StreamChunk` casts on the loop's pending-state yields. The `StreamChunk` union already lists `'pending-client-tools'` and `'pending-approval'` — the casts were dead weight.
  - Replace the duck-typed `(a as any).tools === 'function'` narrowing for `HasTools` / `HasMiddleware` with proper type-guard helpers. Removes the last `as any` in `agent.ts`.
  - **`AiProvider.boot` now fails loud on a missing `apiKey`** for drivers that need one. The previous code asserted `cfg.apiKey!` and silently passed `undefined` to the provider constructor on misconfigured config; you now get `[RudderJS AI] config('ai').providers.<name> is missing apiKey (driver "<driver>")` at boot. `azure` similarly fails fast on a missing `baseUrl`. Drivers that don't need a key (`ollama`, `bedrock`) are unaffected.
  - The 13-branch `if/else` driver dispatch in `server/provider.ts` collapses to a `DRIVERS` map keyed by driver name — same set of supported drivers, ~30% smaller, easier to add new ones.

  If your `config('ai').providers` is already correct, nothing changes. If a misconfigured provider was working before only because its driver tolerated `apiKey: undefined`, you'll now get a clear error at startup instead.

## 1.6.1

### Patch Changes

- d0db9f0: **`@rudderjs/boost`** — overhauled the generated agent guidelines output.

  Inspired by Laravel Boost's recent shape. Concrete changes:

  - **`CLAUDE.md` is now ~135 lines, down from ~1,350.** Replaced the inline content dump of every package guideline with structured pointers to `.ai/guidelines/<package>.md`. The full per-package content still lives in `.ai/guidelines/` — agents load it on demand.
  - **New structure** in `CLAUDE.md`: XML wrapper (`<rudderjs-boost-guidelines>`), `=== foundation rules ===` / `=== boost rules ===` / `=== skills activation ===` dividers, a Foundational Context section listing installed `@rudderjs/*` versions, a Boost MCP Tools section listing every exposed tool, and a Skills Activation section with explicit `**ACTIVATE when:** …` / `**SKIP when:** …` heuristics per skill.
  - **Skill frontmatter enriched.** Each `SKILL.md` now declares `license`, `appliesTo`, `metadata.author`, plus the new `trigger` and `skip` fields that drive the CLAUDE.md activation section. `appliesTo` is the new filter — skills install only when at least one of their target packages is present (override with `--include-all-skills`).
  - **Three skills modularized** into `SKILL.md` + `rules/*.md`:
    - `orm-models` (`@rudderjs/orm`) — split into 5 rule files (defining-models, querying, crud-and-observers, factories, resources).
    - `auth-setup` (`@rudderjs/auth`) — split into 5 rule files (provider-setup, guards-and-handlers, auth-views, gates-and-policies, email-and-password-reset).
    - `mcp-servers` (`@rudderjs/mcp`) — split into 5 rule files (tools, resources-and-prompts, server-assembly, transports, testing-and-di).
    - Each `SKILL.md` is now a compact Quick Reference (~40 lines) linking to the matching rule file. Rule files use paired Incorrect/Correct examples consistently.
  - **`boost.json`** now records the active skill list under a `skills` field.

  Migration: run `pnpm rudder boost:update` (or `boost:install`) to regenerate the new CLAUDE.md / boost.json / skill files. The old output is fully replaced — local edits to `CLAUDE.md` will be overwritten, same as before. Per-package guidelines and skills install paths are unchanged.

  No API breaks. The `@rudderjs/*` package bumps are guideline / skill content changes for packages that ship `boost/` directories.

- Updated dependencies [d0db9f0]
  - @rudderjs/orm@1.9.1

## 1.6.0

### Minor Changes

- 82ca5b4: **B10 — VoyageAI provider for best-in-class embeddings + reranking. Closes Track B.** New `VoyageProvider` implements `EmbeddingAdapter` + `RerankingAdapter` against Voyage's REST API. Raw `fetch` adapter — no SDK peer dep (matches the Jina / ElevenLabs shape). Wired through `AiProvider` via `driver: 'voyage'`.

  ```ts
  // config/ai.ts
  import { env } from "@rudderjs/support";

  export default {
    default: "openai/gpt-4o",
    providers: {
      openai: { driver: "openai", apiKey: env("OPENAI_API_KEY")! },
      voyage: { driver: "voyage", apiKey: env("VOYAGE_API_KEY")! },
    },
  };
  ```

  ```ts
  // Embeddings (defaults to input_type: 'document' — RAG ingestion)
  const { embeddings } = await AI.embed("hello world", {
    model: "voyage/voyage-3-large",
  });

  // Reranking
  const ranked = await AI.rerank({
    model: "voyage/rerank-2.5",
    query: "how do I reset my password?",
    documents: [
      "change account name procedure",
      "reset password procedure",
      "enable two-factor authentication",
    ],
    topK: 5,
  });
  ```

  **Models:**

  - **Embeddings:** `voyage-3` (general), `voyage-3-large` (best quality), `voyage-code-3` (code), `voyage-finance-2` (finance), `voyage-law-2` (legal).
  - **Reranking:** `rerank-2.5` (best), `rerank-2.5-lite`, `rerank-2`.

  **Conventions:**

  - `VoyageConfig.defaultInputType` defaults to `'document'` — Voyage embeddings perform measurably better when the API knows whether a string is a search **query** or an indexed **document**. Override per-deployment to `'query'` for query-side pipelines.
  - Rerank requests forward `topK` → `top_k`; results map `relevance_score` → `relevanceScore`. The adapter prefers Voyage-echoed `document` text when present, otherwise looks up by index in the original input (defensive against API revisions that toggle the echo behavior).
  - Embed responses are **defensively sorted by index** before returning — guards against future API revisions that might return out-of-order results.

  **Closes Track B.** All of Tracks A and B are shipped. Next forward-looking item is **B8.5** (Gemini hosted RAG) once there's customer signal, or net-new ideas.

  **Manual registration alternative** (matches Jina / Cohere precedent):

  ```ts
  import { AiRegistry, VoyageProvider } from "@rudderjs/ai";

  AiRegistry.register(
    new VoyageProvider({
      apiKey: process.env.VOYAGE_API_KEY!,
    })
  );
  ```

- 3788bab: **B8 Phase 2 — `fileSearch` agent tool + OpenAI native `file_search` emission.** Adds the agent-side surface to the hosted vector stores shipped in B8 Phase 1. Closes the agent loop end-to-end on OpenAI: the model invokes `file_search` natively against your configured stores; no `execute` to write, no embedding pipeline, no tool round-trip.

  ```ts
  import { Agent, VectorStores, fileSearch } from "@rudderjs/ai";

  const kb = await VectorStores.get("vs_abc123");

  class SupportAgent extends Agent {
    model() {
      return "openai/gpt-4o";
    }
    tools() {
      return [
        fileSearch({
          stores: [kb.id],
          where: { author: "Alice", year: 2026 }, // server-side metadata filter
          maxResults: 10,
        }),
      ];
    }
  }
  ```

  **Surface:**

  - `fileSearch({ stores, where?, maxResults?, name?, description? })` returns a `FileSearchTool` tagged with `providerHint: { type: 'file-search', vector_store_ids, filters?, max_num_results? }`. Symbol marker `FILE_SEARCH_MARKER` + `isFileSearchTool(t)` typeguard.
  - `where` accepts the sugar `{ key: value }` form (lowered to an `and` of `eq` filters) or the typed `{ type: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'and' | 'or', ... }` shape directly. `normalizeWhere` is exported for advanced use.
  - `toOpenAITools` recognizes `providerHint?.type === 'file-search'` and emits OpenAI's native `{ type: 'file_search', vector_store_ids, filters, max_num_results }` block instead of a function-call shape. Mirrors A7 Phase 2's Anthropic-side substitution.
  - `AiFake.respondWithFileSearchResults({ text? | hits?, usage? })` stubs a single-step assistant reply for tests — the hosted path produces the answer directly so no tool round-trip is needed.

  **Latent bug fix bundled in:** `toolToSchema()` now propagates `definition.providerHint` onto the emitted `ToolDefinitionSchema`. Computer-use's provider hint already lived on the instance `toSchema()` method but never reached `toAnthropicTools` through the agent loop — so the native `computer_20250124` block was silently absent from real agent runs. The hint now flows correctly through both the file-search and computer-use paths. `ToolDefinitionOptions.providerHint?` is the new typed slot for tools that need adapter-native serialization.

  **Compatibility:**

  - OpenAI on `chat.completions` — native block. Phase 1 + 2 close the OpenAI RAG story.
  - Gemini — deferred to B8.5 (RAG surface uses `cachedContent`; design diverges enough to deserve its own pass).
  - Other providers — see `fileSearch` as a normal function-call tool with the placeholder `{ query: string }` schema. Without an `execute` they pause for client tools; Phase 3 will add a `fallback` opt that delegates to `similaritySearch` over a local pgvector model.

  Docs: new `docs/guide/vector-stores.md` covers both Phase 1 (CRUD) and Phase 2 (agent tool). Added under the AI sidebar.

- 4540248: **B8 Phase 2.x — `WebSearch` provider-native retrofit (Anthropic + Gemini).** Reuses Phase 2's `providerHint` plumbing on `WebSearch.toTool()`. Models that ship a native chat-completions web-search tool now invoke it directly instead of going through the DuckDuckGo fallback — same agent prompt, dramatically better quality on the providers where it matters.

  ```ts
  import { Agent, WebSearch } from "@rudderjs/ai";

  class ResearchAgent extends Agent {
    model() {
      return "anthropic/claude-3-5-sonnet-latest";
    }
    tools() {
      return [
        WebSearch.make()
          .domains(["anthropic.com", "docs.anthropic.com"])
          .maxResults(5)
          .toTool(),
      ];
    }
  }
  ```

  **Surface:**

  - `WebSearch.toTool()` now sets `providerHint: { type: 'web-search', allowed_domains?, max_uses? }` from the chained `.domains([...])` / `.maxResults(n)` opts. The DuckDuckGo `server` execute stays in place as the fallback.
  - `toAnthropicTools` recognizes the hint and emits `{ type: 'web_search_20250305', name: 'web_search', max_uses?, allowed_domains?, blocked_domains?, user_location? }`. Honors a `providerHint.tool` override for forward-compat with future Anthropic web-search variants.
  - Gemini — `toGeminiTools` is restructured to return the **already-wrapped top-level array** so native blocks like `{ google_search: {} }` sit as separate top-level entries alongside `{ functionDeclarations: [...] }`. The cache-key build uses the same shape, so cached requests pick up the change automatically.
  - OpenAI — `chat.completions` has no native web-search block (it's Responses-API-only), so OpenAI continues to use the DuckDuckGo `server` execute as fallback. Same fallback for any other provider without a native hint match.

  **`domains` / `maxResults` semantics across providers:**

  | Provider  | `.domains([...])`                    | `.maxResults(n)`               |
  | --------- | ------------------------------------ | ------------------------------ |
  | Anthropic | → `allowed_domains`                  | → `max_uses`                   |
  | Gemini    | ignored (block accepts none)         | ignored (block accepts none)   |
  | OpenAI    | applied via DuckDuckGo `site:` query | bounded by HTML response slice |

  **Compatibility:** strictly additive. Apps already using `WebSearch.make().toTool()` get native emission for free on Anthropic + Gemini; behavior on OpenAI / other providers is unchanged.

- 94dc14a: **B8 Phase 3 — local pgvector fallback for `fileSearch`. Closes B8.** With the new `fallback` opt configured, the same `fileSearch` tool works on every provider — OpenAI runs the search natively, everyone else delegates to `similaritySearch` against a local pgvector model. Same agent prompt across hosted and self-hosted RAG, no re-prompting needed when ops swap deployment targets.

  ```ts
  import { Agent, fileSearch } from "@rudderjs/ai";
  import { Document } from "./app/Models/Document.js";

  class HybridAgent extends Agent {
    // openai/* — native file_search runs server-side against vs_kb.
    // anthropic/*, gemini/*, etc — similaritySearch runs locally against
    //   the Document model. Same prompt, same tool name, same input schema.
    model() {
      return "openai/gpt-4o";
    }
    tools() {
      return [
        fileSearch({
          stores: ["vs_kb"],
          fallback: {
            model: Document,
            column: "embedding",
            embedWith: "openai/text-embedding-3-small",
            minSimilarity: 0.7,
            limit: 10,
            scope: (q) =>
              q.where("tenantId", currentTenant).where("published", true),
          },
        }),
      ];
    }
  }
  ```

  **Surface:**

  - `FileSearchOptions.fallback?: FileSearchFallback<TInstance>` — accepts every B7 `similaritySearch` knob (`model`, `column`, `embedWith`, `metric`, `minSimilarity`, `limit`, `scope`, `projectResult`). `name` / `description` flow from the outer `fileSearch` so the agent prompt stays identical across providers.
  - `FileSearchTool` widened to `Tool<{ query: string }, unknown>` with optional `execute` + `toModelOutput`. Both stay `undefined` when `fallback` is absent (Phase 2 back-compat). When `fallback` is set, both are lifted from an internal `similaritySearch(...)` instance.
  - New `FileSearchFallback<TInstance>` type alias exported from `@rudderjs/ai` for apps that want to factor out the fallback config.

  **Why no `supportsFileSearch` flag:** the original plan proposed a per-`ProviderFactory` capability check. It turned out unnecessary — the `providerHint` cascade at the adapter level already does the right thing. OpenAI's `toOpenAITools` substitutes the native `file_search` block (model never invokes execute on that path); other providers serialize the tool as a function-call schema (model invokes execute → fallback runs). Simpler, fewer moving parts.

  **Compatibility:** strictly additive. Apps already calling `fileSearch({ stores })` see no change — `execute` stays absent, the OpenAI native path is unchanged, and the previously-degraded "client tool" pause on non-OpenAI providers is unchanged unless `fallback` is configured.

  **Closes B8.** Gemini hosted `VectorStores` parity stays deferred to B8.5 (Gemini's `cachedContent` shape diverges enough to deserve its own design pass). Next Track B item is **B9** (ElevenLabs provider).

- d685bee: **B8.5 — Gemini hosted RAG (`fileSearchStores`).** The `VectorStores` façade and `fileSearch` agent tool now work against Gemini, matching the OpenAI surface 1:1. Same code, different provider.

  ```ts
  import { VectorStores, fileSearch, Agent } from "@rudderjs/ai";

  const kb = await VectorStores.create("Knowledge Base", {
    provider: "google",
  });
  await kb.add({
    filePath: "./report.pdf",
    attributes: { author: "Alice", year: 2026 },
  });

  class SupportAgent extends Agent {
    model() {
      return "google/gemini-2.5-flash";
    }
    tools() {
      return [
        fileSearch({
          stores: [kb.id], // 'fileSearchStores/foo-bar'
          where: { author: "Alice", year: 2026 },
          maxResults: 10,
        }),
      ];
    }
  }
  ```

  **What's new:**

  - `GoogleVectorStoreAdapter` wraps Google's `fileSearchStores` API. CRUD (`create`/`list`/`get`/`delete`), ingestion via `uploadToFileSearchStore` (local path/Blob) or `importFile` (existing Files API id). Both paths return LROs polled to completion via `client.operations.get`. Failed ingestion surfaces as `{ status: 'failed', lastError }` without throwing.
  - `toGeminiTools` recognizes `providerHint.type === 'file-search'` and emits the native `{ fileSearch: { fileSearchStoreNames, metadataFilter?, topK? } }` tool block (same `providerHint` mechanism A7 and B8 established).
  - Typed `FileSearchFilter` (`{ type: 'eq', key, value }` etc.) translates to Gemini's `metadataFilter` string syntax (`(author = "Alice") AND (year > 2020)`) at the adapter layer. The user-facing API is unchanged.
  - Per-document `attributes` map to Gemini's `CustomMetadata[]` shape. Strings → `stringValue`, numbers → `numericValue`, booleans → `stringValue: 'true' | 'false'` (Gemini has no boolean variant; string is lossless and filter-matchable).

  **Provider differences (Gemini vs OpenAI):**

  - Store ids are full resource paths (`fileSearchStores/foo-bar`), not opaque (`vs_abc123`).
  - Store-level `metadata` and `expiresAfter` aren't supported by Gemini — passing either throws fail-loud. Use per-document `attributes` instead.
  - Gemini's `fileSearchStores` is **Developer API only** — not available on Vertex AI.

  **Closes B8.5.** All of Tracks A and B (including B8.5) are shipped. See `docs/plans/2026-05-11-b8.5-gemini-hosted-rag.md`.

- 362a751: **B9 — ElevenLabs provider for premium TTS + STT.** New `ElevenLabsProvider` implements `TextToSpeechAdapter` + `SpeechToTextAdapter` against ElevenLabs's REST API. Raw `fetch` adapter — no SDK peer dep (matches the Jina / Cohere shape). Wired through `AiProvider` via `driver: 'elevenlabs'` so apps declare it in `config/ai.ts` alongside their LLM provider.

  ```ts
  // config/ai.ts
  import { env } from "@rudderjs/support";

  export default {
    default: "openai/gpt-4o",
    providers: {
      openai: { driver: "openai", apiKey: env("OPENAI_API_KEY")! },
      elevenlabs: { driver: "elevenlabs", apiKey: env("ELEVENLABS_API_KEY")! },
    },
  };
  ```

  ```ts
  // TTS — model string is `<provider>/<voice_id>`; Rachel = 21m00Tcm4TlvDq8ikWAM
  await AudioGenerator.of("Hello world")
    .model("elevenlabs/21m00Tcm4TlvDq8ikWAM")
    .format("mp3")
    .generate();

  // STT — model string is `<provider>/<model>`; scribe_v1 is the only model today
  await Transcription.of(audioBuffer)
    .model("elevenlabs/scribe_v1")
    .transcribe();

  // Failover from OpenAI TTS → ElevenLabs (existing AudioGenerator surface)
  await AudioGenerator.of("Hello")
    .model("openai/tts-1-hd")
    .failover("elevenlabs/21m00Tcm4TlvDq8ikWAM")
    .generate();
  ```

  **Conventions:**

  - The model string after `elevenlabs/` is a **voice id** for TTS, an actual model id for STT. The TTS model id ships from `ElevenLabsConfig.defaultTtsModelId` (default `eleven_multilingual_v2`).
  - `format` maps: `mp3` → `mp3_44100_128`, `opus` → `opus_48000_128`. `wav` / `aac` / `flac` throw clearly — re-encode at the app layer or use a provider with native support.
  - `speed` is **ignored** by this adapter — ElevenLabs doesn't expose a top-level speed multiplier on the TTS endpoint.

  **Manual registration alternative** (matches Jina / Cohere precedent — no `AiProvider` config needed):

  ```ts
  import { AiRegistry, ElevenLabsProvider } from "@rudderjs/ai";

  AiRegistry.register(
    new ElevenLabsProvider({
      apiKey: process.env.ELEVENLABS_API_KEY!,
    })
  );
  ```

- 76822f6: **B6 — `.broadcast(channel)` on queued prompts.** Background AI work + live UI without polling. Closes a Laravel parity gap.

  `QueuedPromptBuilder` (returned by `agent.queue(input)`) gains a new `.broadcast(channel, opts?)` method. When set, the queued job uses `agent.stream()` instead of `prompt()` and pushes each `StreamChunk` to the channel via `@rudderjs/broadcast`:

  ```ts
  await new SupportAgent()
    .queue("Help with refund request")
    .broadcast(`user.${userId}.support`)
    .send();

  // Subscribers receive: { event: 'chunk', data: <StreamChunk> } per chunk,
  // then { event: 'done', data: <AgentResponse> } at completion,
  // or { event: 'error', data: { message } } on failure.
  ```

  - Optional `eventPrefix` namespaces events (e.g. `agent.chunk` / `agent.done` / `agent.error`)
  - `@rudderjs/broadcast` is loaded lazily — only required when `.broadcast()` is called
  - Process-model caveat: `broadcast()` writes to in-process WS state. The typical RudderJS dev setup (single process running web + `queue:work`) works out of the box. Cross-process workers will need a pub/sub bridge (Redis, Reverb, etc.) — not in v1

- 3f67151: **A6 Phase 1 — pricing catalog + cost estimation.** Foundation for the upcoming `withBudget(...)` middleware (phase 3). The eval framework's local `PRICING` table is replaced with this catalog so the cost column on eval reports is meaningful for every shipped provider, not just 8 hardcoded models.

  - `ModelPricing` — `<provider>/<model>` → `{ inputPer1k, outputPer1k, cacheReadPer1k?, cacheWritePer1k?, _snapshotDate }`. Covers all headline models for every provider in `src/providers/` (Anthropic, OpenAI, Google, Bedrock, xAI, DeepSeek, Mistral, Groq, Cohere). Catalog snapshot is dated 2026-05-11; entries carry `_snapshotDate` per row so apps with negotiated rates can spot stale rows when they upgrade.
  - `estimateCost(model, promptTokens, completionTokens, pricing?)` — same shape as the previous eval-internal `estimateCost`, but accepts an override map. Returns `0` for unknown models (eval cost columns shouldn't crash on a fresh model id). Re-exported from `@rudderjs/ai/eval` for back-compat.
  - `assertKnownModelPricing(model, pricing?)` — fail-loud variant for budget enforcement. Throws `UnknownModelPricingError` carrying the model id + catalog snapshot date so apps fail at construction instead of zero-costing through a typo'd model.
  - `BudgetExceededError` — error class shipped now so apps can `instanceof`-check against it from `withBudget({ onExceeded })` callbacks once phase 3 lands.

  Override entries by spreading: `pricing: { ...ModelPricing, 'anthropic/claude-opus-4-7': { inputPer1k: 0.012, outputPer1k: 0.060, _snapshotDate: '2026-01-15' } }`.

- e9d4dba: **A6 Phase 2 — `BudgetStorage` interface + `memoryBudgetStorage`.** Locks the persistence contract that `withBudget(...)` middleware (phase 3) and `ormBudgetStorage` (phase 4) both implement against.

  - `BudgetStorage.checkAndDebit(opts)` — atomically reads the current spend, adds `costUsd` if it stays within `cap`, returns `{ allowed, spent, cap }`. Atomic by contract: implementations must keep the read + write in a single critical section to prevent two concurrent callers both passing the check before either debits.
  - `memoryBudgetStorage()` — Map-backed in-process implementation. Atomic because `Map.get` / `Map.set` are synchronous; a concurrency test with 100 parallel `checkAndDebit` calls at the cap line confirms exactly `floor(cap/cost)` succeed. Cross-process caveat documented loudly: queue workers don't see the same Map, so apps with workers must use `ormBudgetStorage` (phase 4) or a Redis-backed storage.
  - `periodKey(period, now, timezone?)` — TZ-aware bucket key (`YYYY-MM-DD` for `daily`, `YYYY-MM` for `monthly`). Default UTC; pass an IANA name (`'America/Los_Angeles'`) for user-local rollover. Daily buckets in PST roll at PST midnight, even when that crosses UTC date or month boundaries.
  - `costUsd: 0` is a pure read — useful for "you've spent $X today" status displays without mutating the counter.
  - Validation: rejects negative / NaN / Infinity for `cap` and `costUsd` at debit time.
  - `reset?(userId, period, now?, timezone?)` — optional, useful for tests + admin overrides.

  Phase 3 will compose this with the pricing catalog from phase 1 to ship the user-facing `withBudget(...)` middleware.

- 0ec0abe: **A6 Phase 3 — `withBudget(...)` middleware.** Composes the pricing catalog (phase 1) and the `BudgetStorage` contract (phase 2) into the user-facing API. Per-user spend caps now enforce in production with a one-line install on any `Agent`.

  ```ts
  import { withBudget, memoryBudgetStorage } from "@rudderjs/ai";

  const budgeted = withBudget({
    user: (ctx) => ctx.context as string, // your app's user-id source
    budget: () => ({ daily: 0.5, monthly: 10 }), // USD
    storage: memoryBudgetStorage(), // ormBudgetStorage in phase 4
  });

  class MyAgent extends Agent {
    middleware() {
      return [budgeted];
    }
  }
  ```

  - **Pre-debit on `onIteration`** — fires before each model call (every step). Estimates input cost from the live messages array via the configured (or default) token estimator + `pricing[model].inputPer1k`. Calls `storage.checkAndDebit` with the estimate. Throws `BudgetExceededError` (or whatever your `onExceeded` throws) on the first denied period.
  - **True-up on `onUsage`** — fires after each step with the provider's reported usage. Computes actual cost from `promptTokens` + `completionTokens`, debits the delta over the pre-debit. Always-applies (`cap: MAX_SAFE_INTEGER`) since the response already streamed; the next request bites if the user is now over cap.
  - **Bypass** — `user` returning `null`/`undefined` skips enforcement (unauthenticated paths). `budget` returning neither `daily` nor `monthly` skips for that user.
  - **Custom error class** — `onExceeded` can throw your own subclass; if it doesn't throw, the middleware throws `BudgetExceededError` so the run never silently passes a denied debit.
  - **Daily AND monthly** — both caps may be set; first denial wins.
  - **Pricing override** — pass any `Record<string, ModelPriceEntry>` for negotiated rates: `pricing: { ...ModelPricing, 'anthropic/claude-opus-4-7': { inputPer1k: 0.012, outputPer1k: 0.060, _snapshotDate: '2026-01-15' } }`.
  - **Fail-loud on unknown model** — `assertKnownModelPricing` throws `UnknownModelPricingError` at iteration time if the agent's model isn't in the configured pricing catalog. Catches typos before they zero-cost through.

  Caveats:

  - **No refunds on errors.** If the provider call fails after the pre-debit, the estimate stays debited. Apps that need refund-on-error can subscribe `onError` and call `storage` directly.
  - **No cache-rate accounting.** `TokenUsage` does not yet expose `cacheReadInputTokens` / `cacheWriteInputTokens`; cached requests are billed at the full `inputPer1k` rate. A `TokenUsage` widening + this middleware integration is a phase 3.x follow-up.
  - **Tokenizer accuracy.** Default estimator is `Math.ceil(text.length / 4)` — fine for English-heavy prompts. Pass a tiktoken-backed `estimateTokens` for tight caps.

  Also widens `AiFakeStep` with optional `usage` so tests can specify realistic provider-side token counts (used by the budget integration tests; useful for any middleware that depends on usage).

- 5fa661d: **A6 Phase 4 — `ormBudgetStorage` + production-ready persistence.** Closes out #A6.

  ```ts
  import { withBudget } from "@rudderjs/ai";
  import { ormBudgetStorage } from "@rudderjs/ai/budget-orm";

  const budgeted = withBudget({
    user: (ctx) => ctx.context as string,
    budget: () => ({ daily: 0.5, monthly: 10 }),
    storage: ormBudgetStorage(), // was: memoryBudgetStorage()
  });
  ```

  - New subpath export `@rudderjs/ai/budget-orm` (lazy peer dep on `@rudderjs/orm`, mirrors `@rudderjs/ai/memory-orm`):
    - `ormBudgetStorage()` — production-ready `BudgetStorage` implementation
    - `OrmBudgetStorage` — class form for direct use
    - `BudgetUsageRecord` — Model row exposed for admin queries (top spenders, period rollups)
    - `budgetUsagePrismaSchema` — schema reference string for copy-paste
  - Schema lives at `playground/prisma/schema/ai.prisma` (alongside the existing `UserMemory` model). The `@@unique([userId, period, periodKey])` constraint is required — without it, the find-or-create path can race and produce duplicate rows that silently break cap accounting.
  - `checkAndDebit` uses find-or-create + atomic `Model.increment`. The unique constraint catches first-write races; the storage refetches and falls through to the increment path on a `create` collision.
  - `costUsd: 0` is the pure-read path; doesn't touch storage on an empty bucket.
  - Single debit larger than cap on an empty bucket refuses without creating a row (no polluting storage with denied requests).
  - `reset(userId, period, now?, timezone?)` deletes the bucket for tests + admin overrides.

  # Atomicity caveat

  The cap check is read-then-conditional-increment. The increment itself is atomic (`UPDATE col = col + n`), but under high concurrency for a single user, two callers can both pass the check before either debits — total spend may briefly exceed `cap` by up to `costUsd × concurrency`. For typical apps (1–2 in-flight requests per user) this is negligible. Strict guarantees require serializable transactions or a Redis-backed counter — both planned as follow-ups.

- 871e27e: **A7 Phase 1 — computer-use action vocabulary + Playwright executor.** Foundation for the upcoming `computerUseTool({ page })` factory (phase 2). Mirrors Anthropic's `computer_20250124` action schema verbatim so phase 2 can map cleanly to Anthropic's native tool block.

  - `ComputerAction` — discriminated union covering every action Anthropic's `computer_20250124` tool emits: `screenshot`, `cursor_position`, `wait`, `mouse_move`, `left_click` / `right_click` / `middle_click` / `double_click` / `triple_click` (with optional modifier text), `left_mouse_down` / `left_mouse_up` (drag), `type`, `key` (chord), `hold_key`, `scroll`.
  - `executeComputerAction(page, action, state)` — async dispatcher against a Playwright `Page`. Updates `state.cursor` after every coordinate-targeted action so `cursor_position` can answer. Never throws — Playwright failures surface as `{ type: 'error', text }` for the agent loop to forward as a tool-result with `is_error: true`.
  - `PageLike` — structural Playwright `Page` subset. Lets `@rudderjs/ai` type-check and execute without taking a hard dependency on the `playwright` package (which carries a 300MB+ Chromium download). Apps install Playwright themselves and pass `page` in.
  - `makeExecutorState()` — constructs the per-run cursor-tracking state. Threaded through every call within an agent run.
  - `parseModifiers`, `normalizeKey`, `normalizeChord` — translate Anthropic / xdotool key naming (`ctrl`, `cmd`, `Return`) to Playwright's (`Control`, `Meta`, `Enter`).

  Subpath export: `@rudderjs/ai/computer-use`. Module is Node-only in practice (Playwright); main entry stays runtime-agnostic.

  ```ts
  import { chromium } from "playwright";
  import {
    executeComputerAction,
    makeExecutorState,
  } from "@rudderjs/ai/computer-use";

  const page = await (await chromium.launch()).newPage();
  await page.setViewportSize({ width: 1280, height: 800 });

  const state = makeExecutorState();
  const screen = await executeComputerAction(
    page,
    { action: "screenshot" },
    state
  );
  await executeComputerAction(
    page,
    { action: "left_click", coordinate: [400, 200] },
    state
  );
  ```

  Phase 2 (next PR) wires this through `computerUseTool({ page })` — the agent tool factory that emits Anthropic's native `computer_20250124` block at the API level and routes execution through this executor. Non-Anthropic models will throw `ComputerUseProviderError` at agent boot.

  See `docs/plans/2026-05-10-ai-computer-use.md` for the full A7 plan.

- 5677b85: **A7 Phase 2 — `computerUseTool({ page })` factory + Anthropic native tool block.** Wires phase-1's executor into the agent loop. The tool maps to Anthropic's native `computer_20250124` tool block at the API level — Claude is fine-tuned on that exact tool, so quality is dramatically better than a generic function-call wrapper.

  ```ts
  import { Agent } from "@rudderjs/ai";
  import { computerUseTool } from "@rudderjs/ai/computer-use";
  import { chromium } from "playwright";

  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });

  class BrowserAgent extends Agent {
    model() {
      return "anthropic/claude-opus-4-7";
    }

    tools() {
      return [
        computerUseTool({
          page,
          viewport: { width: 1280, height: 800 },
          model: this.model(), // upfront provider check (recommended)
        }),
      ];
    }
  }
  ```

  - **`computerUseTool({ page, viewport?, model?, needsApproval?, maxActions?, state? })`** — plain object tagged with `Symbol.for('rudderjs.ai.computer-use')` (mirrors `HANDOFF_MARKER`). Tool name is fixed to `'computer'` (Anthropic-trained). `model` (optional) fails loud with `ComputerUseProviderError` for non-Anthropic models; without it, validation is deferred. `needsApproval` defaults to `true` and forwards through the standard approval channel. `maxActions` defaults to `50` per agent run; exceeding throws `ComputerUseLimitError`.
  - **`ComputerUseProviderError`** (`code: 'COMPUTER_USE_PROVIDER_MISMATCH'`) and **`ComputerUseLimitError`** (`code: 'COMPUTER_USE_LIMIT_EXCEEDED'`) — both extend `Error`, both carry stable `code` fields for app `instanceof` + `.code` dispatch.
  - **`isAnthropicLikeModel(model)`** — helper recognizing `anthropic/*` and `bedrock/<region.>?anthropic.*` (covers cross-region inference profiles `us.anthropic.*`, `eu.anthropic.*`, `apac.anthropic.*`). Excludes OpenRouter-routed Anthropic models — OpenRouter goes through the OpenAI SDK with a different base URL, so Anthropic's native computer-use block can't reach the wire.
  - **`isComputerUseTool(t)`** typeguard for adapters / observers.

  **Anthropic adapter changes** (`packages/ai/src/providers/anthropic.ts`):

  - `toAnthropicTools` recognizes `providerHint?.type === 'computer-use'` and emits the native `{ type: 'computer_20250124', name, display_width_px, display_height_px }` block instead of the standard function-call shape. Honors `providerHint.tool` for forward-compat with future schema versions.
  - `toAnthropicMessages` widens tool-message content handling: `string` passes through unchanged; `ContentPart[]` expands via the existing `contentToAnthropicParts` helper (so screenshot results emit as Anthropic's `content: [{ type: 'image', source: { type: 'base64', media_type, data } }]` shape); other values JSON-stringify (legacy fallback). Generic enhancement — useful for any future tool that wants to return rich content.

  **`ToolDefinitionSchema`** gains an optional **`providerHint?: ProviderHint`** field. Adapters that recognize the `type` substitute their native serialization; others ignore it and emit the standard function-call shape. Currently used only by `@rudderjs/ai/computer-use`; opens the door for OpenAI / Google native tool blocks later.

  **Out of this phase, deferred:**

  - **Phase 3 — playground demo.** `playground/app/Agents/BrowserAgent.ts` + `/demos/browser` page wiring this end-to-end with a real Chromium and a streaming agent run. Lands in the next PR.
  - **OpenAI native `computer_use_preview`** mapping. `providerHint` mechanism is in place; add when the API leaves preview and quality is competitive.
  - **Function-call wrapper fallback** for non-native providers. Becomes a `wrapperFallback: true` opt on `computerUseTool` once a customer asks.
  - **Custom `ComputerEnvironment` interface.** Today the tool takes a Playwright `Page` directly. If a second backend appears (Puppeteer, remote VNC, Docker sandbox), introduce an interface and keep `page` as the Playwright shorthand.

  Plan: `docs/plans/2026-05-10-ai-computer-use.md`.

- a5f49fe: **A5 Phase 1 — built-in eval framework.** A new subpath at `@rudderjs/ai/eval` ships `evalSuite()` + `runSuite()` + 3 metrics + a console reporter. `AiFake` proves your agent's wiring works; evals prove it does the right thing on real models.

  - **`evalSuite(name, { agent, cases, timeout? })`** — frozen suite definition. Each case is `{ input, assert: Metric, name?, agent?, timeout?, skip? }`. Per-case `agent` and `timeout` override the suite-level defaults; `skip: true` or `skip: 'reason'` skips without calling the agent.
  - **`runSuite(suite)`** — serial runner that walks every case and never throws. Agent errors AND assertion throws become `failed` rows with the message in `reason`. Returns a `SuiteReport` with cases, totals, duration, and cost rollup.
  - **Three built-in metrics:** `exactMatch(string)`, `regex(RegExp)`, `llmJudge(criterion, opts?)`. The judge runs as a one-shot anonymous agent (no recursion concern — default `remembers()` is `false`) with `Output.object({ schema })` JSON-mode parsing. Judge token usage rolls into the case's cost via a `Symbol.for('rudderjs.ai.eval.judgeUsage')` side-channel.
  - **User-defined metrics** implement `(response, ctx) => MetricResult` — no inheritance, no decorators. The catalog is a starting set, not a closed enum.
  - **`reportConsole(report, sink?)`** — default reporter; emits a glyph table (✓/✗/○) with cost + tokens. Returns the report unchanged for chaining.
  - **`estimateCost(model, prompt, completion)`** — minimal hardcoded `ModelPricing` subset (Anthropic, OpenAI, Google — the 7 most common models). A6 will ship the full versioned catalog.
  - **Subpath `@rudderjs/ai/eval`** — keeps the metrics catalog out of the main runtime entry. No new peer deps; reuses `Output.object` from main entry, `agent()` factory from `agent.ts`.

  ```ts
  // evals/support-agent.eval.ts
  import { evalSuite, llmJudge, exactMatch, regex } from "@rudderjs/ai/eval";
  import { SupportAgent } from "../app/Agents/SupportAgent.js";

  export default evalSuite("SupportAgent", {
    agent: () => new SupportAgent(),
    cases: [
      {
        name: "password reset",
        input: "How do I reset my password?",
        assert: llmJudge("mentions a password reset link"),
      },
      { name: "price", input: "How much?", assert: exactMatch("$99/month") },
      { name: "support", input: "Contact?", assert: regex(/support@/) },
    ],
  });
  ```

  Run programmatically today via `runSuite()`. Phase 2 adds `pnpm rudder ai:eval` for CLI-driven discovery; Phase 3 adds `jsonShape` / `semanticMatch` / `tokenCost`; Phase 4 adds `--record` / `--replay` + telescope integration; Phase 5 adds an HTML report.

  28 new tests covering suite definition validation, every built-in metric (including llmJudge fallbacks for unparseable judge responses + missing judge model), runner ordering / skip / per-case timeout / per-case agent override / agent-error-as-failed-row / assertion-throw-as-failed-row, judge token side-channel cleanup, `estimateCost` for 3 known models + 1 unknown (graceful 0), and the console reporter's glyphs + skip-reason rendering.

- f06331e: **A5 Phase 2 — `pnpm rudder ai:eval` CLI + JSON reporter.** Phase 1 shipped the eval framework; Phase 2 makes it a first-class command. The CLI walks `evals/**/*.eval.ts` (override via `config('ai').eval.pattern`), runs each suite serially, and reports pass/fail + cost + tokens.

  - **Console mode** (default) — uses Phase 1's `reportConsole` per suite.
  - **`--json`** — emits a `{ suites: [{ suite, passed, failed, cases: [{ name, status, pass, score?, reason?, tokens, cost, duration }] }] }` envelope to stdout. CI scripts can pipe directly into `jq`; matches the `command_run` MCP tool envelope shape so the boost agent surface and the eval CLI feel like one family.
  - **`--bail`** — stop on the first failing suite. Pairs with `--json` so a failing CI run streams the first failure without waiting for the rest.
  - **Positional name filter** — `pnpm rudder ai:eval support` runs only suites whose `name` includes `'support'` (case-insensitive substring).

  Exits 0 when every case passes, 1 otherwise (also 1 when no suites match in console mode; `--json` always exits 0 with an empty envelope so `jq` consumers don't crash).

  Phase 3 adds `jsonShape`/`semanticMatch`/`tokenCost` metrics; Phase 4 adds `--record`/`--replay` (AiFake-backed) + telescope `agent.eval.completed` events; Phase 5 adds the HTML report.

- 3ee9a97: **A5 Phase 3 — `jsonShape` / `semanticMatch` / `tokenCost` + `compose`.** Three new built-in metrics for `@rudderjs/ai/eval` plus a composition helper.

  - **`jsonShape(schema: z.ZodType)`** — strict structural assertion. Strips ` ``` ` / ` ```json ` fences from `response.text`, parses, runs `safeParse`. On failure surfaces the zod issue path (e.g. `customer.email`) so debugging doesn't require a separate console log. Pairs naturally with `Output.object({ schema })` on the agent.
  - **`semanticMatch(reference, opts?)`** — embedding-based fuzzy match. Embeds both `reference` and `response.text` via `AI.embed()`, computes pure-JS cosine, passes when score >= `opts.threshold` (default `0.85`, tighter than `EmbeddingUserMemory`'s 0.5 retrieval-rank floor since this is an assertion, not a ranking). Embed token usage rolls into the case's cost rollup via the same side-channel `llmJudge` already uses.
  - **`tokenCost(threshold)`** — passes when `response.usage.totalTokens <= threshold`. Detects prompt-size regressions before they show up as a billing surprise.
  - **`compose(...metrics)`** — runs metrics in order, short-circuits on the first failure, surfaces its reason. Awaits async metrics in declaration order.

  Internal: the `judgeUsage` side-channel symbol is renamed to `extraUsage` so the embed cost from `semanticMatch` can ride the same channel without misleading naming. No public API change — the symbol is internal-only.

  Phase 4 adds `--record` / `--replay` (AiFake-backed) + telescope `agent.eval.completed` events; Phase 5 adds the HTML report.

- a35c600: **A5 Phase 4 — `--record` / `--replay` + `agent.eval.completed` observer event.** Deterministic regression tests for AI agents and a hook for telescope dashboards.

  - **`pnpm rudder ai:eval --record [name-filter]`** runs each case against the real provider and writes the assistant turns to `evals/__fixtures__/<suite>/<case>.json`. Existing fixtures are overwritten — diff in your VCS to see what changed.
  - **`pnpm rudder ai:eval --replay [name-filter]`** swaps the runtime with `AiFake.fake()` and feeds each case its recorded fixture via `respondWithSequence`. Zero API calls, zero cost, deterministic. Cases without a fixture fall through to a normal run with a stderr warning. `--record` and `--replay` are mutually exclusive.
  - **`agent.eval.completed`** AiEvent variant (`{ kind, suite, case, status, pass, score?, reason?, tokens, cost, duration }`) emits after each case completes — including skipped cases, so dashboards can surface coverage gaps. Telescope's AI collector will land an "Evals" tab in a follow-up to aggregate pass-rate per `(suite, case)` over time.
  - **`stepsFromResponse(response)`** + `EvalFixture` type re-exported from `@rudderjs/ai/eval` so external tooling (custom CI scripts, alternative replay engines) can compose without duplicating the extraction logic.

  **Fixture format** is versioned (`version: 1`); reading a future-versioned fixture throws to force re-record rather than silently mis-replay. Suite/case names are slugified for filesystem safety (non-`[A-Za-z0-9._-]` collapses to `-`).

  **Internal:** record/replay are implemented as a per-case `agent`/`assert` decoration — the `runSuite` runner stays unchanged. Replay pre-loads every fixture for a suite up-front so the per-case factory can prime `AiFake.respondWithSequence` synchronously.

  **Out of scope (deferred to follow-ups):** `--check-fixtures` flag for catching non-deterministic agents, the telescope dashboard "Evals" tab, and Phase 5's HTML report.

- c17731f: **A5 Phase 5 — HTML report + suite metadata.** Closes out the eval framework roadmap.

  - **`pnpm rudder ai:eval --html <path>`** writes a self-contained HTML report to the given path. Inline CSS, minimal vanilla JS for row expand/collapse — no framework, no external assets. Pasteable into PR comments / Slack threads, openable offline. Coexists with `--json` (JSON still goes to stdout, HTML goes to disk). Defaults `path` resolution to the app cwd; intermediate directories are created.
  - **`evalSuite('Name', { ..., metadata: { owner, lastReviewed, ticket } })`** — optional ownership / context, surfaced in the HTML report header. Open shape (`[k: string]: string | undefined`) so teams can attach custom keys; the report renders `camelCase` → `Title Case` for the well-known `lastReviewed` and passes others through verbatim.
  - **`reportHtml(reports, opts?)`** — pure function exported from `@rudderjs/ai/eval` for programmatic use (e.g. emitting a report from a custom CI script). Defensive HTML-escape on every piece of user content (suite/case names, input, response, metadata, reasons).
  - **`CaseResult.input`** is now always populated; **`CaseResult.responseText`** is set when the agent produced a response (omitted when the agent threw or the case was skipped). Threads through `runSuite` so reporters and external tooling can render the prompt + response alongside pass/fail.
  - **`SuiteReport.metadata`** copies through from the spec when set so reporters can pick it up without re-reading the suite definition.

  Phase 5 is the last A5 phase. The remaining surface — `--check-fixtures` for catching non-deterministic agents, the telescope dashboard "Evals" tab — lives outside the framework.

- d558a42: **MCP ↔ Agent bridge** — `@rudderjs/ai/mcp` ships two paired connectors that close the loop between `@rudderjs/ai` and the Model Context Protocol. Net-new differentiator: Laravel ships neither side.

  - `mcpClientTools(transport, opts?)` — connect to a remote MCP server (URL string for HTTP, `{ command, args }` for a stdio subprocess, or an already-connected SDK Client) and surface its tools as agent `Tool[]`. Remote JSON Schema flows through verbatim — no zod round-trip — via the new `jsonSchema` passthrough on `ToolDefinitionOptions`. The returned array carries a non-enumerable `close()` for shutdown when this call owns the client.
  - `mcpServerFromAgent(AgentClass, opts?)` — wrap an `Agent` as an MCP server, returned as the SDK's `McpServer` (connect with any SDK transport — stdio, HTTP). Three exposure modes: `'tools'` (default; one MCP tool per `agent.tools()` entry), `'agent'` (one prompt-tool runs the whole agent — the marquee differentiator), or `'both'`.
  - `ToolDefinitionOptions.jsonSchema?: Record<string, unknown>` — pre-built JSON Schema escape hatch for tools whose shape is constructed dynamically (MCP imports today; OpenAPI generators next). When set, takes precedence over `inputSchema` on the wire to providers.

  `@modelcontextprotocol/sdk` is an optional peer dependency — apps that don't import the `/mcp` subpath aren't forced to install it.

- 3d976cc: **B7 Phase 2 — `similaritySearch({ model, column, embedWith })` agent tool + auto-embed lift in `whereVectorSimilarTo`.** Wires Phase 1's pgvector primitives into the agent loop. Models emit a natural-language `query`; the tool embeds it, runs a `whereVectorSimilarTo` search, and returns top-K rows with similarity scores.

  ```ts
  import { Agent } from "@rudderjs/ai";
  import { similaritySearch } from "@rudderjs/ai";
  import { Document } from "./app/Models/Document.js";

  class KnowledgeAgent extends Agent {
    tools() {
      return [
        similaritySearch({
          model: Document,
          column: "embedding",
          embedWith: "openai/text-embedding-3-small",
          minSimilarity: 0.7,
          limit: 10,
        }),
      ];
    }
  }
  ```

  `@rudderjs/ai`:

  - **`similaritySearch({ model, column, embedWith, metric?, minSimilarity?, limit?, name?, description?, projectResult? })`** — exported from the main entry (`@rudderjs/ai`). Returns a `ServerToolBuilder` whose `inputSchema` is `z.object({ query: z.string().min(1) })`. Default tool name: `similarity_search_<model_lowercase>`. `embedWith` is required — fails loud at factory construction if missing, mirroring A6's `assertKnownModelPricing` pattern (no silent default-route to `AiRegistry.getDefault()`).
  - **Execute flow:** `query` → `AI.embed(query, { model: embedWith })` → `model.query().whereVectorSimilarTo(column, vector, { metric, minSimilarity }).selectVectorDistance(...).limit(limit).get()` → `{ row, similarity }[]`. The internal distance alias is read off each row at result time and converted to `similarity = 1 - distance` (cosine convention; documented for non-cosine metrics).
  - **`toModelOutput`** default formatter: `(0.85) {"id":1,"content":"..."}` per hit, newline-joined, with the internal alias stripped from the JSON. Empty-state returns `"No similar <Model> records found."`. Override via `projectResult: (row, similarity) => string` for custom shapes.

  `@rudderjs/orm-prisma`:

  - **`whereVectorSimilarTo(column, '<string>', { embedWith })`** no longer throws — auto-embed is **deferred** to terminal time so the chain stays sync. The string + model id get stored on the vector clause and resolved when `.get()` / `.first()` runs by lazy-loading `@rudderjs/ai` via `resolveOptionalPeer('@rudderjs/ai')`. `MissingEmbedderError` still fires when `embedWith` is omitted.
  - **`@rudderjs/ai` is a new optional peer** of `@rudderjs/orm-prisma`. Apps that don't do RAG never load AI. `@rudderjs/support` is a new regular dep (for `resolveOptionalPeer`).

  **Phase 2 limitations** (lifted in Phase 2.5):

  - **Standalone vector queries only.** `similaritySearch` doesn't support a `scope` callback yet — agents see every row in the corpus that matches the vector. Apps needing tenant/user filtering today can pre-fetch IDs in user code and post-filter the result set.
  - The chained `.where()` lift on `whereVectorSimilarTo` ships in Phase 2.5 alongside `scope`.

  Plan: `docs/plans/2026-05-10-b7-vector-storage.md` (updated to reflect the Phase 2 / 2.5 split).

- f80d2c1: **A4 Phase 1 — `UserMemory` interface + in-memory backend + DI wiring.** Foundation for per-user memory beyond conversation history (Mem0-style); the auto-inject and auto-extract runtimes land in Phase 2 and 3.

  - `UserMemory` interface — `remember()` / `recall()` / `forget()` / `list()` (and optional `forgetAll()` for GDPR cascades). Drop-in alongside `ConversationStore`; backends range from in-process to ORM-backed to embedding-backed.
  - `MemoryUserMemory` — in-process Map-backed implementation. Substring-match `recall()` (case-insensitive against fact + tags), tag-intersection filtering, per-user isolation. Ships in the runtime-agnostic main entry — no `node:` imports.
  - `Agent.remembers()` — class hook returning `false | RemembersSpec | Promise<…>`. Default `false` (memory-stateless); subclasses opt in by returning `{ user, inject?, extract?, tags?, … }`. Mirrors `Agent.conversational()`.
  - `AgentPromptOptions.memory?: false | RemembersSpec` — per-call override with the same precedence chain (per-call > class).
  - `AiConfig.memory?: UserMemory` — config key wired by `AiProvider`. Bound to the `ai.memory` DI key and to the module-level `setUserMemory()` registry that Phase 2/3 middleware will consume.
  - `resolveRemembersSpec()` — shared resolver used by the upcoming auto-inject middleware. Public re-export so apps reading the spec manually get the same precedence rules.

  Phase 1 introduces no runtime behavior change to existing agents — `remembers()` defaults to `false` and nothing in the prompt loop reads the spec yet. Apps can already wire a backend via `AiConfig.memory` and call it manually through `app().make<UserMemory>('ai.memory')`.

- 3347acd: **A4 Phase 2 — auto-inject middleware for user memory.** `Agent.remembers().inject === 'auto'` now actually injects facts; the declaration shipped in Phase 1 finally has a runtime.

  - `withMemoryInject(spec, opts?)` — exported `AiMiddleware` factory. Runs in `onStart` (async, so `recall()` can await), reads the latest user message from `ctx.messages`, calls `mem.recall(spec.user, userText, { limit, tags })`, renders matched facts as a fenced `<user-memory>…</user-memory>` block, and prepends them to the system message in place. Skips silently when no `UserMemory` is registered, no facts match, or the budget can't fit even one entry.
  - **Auto-cascade** — when `Agent.remembers()` returns `{ inject: 'auto', … }`, `Agent.prompt()` / `Agent.stream()` install `withMemoryInject` automatically before the loop runs. Continuation calls (`options.messages` set) skip injection so the system prompt isn't double-augmented across tool round-trips. Sync fast path preserved when both `conversational()` and `remembers()` declare nothing.
  - **Token-budget enforcement** — `spec.injectTokenBudget` drops lowest-score facts first (undefined scores treated as 0.5). Default `~4 chars/token` estimator; override via `MemoryInjectOptions.estimateTokens`.
  - **Recall improvement (Phase 1 carryover)** — `MemoryUserMemory.recall()` switches from naive substring match to **case-insensitive token overlap** (≥3-char tokens, alphanumeric split). Natural-language queries like "what is my project?" now pull facts containing "project" without forcing the caller to extract keywords. The Phase 1 single-word recall test continues to pass; the change is strictly more lenient.
  - **Internal: `Symbol.for('rudderjs.ai.extraMiddlewares')` slot on options** — the auto-cascade plumbs framework-injected middlewares through this hidden slot so `getMiddleware(a, options)` can append them after `agent.middleware()` without polluting `AgentPromptOptions`'s public surface. Phase 3 (auto-extract) will reuse the slot.

  ```ts
  class SupportAgent extends Agent {
    remembers() {
      return {
        user: "user_123",
        inject: "auto",
        tags: ["support"],
        injectLimit: 5,
        injectTokenBudget: 400,
      };
    }
  }

  // Recall fires before each model call; the matching facts get
  // prepended to the system message as a `<user-memory>` block.
  await new SupportAgent().prompt("Where does my project deploy?");
  ```

- 08e3603: **A4 Phase 3 — auto-extract middleware for user memory.** `Agent.remembers().extract === 'auto'` (with an `extractWith` model) now distills durable facts from each successful turn and writes them via `mem.remember()` — the third piece of the runtime that the Phase 1 declaration promised.

  - `withMemoryExtract(spec, opts?)` — exported `AiMiddleware` factory. Runs in `onFinish` (only fires on successful runs, so failed turns don't pollute memory). Pulls the latest `[user, assistant]` turn from `ctx.messages`, calls a one-shot anonymous agent on the small model (`spec.extractWith`) with an `Output.object({ schema })` prompt asking for `{ facts: [{ fact, score, tags? }] }`, filters by confidence threshold, unions `spec.tags` into each entry, and writes via `mem.remember()`.
  - **Auto-cascade extension** — the existing memory cascade in `Agent.prompt` / `Agent.stream` now installs both inject (Phase 2) AND extract (Phase 3) middlewares when each is opted in. Continuation calls (`options.messages` set) skip BOTH so the same facts aren't double-written across tool round-trips.
  - **Confidence threshold** — `MemoryExtractOptions.threshold` defaults to `0.7`; facts below the floor are dropped before any `remember()` call. Tighten for high-risk domains; this is the v1 mitigation for the memory-poisoning pitfall.
  - **Audit hook** — `MemoryExtractOptions.onExtracted(entries)` fires after a successful write with the persisted entries. Use it to stream into telescope, write an audit log, or assert in tests.
  - **Failure swallow** — extract errors (network, JSON parse, zod validation, `remember()` throw) route through `MemoryExtractOptions.onError` and are otherwise swallowed. The parent prompt never breaks because of memory work.

  ```ts
  class SupportAgent extends Agent {
    remembers() {
      return {
        user: "user_123",
        inject: "auto",
        extract: "auto",
        extractWith: "anthropic/claude-haiku-4-5",
        tags: ["support"],
      };
    }
  }

  // On success, durable facts get distilled and written. The next turn
  // will see them via auto-inject's recall.
  await new SupportAgent().prompt("hi, my project Foo lives at /var/www/foo");
  ```

- 71c6330: **A4 Phase 4 — `OrmUserMemory` production backend.** A new subpath at `@rudderjs/ai/memory-orm` ships an ORM-backed `UserMemory` that persists facts via the registered `@rudderjs/orm` adapter — drop-in alongside Phase 1's in-process `MemoryUserMemory`, but durable across restarts and queryable from outside the framework.

  - `OrmUserMemory` — implements the `UserMemory` interface against the `@rudderjs/orm` `Model` API. Works on Prisma today; Drizzle works the moment the user's tables are wired (`tables: { userMemory: <table> }` on the `drizzle()` config).
  - `UserMemoryRecord` — the `Model` row backing the store. Exposed so apps that want their own queries (admin views, audit dumps) don't have to route everything through the `UserMemory` interface.
  - `userMemoryPrismaSchema` — exported reference Prisma schema string. Also dropped into `playground/prisma/schema/ai.prisma` for the demo. Includes a deliberately-nullable `embedding Bytes?` column so Phase 5's `EmbeddingUserMemory` lands as additive — no follow-up migration when you upgrade.
  - New peer dep `@rudderjs/orm` (optional) — only consumers of the `/memory-orm` subpath pull it in.

  ```ts
  // config/ai.ts
  import { OrmUserMemory } from "@rudderjs/ai/memory-orm";
  import type { AiConfig } from "@rudderjs/ai";

  export default {
    default: "anthropic/claude-sonnet-4-5",
    providers: {
      /* ... */
    },
    memory: new OrmUserMemory(),
  } satisfies AiConfig;
  ```

  **Recall semantics:** case-insensitive **OR-of-LIKE token overlap** on the `fact` column — mirrors `MemoryUserMemory.recall()` so the two backends are swap-compatible. Query tokenizes on non-alphanumeric boundaries (≥3-char tokens) and any row matching at least one token via `LIKE %tok%` is returned.

  **Tags:** persist as JSON-encoded `String?`. Tag-filter recall happens JS-side after fetch — pushing array filtering into the WHERE is adapter-specific (Postgres `String[]`, SQLite JSON contains) and lands in a follow-up. Same trade-off Prisma shows you when you pick `String?` over `String[]` for portability.

  19 new tests covering `remember` round-trip, `list` (insertion order, tag intersection, limit), `recall` (single-token + multi-token OR-of-LIKE, tag scope, limit, empty/no-match), `forget` (owner check + idempotent on unknown id), `forgetAll`, plus `UserMemoryRecord.getTags()` JSON parsing edge cases and the schema snapshot. Test fixture is a Map-backed in-process adapter that satisfies the `OrmAdapter` interface — no real DB required.

- 7f42235: **A4 Phase 5 — `EmbeddingUserMemory` with cosine recall + GDPR cascade.** Closes out the A4 roadmap item. A new subpath at `@rudderjs/ai/memory-embedding` ships an embedding-backed `UserMemory` that composes Phase 4's `OrmUserMemory` with the registered embedding provider for semantic recall.

  - **`EmbeddingUserMemory`** — composes `OrmUserMemory` + `AI.embed()`. `remember()` embeds the fact and writes the Float32-packed vector into the row's `embedding` column (added to the schema in Phase 4 as nullable, populated now). `recall()` embeds the query and ranks the user's facts by **pure-JS cosine similarity**.
  - **GDPR right-to-be-forgotten cascades automatically** — the embedding lives in the same row as the fact, so `forget()` / `forgetAll()` delete both. No second store to keep in sync.
  - **Backward compat with Phase 4** — rows whose `embedding` is null fall back to token-overlap on `fact` (`nullEmbeddingFallback: 'token-overlap'` default). Upgrading from `OrmUserMemory` to `EmbeddingUserMemory` doesn't lose recall on existing rows; new `remember()` calls populate the column going forward. Override to `'skip'` for strict embedding-only semantics.
  - **`UserMemoryRecord.embedding` field added** to the existing class (Phase 4's class deliberately omitted it). `static fillable` extended to allow `embedding` on `Model.update()` calls.
  - **Failure swallow** — `embed()` failures (network, missing peer SDK) don't break the parent. `remember()` persists the entry with `embedding === null`; `recall()` falls back to token-overlap.
  - **`serializeVector` / `deserializeVector` / `cosineSimilarity` exported** for B7 (pgvector adapter) and any third-party backends. Float32 packing (4 bytes/dim); 1536-dim OpenAI vectors compress to 6144 bytes. `deserializeVector` honors `Uint8Array.byteOffset` for safe sub-views.

  ```ts
  import { OrmUserMemory } from "@rudderjs/ai/memory-orm";
  import { EmbeddingUserMemory } from "@rudderjs/ai/memory-embedding";

  export default {
    default: "anthropic/claude-sonnet-4-5",
    providers: {
      /* ... */
    },
    memory: new EmbeddingUserMemory({
      inner: new OrmUserMemory(),
      model: "openai/text-embedding-3-small",
      threshold: 0.5,
    }),
  } satisfies AiConfig;
  ```

  20 new tests covering the full lifecycle: `remember` populates the embedding column (and stays null on embed failure), `recall` ranks by cosine + applies threshold + applies tags + applies limit, fallback to token-overlap when query embed fails, fallback for null-embedding rows, `'skip'` mode drops null-embedding rows, `forget` cascades the embedding with the row, `forgetAll` does the same in bulk, `list` delegates unchanged. Plus `serializeVector` / `deserializeVector` / `cosineSimilarity` round-trips and edge cases (1536-dim vector, sliced `Uint8Array`, zero magnitudes, length mismatch).

  **A4 roadmap complete.** Phase 1 → Phase 5 all shipped — interface, in-process backend, auto-inject, auto-extract, ORM backend, and embedding backend with GDPR cascade.

- f133d08: **B7 Phase 2.5 — `scope` callback on `similaritySearch` + chained `.where()` lift in `whereVectorSimilarTo`.** Tenant / publication / soft-delete filtering for RAG agents, no over-fetching, no user-side post-filtering. The chain pre-filters in SQL.

  ```ts
  import { similaritySearch } from "@rudderjs/ai";
  import { Document } from "./app/Models/Document.js";

  class KnowledgeAgent extends Agent {
    tools() {
      return [
        similaritySearch({
          model: Document,
          column: "embedding",
          embedWith: "openai/text-embedding-3-small",
          limit: 10,
          scope: (q) =>
            q.where("tenantId", currentTenant).where("published", true),
        }),
      ];
    }
  }
  ```

  `@rudderjs/orm-prisma`:

  - `_getViaVector` composes flat `.where()` / `.orWhere()` chains into the vector SQL via a new `clauseToSql(clause, params[])` helper. Operators: `=`, `!=`, `>`, `>=`, `<`, `<=`, `LIKE`, `NOT LIKE`, `IN`, `NOT IN`. `null` values on `=` / `!=` map to `IS NULL` / `IS NOT NULL`. Empty `IN` short-circuits to `FALSE`; empty `NOT IN` to `TRUE` (Postgres rejects empty IN-lists).
  - User-supplied values bind through positional `$N` placeholders to `$queryRawUnsafe(sql, ...params)` — defense-in-depth against SQL injection. Vector min-similarity stays inlined (numeric, safe).
  - Polymorphic / pivot relation predicates (resolved via `_resolveDeferred`) flow through as flat `IN` / `NOT IN` clauses transparently.
  - Soft-delete scoping (`withTrashed` / `onlyTrashed`) flows into the SQL alongside user wheres.
  - **Still throws (out of scope for 2.5):** `.with()` (eager load), `whereGroup` / `orWhereGroup` (sub-builders pre-flatten to Prisma filter objects so the original `WhereClause[]` is lost), direct `whereHas` / `whereDoesntHave`, aggregates, redundant `.orderBy()`. Documented in the throw messages.

  `@rudderjs/ai`:

  - `similaritySearch({ scope })` accepts an optional `(q: SimilaritySearchQueryBuilder<T>) => SimilaritySearchQueryBuilder<T>` callback that runs before `whereVectorSimilarTo` attaches.
  - `SimilaritySearchQueryBuilder<T>` widened with `where(col, op?, val)` / `orWhere(...)` / `withTrashed?()` / `onlyTrashed?()` overloads so the scope callback gets autocomplete. Main entry still has zero `@rudderjs/contracts` runtime dep — types only.
  - New exported `SimilaritySearchWhereOperator` alias mirrors contracts' `WhereOperator` so apps writing scope callbacks don't have to import `@rudderjs/contracts`.

  `@rudderjs/contracts`:

  - JSDoc on `QueryBuilder.whereVectorSimilarTo` updated to reflect the lifted restriction. No surface change.

  Plan: `docs/plans/2026-05-10-b7-vector-storage.md` (Phase 2.5 marked in flight).

- a37e361: **B8 Phase 1 — `VectorStores` facade + OpenAI hosted-vector-store adapter.** Apps can now manage OpenAI's hosted vector stores end-to-end (`VectorStores.create()` / `.list()` / `.get()` / `.delete()`; `VectorStore.add()` / `.remove()` / `.files()` / `.delete()`) with no SDK boilerplate. Phase 2 will add the `fileSearch` agent tool that consumes these stores; Phase 3 adds the local pgvector fallback bridge.

  ```ts
  import { VectorStores } from "@rudderjs/ai";

  const store = await VectorStores.create("Knowledge Base", {
    metadata: { team: "support" },
    expiresAfter: { anchor: "last_active_at", days: 7 },
  });

  // Upload + attach + poll until indexed (default wait: true).
  await store.add({
    filePath: "./report.pdf",
    attributes: { author: "Alice", year: 2026 },
  });

  // Or skip the upload if you already have an OpenAI file id.
  await store.add({ fileId: "file_abc", wait: false });

  const all = await VectorStores.list();
  await VectorStores.delete(store.id);
  ```

  `@rudderjs/ai`:

  - **`VectorStoreAdapter` contract** added to `ProviderFactory.createVectorStores?()` — provider-agnostic CRUD over hosted vector stores, plus `addFile` / `removeFile` / `listFiles`. New types: `VectorStoreInfo`, `VectorStoreFileInfo`, `VectorStoreCreateOptions`, `VectorStoreAddOptions`, `VectorStoreListOptions`, `VectorStoreList`, `VectorStoreFileList`.
  - **`AiRegistry.resolveVectorStores(providerName)`** — resolves the registered provider's vector-store adapter; throws a helpful error pointing at `similaritySearch()` over a local pgvector model when the provider doesn't implement the contract.
  - **`OpenAIVectorStoreAdapter`** wraps `client.vectorStores.*` + `client.vectorStores.files.*` from the v4+ SDK. Lazy SDK load mirrors the rest of the OpenAI provider. File upload pipeline reuses the Files API (`files.create({ purpose: 'assistants' })`). Per-file searchable metadata routes through OpenAI's `attributes` field — Phase 2's `fileSearch({ where })` filters on these.
  - **`addFile` polling** — defaults to `wait: true`, polling `vectorStores.files.retrieve` until status is `'completed'` / `'failed'` / `'cancelled'`. Default poll interval `1000ms`, total timeout `120_000ms` (2 min). Both configurable; `wait: false` returns immediately (fire-and-forget). Failed-status responses surface `lastError` without throwing — apps decide whether to retry.
  - **Re-exported from `@rudderjs/ai` main entry** — `VectorStores`, `VectorStore`, plus all the contract types.
  - **17 new tests** in `vector-stores.test.ts` cover provider resolution, create/list/get/delete, addFile (existing fileId path, upload-then-attach path, attribute forwarding, fire-and-forget, polling-until-completed, polling timeout, failed-status surfaced, missing-input error), removeFile, files listing, and store deletion. Hand-rolled fake OpenAI client captures every SDK call for assertion.

  Plan: `docs/plans/2026-05-11-b8-hosted-vector-stores.md` — Phase 1 in flight, Phase 2 (`fileSearch` agent tool + OpenAI native-block emission via `providerHint`) is up next.

### Patch Changes

- Updated dependencies [924b863]
- Updated dependencies [6f63467]
  - @rudderjs/orm@1.9.0

## 1.5.0

### Minor Changes

- 949c5cb: `AWS Bedrock` and `OpenRouter` providers (B4 + B5):

  - **`BedrockProvider`** — new `bedrock` driver. Lazy-loaded `@aws-sdk/client-bedrock-runtime` (added as an optional dep). Region from config; AWS credential chain (env vars / IAM roles / `~/.aws/credentials`) by default, explicit `credentials` accepted for multi-account cases. Streams via `InvokeModelWithResponseStreamCommand`; non-streaming via `InvokeModelCommand`. Prompt-caching markers (`cache_control`) work end-to-end through Bedrock-Anthropic.

    v1 supports **Anthropic Claude models on Bedrock** (`anthropic.*` and the regional cross-region inference profiles `us.anthropic.*` / `eu.anthropic.*` / `apac.anthropic.*`). Other model families on Bedrock (Llama, Nova, Cohere on Bedrock, Mistral on Bedrock, AI21) throw at adapter construction with a clear message — they can be added in follow-up PRs when there's customer demand.

    ```ts
    // config/ai.ts
    bedrock: {
      driver: 'bedrock',
      region: process.env.AWS_REGION ?? 'us-east-1',
    }

    // model strings: bedrock/anthropic.claude-3-5-sonnet-20241022-v2:0
    ```

  - **`OpenRouterProvider`** — new `openrouter` driver. Wraps `OpenAIAdapter` with `https://openrouter.ai/api/v1` as the base URL — installs no extra SDK (reuses `openai`). Optional `siteUrl` / `siteName` config flow through as `HTTP-Referer` / `X-Title` for OpenRouter's per-app analytics.

    Two-slash model strings parse cleanly thanks to `AiRegistry.parseModelString()` already splitting on the first slash — `openrouter/anthropic/claude-3.5-sonnet` → provider `openrouter`, model `anthropic/claude-3.5-sonnet`.

    ```ts
    // config/ai.ts
    openrouter: {
      driver:   'openrouter',
      apiKey:   process.env.OPENROUTER_API_KEY!,
      siteUrl:  process.env.APP_URL,
      siteName: 'My App',
    }

    // model strings: openrouter/anthropic/claude-3.5-sonnet, openrouter/openai/gpt-4o, etc.
    ```

  - Internal: `OpenAIConfig` gains a `defaultHeaders?: Record<string, string>` field (passed through to the OpenAI SDK and the embeddings `fetch` call). OpenRouter is the first consumer; safe to use from any OpenAI-compatible derivative.
  - Internal: `splitSystemMessages` / `toAnthropicMessages` / `toAnthropicTools` / `toAnthropicToolChoice` / `fromAnthropicResponse` are now `export`s from `providers/anthropic.ts` so Bedrock can reuse them. Not re-exported from the package's main entry — internal-only.

- a0cc611: `handoff()` — control transfer between agents (A2):

  `asTool()` lets a parent agent _call_ a subagent and use its result. `handoff()` lets the parent _step out_ — the child agent owns the rest of the conversation.

  ```ts
  import { Agent, handoff } from "@rudderjs/ai";

  class SalesAgent extends Agent {
    instructions() {
      return "You handle pricing and plans.";
    }
  }
  class SupportAgent extends Agent {
    instructions() {
      return "You triage bugs.";
    }
  }

  class TriageAgent extends Agent {
    instructions() {
      return "Greet, then route to the right specialist.";
    }
    tools() {
      return [
        handoff(SalesAgent, { when: "pricing or sales questions" }),
        handoff(SupportAgent, { when: "bug reports or technical issues" }),
      ];
    }
  }

  const r = await new TriageAgent().prompt("What does the Pro plan cost?");
  console.log(r.text); // SalesAgent's reply — TriageAgent's loop ended
  console.log(r.handoffPath); // ['TriageAgent', 'SalesAgent']
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

  |                    | `asTool` (call-and-return) | `handoff` (control transfer) |
  | ------------------ | -------------------------- | ---------------------------- |
  | Parent loop        | continues                  | ends                         |
  | Conversation owner | parent                     | child                        |
  | Final `text`       | parent's                   | last child in chain          |
  | Use case           | "look something up"        | "transfer to specialist"     |

- d8ba117: `Agent.asTool({ suspendable })` — symmetric pause/resume for approval-gated tools inside sub-agents:

  `@rudderjs/ai@1.4.0` shipped suspend/resume for sub-agents that pause on a **client tool** (`finishReason === 'client_tool_calls'`). Approval-gated tools (`needsApproval: true`) inside sub-agents had no equivalent path — when the inner loop paused with `finishReason === 'tool_approval_required'`, no snapshot was persisted, the parent loop saw the inner agent "complete" with empty/partial text, and approve/reject from the UI had nowhere to land. This release makes the approval pause first-class.

  **New control chunk** — `pauseForApproval(toolCall, isClientTool, resumeHandle?)`:

  ```ts
  import { pauseForApproval } from "@rudderjs/ai";
  // inside a server tool's async generator:
  yield pauseForApproval(innerToolCall, isClientTool, subRunId);
  ```

  The parent loop recognizes the chunk via `isPauseForApprovalChunk()`, sets `loopFinishReason = 'tool_approval_required'`, and halts iteration the same way it does for `pauseForClientTools`.

  **Snapshot extension** — `SubAgentRunSnapshot.pauseKind?: 'client_tool' | 'approval'` discriminates the resume contract. Older v1.4 snapshots (no field) default to `'client_tool'`. Approval snapshots also carry `pendingApprovalToolCall: { toolCall, isClientTool }` so renderers can show "approve `delete_user(id=42)`?" without a round-trip.

  **`Agent.asTool({ suspendable })` suspend branch** — when the inner loop ends with `finishReason === 'tool_approval_required'`, the wrapper persists a snapshot with `pauseKind: 'approval'`, yields `subagent_paused_approval` (with `subRunId`, `toolCall`, `isClientTool`), then yields `pauseForApproval(...)` to halt the parent.

  **`Agent.resumeAsTool` accepts approval decisions:**

  ```ts
  const r = await Agent.resumeAsTool(subRunId, [], {
    runStore,
    agent: subAgent,
    approvedToolCallIds: ["inner-call-id"], // or rejectedToolCallIds
  });
  ```

  The function dispatches on `snapshot.pauseKind`: `'client_tool'` keeps the existing tool-result-append path; `'approval'` injects `approvedToolCallIds`/`rejectedToolCallIds` into the inner `agent.prompt()` options. The resume can pause again on either kind — the returned `'paused'` variant now carries `pauseKind` and (for approval) `toolCall` + `isClientTool` so the host can route correctly.

  **Streaming projection** — the default sub-agent projector now translates inner `pending-approval` stream chunks into `agent_pending_approval` updates, so renderers can surface "approval needed" mid-stream (analogous to how `tool-call` chunks become `tool_call` updates). `subagent_paused_approval` fires once at the suspend boundary with the `subRunId` the host needs to drive resume.

  **New `SubAgentUpdate` kinds:**

  ```ts
  | { kind: 'agent_pending_approval';   toolCall: ToolCall; isClientTool: boolean }
  | { kind: 'subagent_paused_approval'; subRunId: string; toolCall: ToolCall; isClientTool: boolean }
  ```

  **Back-compat:** the existing `pauseForClientTools` path is unchanged; new snapshots from that path now carry `pauseKind: 'client_tool'` explicitly. Older snapshots in flight (no `pauseKind` field) resume as client-tool pauses by default. The previous `resumeAsTool` `'paused'` return shape gains optional fields (`pauseKind`, `toolCall`, `isClientTool`) — existing call sites that destructure `pendingToolCallIds` continue to work without changes.

  **New exports:**

  - `pauseForApproval`, `isPauseForApprovalChunk`, `PauseForApprovalChunk` (from `@rudderjs/ai`)
  - `SubAgentPauseKind` (from `@rudderjs/ai`)

  Tests: `astool-approval-suspend.test.ts` and `astool-approval-resume.test.ts` cover the suspend, approve, reject, pause-again, and cross-kind-transition (approval → client-tool) flows.

### Patch Changes

- 644aa5d: Re-export `SubAgentUpdate` from the package entry. The type was defined in 1.4.0 alongside `Agent.asTool`'s streaming branch and is the recommended public discriminator for hosts wrapping streaming sub-agents — but it was never wired into the public types block, so consumers had to mirror the union locally or reach in via a deep `./types.js` path. No runtime change.

## 1.4.0

### Minor Changes

- 8700ed2: `Agent.asTool()` — streaming + sub-agent suspend/resume (A2.5):

  `asTool()` gains two new options that absorb ~700 LOC of bespoke sub-agent plumbing previously maintained downstream:

  - **`streaming: true | (chunk) => SubAgentUpdate | null`** — surfaces inner-agent progress as `tool-update` chunks on the parent stream. The default projection emits `{ kind: 'agent_start' }` once, `{ kind: 'tool_call', tool, args }` per inner tool call, and `{ kind: 'agent_done', steps, tokens }` at the end. Pass a custom projector for different cadence (e.g. surfacing inner `text-delta` previews).
  - **`suspendable: { runStore: SubAgentRunStore }`** — when the inner agent's model emits a _client_ tool call (no `execute` — handled by the browser), the inner loop stops on `client_tool_calls`, the snapshot persists in the run store, the parent loop halts with the inner `pendingClientToolCalls`, and the wrapper yields `pauseForClientTools(pending, subRunId)`. Suspend without streaming throws at builder time.

  ```ts
  import { Agent, CachedSubAgentRunStore } from "@rudderjs/ai";

  const research = new ResearchAgent().asTool({
    name: "research",
    description: "Research with browser-side tools.",
    streaming: true,
    suspendable: { runStore: new CachedSubAgentRunStore() },
  });
  ```

  New static `Agent.resumeAsTool(subRunId, clientToolResults, { runStore, agent })` is the host's continuation entry point — atomically consumes the snapshot, validates incoming tool-result ids against the pending set (forgery guard), appends them to the inner conversation, and re-runs the inner loop in `messages` mode. Returns `{ kind: 'completed', response }` or `{ kind: 'paused', subRunId, pendingToolCallIds }` for multi-pause flows.

  New `SubAgentRunStore` interface and two impls ship in this release:

  - **`InMemorySubAgentRunStore`** — `Map`-backed, single-process; fine for tests and single-worker dev.
  - **`CachedSubAgentRunStore`** — lazy adapter on top of `@rudderjs/cache`. Cross-process / cross-restart when the cache is configured with redis. The cache module is loaded via dynamic `import('@rudderjs/cache')` only when first used, so `@rudderjs/ai`'s static-import surface stays zero-required-peer.

  Hosts may implement their own (Redis directly, Prisma, etc.) by satisfying the interface.

  The 1.2.0 zero-config `asTool({ name, description })` shape is unchanged — these options are purely additive.

- 8a13fe0: Auto-persist conversation behavior (B3):

  `Agent.conversational()` lets a chat-style agent class opt into automatic conversation persistence — `agent.prompt(input)` then auto-loads the user's thread, runs, and auto-saves the new turn without each caller having to call `forUser()` / `continue()`. Inspired by Laravel's `RemembersConversations` trait.

  ```ts
  class ChatAgent extends Agent {
    conversational() {
      return { user: Auth.user()?.id };
    }
  }
  await new ChatAgent().prompt("Hi"); // auto-loads + auto-saves
  await new ChatAgent().prompt("still you?"); // resumes the same thread
  ```

  The hook returns `false | ConversationalSpec | Promise<...>` — async returns are awaited (useful when the user identity comes from an async DI binding). Optional `historyLimit` caps loaded messages for long-running threads. Each `(user, agent class)` pair gets its own thread, so a `ChatAgent` and a `SupportAgent` for the same user don't cross-contaminate; override the segregation key with `agent: 'custom'` if you ever rename the class.

  Per-call escape hatches:

  - `prompt(input, { conversation: false })` — opt out for one call.
  - `prompt(input, { conversation: { user, id?, ... } })` — replace the class declaration for this call.
  - `agent.forUser(id)` / `agent.continue(id)` — explicit form always wins.

  Internals: a new `runWithPersistence` / `runWithPersistenceStreaming` helper at `packages/ai/src/conversation-persistence.ts` is the single load/append code path; the existing `ConversableAgent` (returned by `forUser` / `continue`) now routes through it instead of duplicating logic. `ConversationStoreMeta` gains an optional `agent?: string` for per-class segregation; `MemoryConversationStore.list()` now correctly filters by `userId` and surfaces the `agent` key. Existing custom stores keep working unchanged — they'll just always create new threads (the conservative behavior) until they start surfacing the `agent` field in `list()`.

## 1.3.0

### Minor Changes

- e4964b8: Prompt caching API + Anthropic implementation (A1, sub-PR 1 of 3):

  - **`Agent.cacheable()`** declarative method returns `{ instructions?, tools?, messages? }`. The agent loop resolves it into `CacheableMarkers` on `ProviderRequestOptions.cache` so each provider adapter translates to its native primitive.
  - **Per-call override** via `agent.prompt(input, { cache: false | {...} })`. `false` disables caching; an object replaces the agent default.
  - **Anthropic adapter** translates markers to `cache_control: { type: 'ephemeral' }` on the last content block of each marked region (system, last tool, message at index N-1). String-form system and message content are converted to single text blocks so they can carry the marker.

  OpenAI and Google adapters currently ignore the markers — sub-PR follow-ups will add `prompt_cache_key` (OpenAI) and `cachedContent` resource translation (Google). Adapters without caching support continue to run requests uncached.

- 4dfca63: Prompt caching for Google / Gemini (A1, sub-PR 3 of 3):

  The Google adapter now translates `Agent.cacheable()` markers into Google's stateful `cachedContent` API. Marked regions (system + tools + leading-N messages, scoped by model id) are uploaded once via `caches.create`, then subsequent requests reference the resulting `cachedContents/*` resource and send only the fresh tail — typical input-token savings of 75% for long stable prefixes.

  A new `GoogleCacheRegistry` owns the `hash → resource-name` map, dedups concurrent same-key creates inside a worker, memoizes "below model minimum" failures for 5 minutes (so tight loops don't pound the create endpoint), and recreates transparently on stale-resource 404s. When `@rudderjs/cache` is installed and registered, the registry is auto-wired to the framework cache for cross-process / cross-restart persistence; otherwise it falls back to an in-process `Map` and warns once.

  A new `ttl` field on `CacheableConfig` controls Google's per-resource TTL (default `'1h'`, accepts duration strings like `'30m'`, `'6h'`, `'1d'`). Anthropic and OpenAI ignore the field — their cache layers have no per-call TTL knob.

  The shared cyrb53 hash helper is now exported from `packages/ai/src/util/hash.ts` and consumed by both the OpenAI and Google adapters.

- a49c121: Prompt caching for OpenAI (A1, sub-PR 2 of 3):

  The OpenAI adapter now translates `Agent.cacheable()` markers into a `prompt_cache_key` on each request. OpenAI caches prompts automatically once they exceed 1024 tokens; the key is a routing affinity hint so repeat requests with the same cacheable prefix land on the backend that already has the prefix cached, lifting cache hit rates.

  The key is a stable cyrb53 hash of the marked regions:

  - `instructions: true` → hashes the system message content
  - `tools: true` → hashes the tool definitions
  - `messages: N` → hashes the first N non-system messages

  Regions outside the markers don't affect the key, so changes to later messages (the unstable tail of a conversation) don't fragment cache routing. The hash is pure JS — `@rudderjs/ai`'s main entry stays runtime-agnostic.

  Per-call override via `agent.prompt(input, { cache: false | {...} })` continues to work. Google adapter translation (`cachedContent` resources) is the remaining sub-PR.

## 1.2.0

### Minor Changes

- c7c9b68: Add `Agent.asTool()` for the subagents pattern. Wrap any agent as a tool another agent can call: `new ResearchAgent().asTool({ name: 'research', description: '...' })`. Defaults to `{ prompt: string }` input schema and feeds only `response.text` to the parent model on its next step (the UI still sees the full `AgentResponse`). Pass `inputSchema` + `prompt` for a typed input shape.
- 8f2de48: Two AI ergonomics/correctness fixes:

  - **Provider failover for `Image` / `Audio` / `Transcription`** — `.failover(...models)` on each fluent builder, mirroring the agent loop's `failover()`. Tries the primary first, then each fallback in order; swallows individual errors and surfaces only the last if every candidate fails. Backed by a new shared `tryWithFailover()` helper in `registry.ts`.
  - **`AiFake.preventStrayPrompts()`** — strict-mode toggle that throws on any prompt without a matching `respondWithSequence` entry. Without it, an unscripted prompt silently falls back to the ambient `respondWith` default, which lets tests pass even when they accidentally trigger an extra prompt. Under strict mode, only sequence entries count as valid responses; ambient `respondWith` is ignored.

## 1.1.1

### Patch Changes

- 3ce8b96: Guard JSON.parse on LLM output and filesystem reads

## 1.1.0

### Minor Changes

- 3df432f: Add `AbortSignal` support to `agent.prompt()` / `agent.stream()`. Pass `{ signal }` in `AgentPromptOptions` to cancel an in-flight run from outside:

  ```ts
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 5000);
  const r = await agent("You are helpful").prompt("long task", {
    signal: ac.signal,
  });

  // or just use AbortSignal.timeout
  const r = await agent("...").prompt("go", {
    signal: AbortSignal.timeout(5000),
  });
  ```

  Behavior:

  - Pre-aborted signal → throws immediately, zero provider calls.
  - Abort between iterations → loop stops at the next iteration boundary; `prompt()` rejects with the signal's reason.
  - The signal is forwarded to provider adapters via `ProviderRequestOptions.signal`. Built-in adapters that pass it to the underlying SDK: `openai` (covers itself + azure/deepseek/groq/mistral/ollama/xai via the shared `OpenAIAdapter`), `anthropic`, `google`. Other adapters fall back to the iteration-level cancellation.
  - Streaming variant: the stream throws and the `response` promise rejects with the same reason. Without `signal`, behavior is unchanged.

  Without `signal`, behavior is identical to today.

- 04ee91c: `AiFake`: add `respondWithSequence(steps)` and `failOnStep(stepIndex, error)` for scripting multi-step provider responses in tests. Each entry maps to one provider call (`{ text?, toolCalls?, finishReason? }`), so a tool-call loop can be exercised end-to-end without a real provider. Sequence exhaustion falls back to `respondWith`. `failOnStep` registers an error to throw on the Nth provider call, useful for testing onError middleware and failover paths. Streaming variant honors the same sequence.
- 48f5fbb: Run multiple tool calls within a single agent step concurrently. When the model emits >1 tool call in one step, their `execute()` functions now run in parallel by default; the streamed chunk order is preserved as `tool-call A → updates A → tool-result A → tool-call B → ...` so consumers see deterministic sequences regardless of which tool finishes first. Approval gates, client-tool pauses, and `onBeforeToolCall` middleware decisions still resolve serially in tool-call order _before_ any `execute()` runs, matching the prior single-tool semantics.

  Opt out per call (`prompt('…', { parallelTools: false })`) or per agent (override `parallelTools()` to return `false`) when tools share non-idempotent state — counters, file writes, sequential transactions. Single-tool batches always route through the serial path so live `tool-update` streaming for the one tool is unchanged.

- 636433c: Add `agent.step.completed` observer event. Fires after every iteration of the agent loop with the completed step's data plus running totals (cumulative tokens, cumulative duration). Lets observers report incremental progress in real-time without waiting for the full run to finish — useful for live UIs (typing indicators, per-step token counters), pulse instrumentation, or step-level audit logging.

  The terminal events (`agent.completed`, `agent.failed`) still fire after the loop exits and carry the full `steps` array. Step events are additive — existing subscribers see the new event flow through but can ignore it by checking `event.kind`. Telescope's `AiCollector` already does this so the dashboard's one-entry-per-run model is unchanged.

  Closes Copilot review item 20.

- 4770bcb: Validate tool call arguments against `inputSchema` at runtime. Before this, a misbehaving model returning malformed JSON or wrong types silently passed garbage to the tool's `execute`. The agent loop now runs `safeParse` on every tool call's arguments — on failure it skips `execute` and feeds a structured `{ error: 'invalid_arguments', message, issues }` result back to the model so it can correct itself. Applies to non-streaming `prompt()`, `stream()`, and the approval-resume continuation path.

  Behavior change: `execute` now receives the **parsed** value, so zod transforms and defaults take effect (e.g. `z.number().default(10)` on a missing field is now `10` rather than `undefined`). Tools whose schema is permissive (`z.any()` / `z.unknown()` / no transforms) see no change.

  The new `InvalidToolArgumentsError` type is exported from the package root for middleware authors who want to disambiguate a validation failure from a runtime error.

### Patch Changes

- dc95455: Refactor the agent loop: extract shared helpers (`initializeLoop`, `runIterationPrelude`, `runFailover`, `executeToolPhase`, `emitObserverFailed`, `emitObserverCompleted`, `buildAgentResponse`) so `prompt()` and `stream()` share one orchestration path. The two outer functions are now thin wrappers — `prompt()` is ~70 lines, `stream()` ~160 lines (the rest is streaming-specific chunk processing). Pure refactor: zero behavior change, all 122 tests green, observer event payloads / message ordering / abort semantics / stream chunk sequence preserved byte-for-byte. Internal cleanup only — no public API surface changes.
- eebedee: Fill in the previously-hardcoded `0` for `AiObserverStep.toolCalls[].duration` in agent observer events. The agent loop now wraps each tool's `execute` in a `performance.now()` pair and surfaces the wall-clock duration through `ToolResult.duration` (new, optional field). Telescope/Pulse now show meaningful per-tool latency instead of a flat 0ms.

  Captured for both success and error paths in the streaming and non-streaming loops. Paths where no `execute` ran (unknown tool, rejected, middleware-skipped, validation failure, client-tool placeholder) report `0` since there is nothing to time.

## 1.0.1

### Patch Changes

- 4c8cd07: Fix fictional factory-function references in package READMEs — same drift class PR #233 fixed in `boost/guidelines.md`. Replaces non-existent `pkg(configs.pkg)` factory calls with the actual `*Provider` classes (e.g. `import { CacheProvider } from '@rudderjs/cache'` + `[CacheProvider]`), corrects auth's `authProvider(...)` → `AuthProvider` in setup + prose, fixes core's dynamic-registration example to use the real `CacheProvider` class, and updates ai's setup example to import `AiProvider` from the `/server` subpath. Documentation only; no code changes.
- Updated dependencies [4c8cd07]
  - @rudderjs/core@1.1.2

## 1.0.0

### Major Changes

- cd38418: ## RudderJS 1.0 — wave 1

  Graduate 29 framework packages from `0.x` to `1.0.0`. The first batch of `@rudderjs/*` packages is now public-API stable — breaking changes will require explicit major bumps and migration notes from here on.

  **No code changes** — this is a version-line reset. Existing `0.x` consumers need to update their `@rudderjs/*` ranges from `^0.x.y` to `^1.0.0`. The scaffolder (`create-rudder-app`) is updated to emit `1.x` ranges.

  **Why now.** Under semver caret rules, `^0.X.Y` is exact-minor — every minor bump on a `0.x` peer goes out of range and triggers a cascading major bump on every dependent. Even with the `onlyUpdatePeerDependentsWhenOutOfRange` flag in place, the `0.x` baseline keeps producing spurious cascades. Telescope's v9 is mostly that. Once at `1.0`, `^1.0.0` absorbs all `1.x` minor/patch updates — cascades only fire for actual breaking changes.

  **Cascade noise will drop significantly:**

  - `^1.0.0` absorbs all 1.x minor/patch updates
  - Cascade now only fires for actual breaking changes (real majors)

  **Packages graduating to 1.0.0 in this wave:**

  `@rudderjs/contracts`, `core`, `support`, `log`, `hash`, `crypt`, `context`, `testing`, `middleware`, `cache`, `session`, `broadcast`, `schedule`, `mail`, `notification`, `storage`, `localization`, `pennant`, `socialite`, `queue-bullmq`, `queue-inngest`, `router`, `server-hono`, `view`, `orm`, `orm-prisma`, `passport`, `boost`, `ai`.

  `@rudderjs/ai` was originally on the defer list (recent runtime-agnostic split), but it peer-depends on `@rudderjs/core` — graduating core forces ai to graduate via cascade regardless. Listing it explicitly so the version line is intentional rather than a side-effect.

  **Packages NOT yet graduated (still 0.x), to graduate individually as they stabilize:**

  - _Too new / not yet exercised in the dogfood loop:_ `@rudderjs/concurrency`, `image`, `process`, `http`, `console`
  - _Recent significant changes:_ `@rudderjs/orm-drizzle`, `sync`, `vite`

  These will only patch-bump in this release (cascade via regular `dependencies`, not `peerDependencies`).

  **Already past 1.0 (untouched by this release):** `@rudderjs/auth`, `cli`, `mcp`, `queue`, `horizon`, `pulse`, `sanctum`, `telescope`, `cashier-paddle`. These keep their existing version lines; no reset.

  **Expected cascade:** dependents like `telescope`, `pulse`, `horizon`, `cli`, `auth`, `mcp`, `queue`, `sanctum` will major-bump in this release because their peer/dep ranges shifted from `^0.x` to `^1.0.0`. This is the _last_ spurious cascade — future releases of those packages will patch-bump on in-range peer updates.

### Patch Changes

- Updated dependencies [cd38418]
  - @rudderjs/core@1.0.0

## 0.1.1

### Patch Changes

- 8411cd5: **Renamed `@rudderjs/rudder` → `@rudderjs/console`** to match Laravel's `Illuminate\Console` namespace and remove the "rudder rudder" stutter (the binary is `rudder`, the framework is RudderJS, and the authoring package is now `console` — no more triple-naming collision).

  **Migration for consumers:**

  ```ts
  // before
  import { Rudder, Command } from "@rudderjs/rudder";

  // after
  import { Rudder, Command } from "@rudderjs/console";
  ```

  **No symbol changes** — `Rudder`, `Command`, `CommandRegistry`, `CommandBuilder`, `MakeSpec`, `CancelledError`, `parseSignature`, `commandObservers` all keep their names. Only the import path changes.

  **No CLI changes** — the binary is still `rudder` (`pnpm rudder ...`), and the runner package is still `@rudderjs/cli`. Internal dependency updates only.

  **Naming model after this rename:**

  | Concept                 | Package                 | Surface               |
  | ----------------------- | ----------------------- | --------------------- |
  | Author HTTP routes      | `@rudderjs/router`      | `Route.get(...)`      |
  | Run HTTP routes         | `@rudderjs/server-hono` | (boots HTTP server)   |
  | Author console commands | `@rudderjs/console`     | `Rudder.command(...)` |
  | Run console commands    | `@rudderjs/cli`         | `rudder` binary       |

  The old `@rudderjs/rudder` will be deprecated on npm with a pointer to `@rudderjs/console` after publish.

- Updated dependencies [8411cd5]
  - @rudderjs/core@0.1.4

## 0.1.0

### Minor Changes

- 2caae8c: Make `@rudderjs/ai` runtime-agnostic via subpath exports. The main entry now works
  in any `fetch`-capable JS runtime — Node, browser, Electron (main and renderer),
  React Native — with zero `node:*` static imports (enforced by an isomorphism guard
  test). Node-only filesystem helpers (`documentFromPath`, `imageFromPath`,
  `transcribeFromPath`) move to `@rudderjs/ai/node`. The `AiProvider` `ServiceProvider`
  moves to `@rudderjs/ai/server` and `@rudderjs/core` is now an optional peer — only
  `/server` consumers pull it in.

  `@rudderjs/core` gains a new `rudderjs.providerSubpath` field on the provider
  manifest. When set, `defaultProviders()` imports the provider class from the given
  subpath (`@rudderjs/ai` declares `"./server"`) instead of the package's main entry.
  This is fully auto-discovered — no app changes needed.

  **Breaking changes (uncommon import paths only):**

  - `import { AiProvider } from '@rudderjs/ai'` → `from '@rudderjs/ai/server'` (most apps use `defaultProviders()` which finds it automatically)
  - `Image.fromPath()` / `Document.fromPath()` / `Transcription.fromPath()` removed — use `imageFromPath` / `documentFromPath` / `transcribeFromPath` from `@rudderjs/ai/node`
  - `AI.transcribe(path: string)` is now `AI.transcribe(bytes: Uint8Array)` — load paths via `transcribeFromPath` from `@rudderjs/ai/node`
  - `Transcription.fromBuffer(Buffer)` aliased to `Transcription.fromBytes(Uint8Array)` (Buffer extends Uint8Array, existing Node callers keep working)
  - `SpeechToTextOptions.audio` narrowed from `Buffer | string` to `Uint8Array`

### Patch Changes

- Updated dependencies [2caae8c]
  - @rudderjs/core@0.1.3

## 0.0.7

### Patch Changes

- Updated dependencies [e720923]
  - @rudderjs/core@0.1.1

## 0.0.6

### Patch Changes

- Updated dependencies [ba543c9]
  - @rudderjs/core@0.1.0

## 0.0.5

### Patch Changes

- @rudderjs/core@0.0.12

## 0.0.4

### Patch Changes

- @rudderjs/core@0.0.11

## 0.0.3

### Patch Changes

- @rudderjs/core@0.0.10

## 0.0.2

### Patch Changes

- e1189e9: Rolling patch release covering recent work across the monorepo:

  - **@rudderjs/mcp** — HTTP transport with SSE, OAuth 2.1 resource server (delegated to `@rudderjs/passport`), DI in `handle()`, `mcp:inspector` CLI, output schemas, URI templates, standalone client tools
  - **@rudderjs/passport** — OAuth 2 server with authorization code + PKCE, client credentials, refresh token, and device code grants; `registerPassportRoutes()`; JWT tokens; `HasApiTokens` mixin; smoke test suite
  - **@rudderjs/telescope** — MCP observer entries; Laravel request-detail parity (auth user, headers, session, controller, middleware, view)
  - **@rudderjs/boost** — Replaced ESM-incompatible `require('node:*')` calls in `server.ts`, `docs-index.ts`, `tools/route-list.ts` with top-level imports
  - **create-rudder-app** — MCP and passport options; live config wiring; scaffolder template fixes
  - **All packages** — Drift fixes in typechecks and tests after auth/migrate/view refactors; lint fixes (`oauth2.ts`, `telescope/routes.ts`); removed stale shared `tsBuildInfoFile` from `tsconfig.base.json` so per-package buildinfo no longer clobbers across packages

- Updated dependencies [e1189e9]
  - @rudderjs/core@0.0.9
