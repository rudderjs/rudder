# @rudderjs/ai

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
