# Standalone Client Tools + Unified Field/Resource Agents Plan

Restore field-level AI actions and resource-level agents to the **standalone path** (button → dedicated SSE endpoint → result in field), unblock client-tool round-trips on that path, and unify both surfaces under a single `PanelAgent` primitive so app devs can ship custom actions and tools without forking `@rudderjs/panels`.

**Status:** READY — all decisions and open questions resolved 2026-04-08; Phase 3 (rename) is next as PR #1
**Packages affected:** `@rudderjs/panels` (handlers, agents, schema, frontend chat + field renderers, service providers); `playground` (one reference resource migration)
**Depends on:**
- Nothing — this plan is itself the prerequisite for `ai-loop-parity-plan.md`
**Blocks:** `ai-loop-parity-plan.md` (the parity plan assumes per-field actions are no longer routed through chat)
**Related memory:** `feedback_standalone_field_actions_vs_chat.md`, `feedback_client_tool_for_authoring.md`, `feedback_inline_over_modal.md`, `project_continuation_array_args_bug.md`, `project_ai_system_identity.md`

---

## Goal

After this plan, three things are true:

1. **Per-field AI actions run standalone, not through chat.** Click `✦ Rewrite` on `metaTitle` → request hits a dedicated endpoint → result streams back into the same field via `update_form_state` (or `edit_text` for collab fields) → no chat panel involved. The field's value updates inline. Chat panel goes back to being only for actual conversations.

2. **The standalone path supports client tools.** Both `update_form_state` and `read_form_state` work outside of chat through the same round-trip + continuation protocol that `chatHandler.ts` already implements. This is a refactor that extracts the protocol into a shared helper so chat and standalone share one implementation. This also fixes a latent bug where `agents()` on a Resource silently clobbers unsaved local edits when its target fields are non-collaborative (because today they fall back to the server-side `update_field` tool, which writes directly to the DB and bypasses the live React form state).

3. **Field actions and resource agents are the same primitive.** Both are defined as `PanelAgent` instances (renamed from `ResourceAgent`). Built-in field actions (`rewrite`, `shorten`, `expand`, `fix-grammar`, `translate`, `summarize`, `make-formal`, `simplify`) become real `PanelAgent` instances registered at panels boot. The `.ai([...])` field method accepts both string slugs (sugar for built-ins) and `PanelAgent` instances (custom). App devs can mix and match — and registering a custom agent is the same plug-and-play story as `registerClientTool` / any other RudderJS registry.

---

## Non-Goals

- **Replace the chat dispatcher.** Chat keeps everything it has today: conversation history, persistence, prefix-checked continuation, inline approval cards, mixed-tool turns. The refactor extracts shared helpers; it does not remove or rewrite chat behavior.
- **Change the continuation prefix-check security model.** `continuation.ts` stays the gatekeeper for chat continuations. The standalone continuation endpoint introduces its own (simpler) check; it does not relax chat's check.
- **Build a generic "plugin SDK" for AI actions.** Custom actions are just `PanelAgent` instances registered through the panels service provider, same as resource agents today. No new plugin lifecycle.
- **Rewrite the chat UI's tool-rendering path.** That belongs to `ai-loop-parity-plan.md` Phase 3 (the renderer registry). This plan only restores the per-field standalone path; it doesn't touch how chat renders tool calls.
- **Migrate every existing playground resource.** Only `ArticleResource.ts` gets migrated as the reference example. Other resources continue to work via the existing API surface (which remains backwards-compatible at the call-site level — see D5).
- **Add a "field action history" UI.** Standalone field actions are fire-and-forget. Result lands in the field; if the user doesn't like it, they undo. No persistence, no log per action.
- **Multi-field actions from a field-level click.** A field action is scoped to *one* field — the field it was clicked from. If the user wants "rewrite title and excerpt together," they use a resource-level agent instead.

---

## Background

### What's there today (the two bridges)

There are **two distinct AI surfaces** in panels, both currently routing through chat instead of running standalone.

#### Surface 1: Per-field quick actions — `.ai(['rewrite', 'shorten', ...])`

Defined on the field builder:

```ts
TextField.make('metaTitle')
  .ai(['rewrite', 'shorten'])
```

Stored as `_ai: boolean | string[]` on the field (`packages/panels/src/schema/Field.ts:69, 446`). Serialized into field meta as `meta.ai = this._ai` (line 506-507).

Rendered as a `✦` dropdown next to the field label by `AiQuickActions` in `packages/panels/pages/_components/edit/SchemaRenderer.tsx:64-164`. The "logic" of each action is a hardcoded English string in `QUICK_ACTION_LABELS` at line 36-45:

```ts
rewrite: { label: 'Rewrite', prompt: 'Rewrite the following text while keeping the same meaning' }
```

When clicked (`handleAction`, line 78-101), the component:

1. Calls `aiChat.newConversation()` to start a fresh chat
2. Extracts plain text from the field (special-cased for `richcontent`/`content` via `lexicalRegistry`)
3. Calls `aiChat.setSelection({ field, text })`
4. Calls `aiChat.setOpen(true)` to pop the chat panel
5. Calls `aiChat.sendMessage(`${prompt}:\n"${text}"`)` to inject a synthetic user message

**Problems:**
- Result lands in the chat panel, not in the field — user has to context-switch
- No agent definition exists; no tool selection logic; just a prompt template
- Chat history fills with one-shot "rewrite this" exchanges that aren't real conversations
- App devs can't add custom actions without forking `@rudderjs/panels`
- The prompt is hardcoded English in a React bundle — no localization, no override

#### Surface 2: Resource-level agents — `agents()` in a Resource

Defined as:

```ts
agents() {
  return [
    ResourceAgent.make('seo')
      .label('Improve SEO')
      .icon('Search')
      .instructions('You are an SEO expert...')
      .fields(['metaTitle', 'metaDescription']),
  ]
}
```

`ResourceAgent` lives at `packages/panels/src/agents/ResourceAgent.ts:71-386`. It auto-builds three tools at runtime in `buildTools()` (lines 140-331):

- `update_field` — server tool that writes directly to the DB
- `read_record` — server tool that reads from the DB
- `edit_text` — server tool that mutates the Y.Doc via `@rudderjs/live` (only works on collab fields)

**Critically: zero client tools.** The standalone path (`agentRun.ts`) calls `agentDef.stream(ctx, input)` *without* `toolCallStreamingMode: 'stop-on-client-tool'` (`packages/panels/src/handlers/agentRun.ts:74`), so even if a client tool were attached it would fall back to the placeholder mode and never execute on the browser.

Rendered as the "AI Agents" dropdown in `packages/panels/pages/_components/edit/FormActions.tsx`. When clicked (`handleAgentClick`, lines 26-34), it calls `aiChat?.triggerRun({ agentSlug, agentLabel, resourceSlug, recordId, apiBase })`. That goes to `AiChatContext.triggerRun` (lines 741-754), which opens chat and sends a message with a `forceAgent: agentSlug` hint. The chat handler intercepts the hint at `chatHandler.ts:145-159` and branches to `runForceAgent()` instead of the normal loop, running the agent inside the chat conversation context.

**Problems:**
- Same context pollution as Surface 1 — result lands in chat
- The bridge (`triggerRun`, `forceAgent`, `runForceAgent`) is dead weight once the standalone path supports client tools
- The standalone endpoint *exists* (`POST /{panel}/api/{resource}/:id/_agents/:agentSlug` → `agentRun.ts`), it just isn't used anymore

### The latent bug

The `seo` resource agent in `playground/app/Panels/Admin/resources/ArticleResource.ts:285` operates on `metaTitle` and `metaDescription`. Both are **non-collaborative** plain `TextField` / `TextareaField` (lines 262, 266 — no `.persist(['websocket'])`).

If you triggered this agent via the standalone endpoint today, it would write through `update_field` (server tool), which goes straight to the DB. **Any unsaved edits the user has typed into those fields get clobbered** — the user wouldn't even see the change until the form re-fetches.

Today the bug is hidden because the bridge routes the agent through chat, where the system prompt teaches the model to prefer `update_form_state` (client tool) for non-collab fields. So the chat path "fixes" the bug accidentally. As soon as we restore standalone, the bug surfaces — unless the standalone path also supports client tools.

This is why **the refactor and the restore can't be separated.** They're one cleanup.

### What chat does today that standalone doesn't

`chatHandler.ts` implements the full client-tool round-trip + continuation protocol:

1. Stream the agent loop with `toolCallStreamingMode: 'stop-on-client-tool'` (`chatHandler.ts:185`)
2. When the loop hits a client tool, emit `pending_client_tools` SSE event with the pending calls (`:227`)
3. Browser executes the tool against live state (form values, Lexical editors)
4. Browser POSTs `/chat` again with `messages: [...continuationMessages]` and any `approvedToolCallIds` (`AiChatContext.tsx:525-555`)
5. Server runs `loadContinuation` (`continuation.ts`) which loads the persisted conversation, validates the prefix matches what the browser sent, and resumes the loop with the appended tool result messages
6. Persistence layer writes the resumed messages to the conversation store via `persistContinuation`

The prefix-check in step 5 is **load-bearing for security** — without it a client could rewrite history or forge approvals. This is why we can't just naively reuse it for standalone (which has no persisted conversation to compare against).

For standalone, the simpler invariant is: the continuation request must reference the **same one-shot agent run** as the original (via a short-lived run id), and the messages it submits must be a valid extension of the messages the server emitted during that run. No persistence needed; no prefix check across sessions; just a per-run signed token + an in-memory map of run-id → expected next-state.

---

## Approach Decisions

### D1: Refactor target — extract a shared `agentStream` module

**Decision:** New folder `packages/panels/src/handlers/agentStream/` with two helpers used by both `chatHandler.ts` and `agentRun.ts`:

- `streamAgentWithClientTools(opts)` — runs `agent.stream()` with client-tool stopping, forwards SSE chunks via a `send` callback, returns the full `AgentResponse` and any pending client/approval state.
- `handleAgentContinuation(opts)` — given a continuation body (messages + approval ids), validates it against the expected next-state, resumes the loop, returns the final result.

`chatHandler.ts` becomes "agentStream + conversation management". `agentRun.ts` becomes "agentStream + record context". The chat-specific things (history loading, persistence, prefix-check across sessions) stay in `chatHandler.ts`.

**Why:** Pure shared-helpers refactor is the smallest change that unblocks both standalone surfaces. Anything more aggressive (rewriting chat to be a thin wrapper around a "run" abstraction) would re-litigate decisions from `mixed-tool-continuation-plan.md` and risk breaking the prefix-check security model.

### D2: Continuation security — per-run state stored via `@rudderjs/cache`

**Decision:** Each standalone agent run gets a short-lived `runId` (cryptographically random UUID). The server stores `{ agentSlug, scope, expectedNextMessageHash, userId }` keyed by `panels:agent-run:${runId}` in `@rudderjs/cache` with a 5-minute TTL via the standard `Cache.put` / `Cache.get` / `Cache.forget` facade. The `runId` is included in the initial SSE stream (`event: run_started`); the browser stores it and includes it in any continuation POST. The server validates the request's `runId` against the cache, then consumes (deletes) the entry on successful continuation completion.

**Why:** `@rudderjs/cache` already exists as the framework's ephemeral key-value abstraction (`packages/cache/src/index.ts`) with `MemoryAdapter` and `RedisAdapter` drivers configurable via `config/cache.ts`. App devs pick the driver that fits their deployment — memory for dev/single-process, redis for multi-process/HA — without panels having to know or care. This is the Laravel-style facade pattern the framework is built around. The chat prefix-check stays where it is for chat continuations; standalone uses the simpler cache-backed approach because runs are single-session and short-lived.

**Framework principle invoked (see `feedback_use_framework_packages.md`):** Use first-party RudderJS packages for shared concerns. If a package is missing a feature, improve the package. Don't reinvent ephemeral storage in panels when `@rudderjs/cache` exists.

### D3: Field-level scope enforcement — server-side allowlist per request

**Decision:** When a field action runs from a per-field click on `metaTitle`, the standalone endpoint takes a `field` parameter from the request body. The server builds the agent's tools with an allowlist locked to that one field — `update_form_state`, `read_form_state`, and `edit_text` all reject any operation targeting a field other than `metaTitle`. The agent's `instructions` template can interpolate `{field}` so the prompt knows the scope.

**Why:** Defense-in-depth. A misbehaving or prompt-injected action could otherwise rewrite the entire form. This matches `feedback_validate_agent_inputs.md` ("never trust prompt-only allowlists; enforce in tool dispatcher and surface rejections in result"). The allowlist is enforced in the tool dispatcher inside `update_form_state` / `update_field` / `edit_text`, not just in the prompt.

For resource-level agents, the scope is whatever `.fields([...])` declared on the agent, same as today. Field-level scope just narrows it further.

### D4: `.ai([...])` accepts mixed slugs and `PanelAgent` instances

**Decision:** Update `Field.ai()` signature:

```ts
type AiActionRef = string | PanelAgent
ai(actions?: boolean | AiActionRef[]): this
```

- `.ai(true)` — show the default set (rewrite/shorten/expand/fix-grammar)
- `.ai(['rewrite', 'shorten'])` — built-ins by slug
- `.ai([rewrite, customSeoAgent])` — mixed
- `.ai([customSeoAgent])` — custom only
- `.ai(false)` / no call — disabled

When serializing to field meta, store the resolved set as `Array<{ slug: string, label: string, icon?: string }>` so the frontend doesn't need to look up agents at render time. The actual agent definition stays on the server.

**Why:** Backwards-compat with the existing string-slug API; extensible to custom agents; no extra registration call. App devs add a custom action by passing the instance directly to `.ai([...])`. Built-ins are looked up from the panels-side registry by slug (D6).

### D5: Rename `ResourceAgent` → `PanelAgent`

**Decision:** Rename the class. Update all imports across `@rudderjs/panels` and the playground in the same PR. **No backwards-compat alias** — per `CLAUDE.md` ("avoid backwards-compatibility hacks") and per `feedback_*.md` patterns. Clean rename.

The old name was a slight lie: a `ResourceAgent` didn't *have* to be tied to a Resource — it was tied to a panel. Field-level agents make the lie obvious. New name is accurate.

**Why:** Modest churn (~30 files in the monorepo, mostly imports), but the alternative is naming pain forever. Better to rename now while the API surface is small.

### D6: Built-in actions ship as registered `PanelAgent` instances

**Decision:** New file `packages/panels/src/ai-actions/builtin.ts` defines the 8 built-in actions as `PanelAgent` instances. The panels service provider registers them in a registry at boot — `BuiltInAiActionRegistry`, a normal RudderJS-style registry mirroring the rest of the framework.

```ts
// packages/panels/src/ai-actions/builtin.ts
export const builtInActions: PanelAgent[] = [
  PanelAgent.make('rewrite')
    .label('Rewrite')
    .instructions('Rewrite the value of the {field} field while preserving meaning. Use update_form_state for non-collaborative fields and edit_text for collaborative ones.'),
  PanelAgent.make('shorten')
    .label('Shorten')
    .instructions('Shorten the value of the {field} field while preserving the key points. Same tool selection rules.'),
  // ... 6 more
]
```

When `Field.ai(['rewrite'])` resolves, the field builder looks up `BuiltInAiActionRegistry.get('rewrite')` to get the meta (label, icon) and stores a slug reference in field meta. At runtime (click), the standalone endpoint resolves the slug to the agent and runs it.

**Why:** Built-ins become regular `PanelAgent`s, not hardcoded JSX strings. They're localizable, overridable by app code (an app can register its own action with the same slug to override), and they stop being a special case. The registry pattern matches the ~30 other registries in the monorepo (`CacheRegistry`, `PanelRegistry`, etc.).

### D7: One standalone endpoint, two scopes (resource vs field)

**Decision:** Single endpoint `POST /{panel}/api/{resource}/:id/_agents/:agentSlug` (already exists), with an optional `field` parameter in the request body that narrows scope:

- Resource-level click: `POST .../:id/_agents/seo` with `{ input?: '...' }` — agent runs with its declared `.fields([...])`
- Field-level click: `POST .../:id/_agents/rewrite` with `{ field: 'metaTitle', input?: '...' }` — agent runs with `[field]` as scope, overriding any declared fields
- Continuation: `POST .../:id/_agents/:agentSlug/continue` with `{ runId, token, messages, approvedToolCallIds? }`

**Why:** One endpoint, one auth check, one scope-resolution path. The `field` parameter is the only branch.

### D8: Frontend hook — extend `useAgentRun` (not a new hook)

**Decision:** Extend the existing `useAgentRun` in `AgentOutput.tsx` to support client-tool round-trips. It gains:

- A `field?: string` option that gets passed in the POST body (for field-scoped runs)
- A continuation loop: when SSE sends `pending_client_tools`, execute via the existing `executeClientTool` (`pages/_components/agents/clientTools.ts`), then POST `/continue` with the results, and resume reading the SSE stream
- A `runId` + `token` it captures from the initial `run_started` event and includes in continuation POSTs

**Why:** The hook already exists and already streams SSE; extending it is cheaper than introducing a parallel hook. The chat path's continuation logic in `AiChatContext.tsx:525-555` is the reference implementation — same shape, simpler because no conversation history.

### D9: Built-in action prompts are templates with `{field}` interpolation

**Decision:** Built-in actions can include `{field}` in their `instructions()` string. The standalone handler interpolates this with the actual field name from the request body before running the agent. Custom actions can opt in to the same interpolation.

**Why:** Without interpolation, every built-in would have to say "the field you're operating on" generically, which is fuzzier for the model. With it, the prompt becomes "rewrite the value of the metaTitle field" — concrete, scope-clarifying.

### D10: Field-type allowlist via `PanelAgent.appliesTo()`

**Decision:** `PanelAgent` gains a method `.appliesTo(types: FieldType[])` that declares which field types the agent can run against. The default (no `appliesTo` call) is `['*']` (any). When `Field.ai([slug])` resolves the agent, the field builder validates that the field's type is included in the agent's `appliesTo` set, and throws at boot with a clear message if not.

Built-in text actions all declare `appliesTo: ['text', 'textarea', 'richcontent', 'content']`. **No built-ins ship for non-text types** — the meaning of "rewrite a number" or "summarize a boolean" is either nonsense or so domain-specific that a generic built-in would be misleading. App devs define custom `PanelAgent`s for non-text actions, with their own `appliesTo` declarations.

**Why:** Catches author mistakes loudly at boot instead of silently in production. Documents intent — `appliesTo` is the agent declaring "I know how to handle these field types." Forces app devs to think domain-first for non-text fields, which is the right outcome.

---

## Phase Breakdown

Six phases. Phases 1–2 are pure refactor and add no user-visible behavior. Phases 3–6 build on top.

### Phase 1 — Extract `agentStream` shared helpers (`@rudderjs/panels`)

**Files:**
- `packages/panels/src/handlers/agentStream/index.ts` (new, ~180 LOC)
- `packages/panels/src/handlers/agentStream/runStore.ts` (new, ~30 LOC — thin wrapper over `@rudderjs/cache` facade)
- `packages/panels/src/handlers/chat/chatHandler.ts` (refactor to use the helpers, ~80 LOC delta)
- `packages/panels/src/handlers/chat/types.ts` (move shared types if needed)

**Changes:**

1. **`agentStream/index.ts`** — export two functions:

   ```ts
   export async function streamAgentWithClientTools(opts: {
     agent:    PanelAgent
     input?:   string
     ctx:      PanelAgentContext
     send:     SSESend
     scope?:   { fields: string[] }    // narrowing override (D3)
     history?: AiMessage[]              // chat-only
     messages?: AiMessage[]             // continuation-only
     approvedToolCallIds?: string[]
     rejectedToolCallIds?: string[]
   }): Promise<{ result: AgentResponse; runId?: string; token?: string }>

   export async function handleAgentContinuation(opts: {
     runId: string
     token: string
     body:  ContinuationBody
     send:  SSESend
   }): Promise<{ result: AgentResponse }>
   ```

   Internally `streamAgentWithClientTools`:
   - Calls `agent.stream(ctx, input, { toolCallStreamingMode: 'stop-on-client-tool', history, messages, approvedToolCallIds, rejectedToolCallIds })`
   - Forwards every chunk through `send()` mapped to SSE event names (text, tool_call, tool_result, pending_client_tools, tool_approval_required)
   - On `pending_client_tools` or `pending_approval`, allocates a `runId` + signed `token`, stores `{ agentSlug, scope, lastMessageHash, expiresAt }` in `runStore`, emits `event: run_started` with `{ runId, token }`, and returns
   - Otherwise emits `event: complete` and returns

2. **`runStore.ts`** — thin wrapper over `@rudderjs/cache` (~30 LOC). `storeRun(runId, state)` → `Cache.put('panels:agent-run:' + runId, JSON.stringify(state), 300)`. `loadRun(runId)` → `Cache.get(...)` + parse. `consumeRun(runId)` → `Cache.forget(...)`. Driver (memory/redis/etc.) is determined by `config/cache.ts` — panels has no preference.

3. **Refactor `chatHandler.ts`** — replace the inline streaming/forwarding loop (currently at `chatHandler.ts:201-235`) with a call to `streamAgentWithClientTools`. Conversation persistence and history loading stay where they are. Continuation handling (`continuation.ts`) stays untouched — it's chat-specific and uses the prefix check, not the runStore.

4. **No behavior change for chat.** Existing chat tests pass. Manual smoke test: send a message that triggers a client tool, confirm round-trip still works.

**Done when:**
- `pnpm --filter @rudderjs/panels build` is green
- All existing chat tests pass
- Manual chat smoke test (mixed-tool turn from `mixed-tool-continuation-plan.md`'s test case) still works

**Estimated LOC:** ~320 (180 new + 60 new + 80 refactor delta)

---

### Phase 2 — Upgrade standalone path to support client tools (`@rudderjs/panels`)

**Files:**
- `packages/panels/src/handlers/agentRun.ts` (rewrite to use `streamAgentWithClientTools`)
- `packages/panels/src/handlers/resource/index.ts` (add `/continue` route)
- `packages/panels/src/handlers/agentStream/standaloneContinuation.ts` (new, ~80 LOC)
- `packages/panels/pages/_components/agents/AgentOutput.tsx` (extend `useAgentRun` with continuation loop)
- `packages/panels/pages/_components/agents/clientTools.ts` (already exists, just used here)

**Changes:**

1. **`agentRun.ts`** — replace the current direct `agentDef.stream()` call with `streamAgentWithClientTools`. Pass `toolCallStreamingMode: 'stop-on-client-tool'` implicitly (via the helper). The handler becomes a thin wrapper: auth + record load + scope resolution + delegate.

2. **`/continue` route** — register `POST /{panel}/api/{resource}/:id/_agents/:agentSlug/continue`. Calls `handleAgentContinuation`. Validates the request's `runId` + `token` against `runStore`. If valid, resumes the agent loop with the supplied messages and any approved/rejected tool call ids.

3. **`useAgentRun` extension** — in `AgentOutput.tsx:24-122`:
   - On receiving `event: run_started`, capture `runId` + `token` into local refs
   - On receiving `event: pending_client_tools`, iterate the tool calls, execute each via `executeClientTool`, collect results, then POST `/continue` with `{ runId, token, messages: [assistant{toolCalls}, ...tool results], approvedToolCallIds }`
   - The POST returns its own SSE stream — fold its events into the same `entries` state
   - Repeat until `event: complete` arrives

4. **Tests** — add a smoke test that runs an agent with a client tool through the standalone endpoint. Asserts the round-trip completes and the result lands.

**Done when:**
- Standalone agent run with `update_form_state` tool round-trips successfully via `useAgentRun`
- `seo` resource agent in playground no longer clobbers unsaved edits to `metaTitle` / `metaDescription` (manual smoke)

**Estimated LOC:** ~250

---

### Phase 3 — Rename `ResourceAgent` → `PanelAgent` (`@rudderjs/panels` + playground)

**Files:**
- `packages/panels/src/agents/ResourceAgent.ts` → `packages/panels/src/agents/PanelAgent.ts`
- `packages/panels/src/index.ts` (re-export rename)
- All imports across `@rudderjs/panels` (probably ~15 files)
- All imports across `playground` (~5 files)
- `docs/`, `README.md`, `CLAUDE.md` references

**Changes:**

1. Rename file and class. Update class name, factory method (`PanelAgent.make`), all type imports.
2. Update `Resource.agents()` return type to `PanelAgent[]`.
3. Update `agentRun.ts` and `agentStream/index.ts` types from `ResourceAgent` to `PanelAgent`.
4. Update `runAgentTool.ts` (chat tool) types.
5. Update `AiChatPanel.tsx` / `FormActions.tsx` types via imported `PanelAgentMeta`.
6. Update playground `ArticleResource.ts` import.
7. Search the monorepo for any straggling `ResourceAgent` references.

**No backwards-compat alias** — per D5.

**Done when:**
- `pnpm typecheck` is green across the monorepo
- `grep -r ResourceAgent packages playground docs` returns nothing

**Estimated LOC:** ~80 (mostly mechanical renames)

---

### Phase 4 — Built-in actions as registered `PanelAgent` instances (`@rudderjs/panels`)

**Files:**
- `packages/panels/src/ai-actions/builtin.ts` (new, ~120 LOC)
- `packages/panels/src/ai-actions/registry.ts` (new, ~40 LOC)
- `packages/panels/src/PanelServiceProvider.ts` (register built-ins in `register()`, the sync phase, NOT `boot()`)
- `packages/panels/src/schema/Field.ts` (rework `_ai` storage and serialization)
- `packages/panels/pages/_components/edit/SchemaRenderer.tsx` (drop the `QUICK_ACTION_LABELS` map)

**Changes:**

1. **`registry.ts`** — `BuiltInAiActionRegistry`, a normal RudderJS-style registry. Functions: `register(agent: PanelAgent)`, `get(slug: string)`, `all()`, `meta(slug)` returning `{ slug, label, icon? }`.

2. **`builtin.ts`** — define 8 built-in actions as `PanelAgent` instances. Each one has `.label()`, `.icon()`, `.appliesTo([...])`, and `.instructions()`. All built-ins target the text family. Instructions use `{field}` interpolation per D9. Example:

   ```ts
   PanelAgent.make('rewrite')
     .label(() => getPanelI18n('aiActions.rewrite.label'))  // localized via existing panels i18n
     .icon('Sparkles')
     .appliesTo(['text', 'textarea', 'richcontent', 'content'])
     .instructions('Rewrite the value of the {field} field while preserving meaning. For non-collaborative fields use update_form_state. For collaborative text/rich-content fields use edit_text. Only modify the {field} field; do not touch other fields.')
   ```

   Labels go through `getPanelI18n()` like all other panels strings. Bundled TS defaults live alongside the existing panel i18n keys in `packages/panels/src/i18n/en.ts` (or equivalent); per-locale overrides come from `lang/<locale>/panels.json` via `@rudderjs/localization`. No special-casing — AI action labels are just more i18n keys. Instructions stay as English-only template strings for now (the model is the consumer; translation of model instructions is its own can of worms and out of scope).

   **No built-ins ship for `number`, `boolean`, `date`, `select`, `tags`, `relation`, etc.** App devs define custom `PanelAgent`s for those, with their own `appliesTo` declarations. The plan migrates `playground/ArticleResource.ts` (Phase 5) to demonstrate one custom non-text action as a reference example.

3. **Service provider registration** — in `PanelServiceProvider.register()` (the sync phase, alongside `PanelRegistry.register()` in the `panels()` factory at line 186), iterate `builtInActions` and call `BuiltInAiActionRegistry.register(action)`. **Must be in `register()`, not `boot()`** — field meta serialization can happen before `boot()` runs, so the registry must be populated in the earlier phase. App code can override built-ins by registering its own with the same slug from its own provider's `register()` (app providers run after panels per `bootstrap/providers.ts`); later wins.

4. **`Field._ai` rework** — change from `boolean | string[]` to `boolean | AiActionRef[]` where `AiActionRef = string | PanelAgent`. The `.ai()` setter normalizes any incoming `PanelAgent` to its slug *and* registers it (so per-field custom actions auto-register on first use). Field meta serialization resolves all slugs through the registry to get `{ slug, label, icon }`. Frontend just reads the resolved meta.

5. **Drop `QUICK_ACTION_LABELS` from `SchemaRenderer.tsx`** — the dropdown now reads label/icon from field meta directly. No more hardcoded English in the React bundle.

**Done when:**
- `playground` boots and the `metaTitle` field shows the same `Rewrite` / `Shorten` buttons as before, but now sourced from `BuiltInAiActionRegistry` rather than the hardcoded map
- An app dev can register `PanelAgent.make('translate-arabic')...` and reference it from `.ai(['rewrite', 'translate-arabic'])`

**Estimated LOC:** ~280

---

### Phase 5 — Restore standalone for both surfaces; delete the chat bridges (`@rudderjs/panels`)

**Files:**
- `packages/panels/pages/_components/edit/SchemaRenderer.tsx` (rewrite `AiQuickActions.handleAction`)
- `packages/panels/pages/_components/edit/FormActions.tsx` (rewrite `handleAgentClick`)
- `packages/panels/pages/_components/agents/AiChatContext.tsx` (delete `triggerRun` and related state)
- `packages/panels/src/handlers/chat/chatHandler.ts` (delete `forceAgent` branch lines 145-159)
- `packages/panels/src/handlers/chat/contexts/ResourceChatContext.ts` (delete `forceAgent` extraction lines 108-116, 172)
- `packages/panels/src/handlers/chat/types.ts` (remove `forceAgent` from body schema)
- `packages/panels/src/handlers/chat/runForceAgent.ts` (if it exists as a separate file — delete entirely)

**Changes:**

1. **`AiQuickActions.handleAction`** — replace the `aiChat.newConversation/setSelection/setOpen/sendMessage` chain with a direct `useAgentRun` call:

   ```ts
   const { run } = useAgentRun(apiBase, resourceSlug, onFieldUpdate)
   const handleAction = (slug: string) => run(slug, recordId, undefined, { field: field.name })
   ```

   The `field` option goes into the POST body and triggers D7's field-scoped run. The `onFieldUpdate` callback receives streamed updates and patches the React form value in real time.

2. **`FormActions.handleAgentClick`** — same swap, no `field` option (resource-level scope):

   ```ts
   const handleAgentClick = (agent: PanelAgentMeta) => run(agent.slug, recordId)
   ```

3. **Delete `triggerRun`** from `AiChatContext.tsx`. Search for any other callers (text-selection "Ask AI" still uses `setSelection` but not `triggerRun` — keep `setSelection`).

4. **Delete `forceAgent` branch** from `chatHandler.ts:145-159` and `runForceAgent` if separate. The chat handler reverts to one code path: build context → stream agent → handle continuation. No special "force this agent" mode.

5. **Delete `forceAgent` extraction** from `ResourceChatContext.ts`.

6. **Migrate playground** — `playground/app/Panels/Admin/resources/ArticleResource.ts`:
   - Add a custom `PanelAgent` for SEO optimization scoped to a single field, demonstrating the `.ai([Agent])` overload
   - Keep `agents()` working with the existing `seo` and `editor` agents — they now run via standalone with client tools
   - Manual smoke: click `Rewrite` on `metaTitle`, confirm result lands in field; click `Improve SEO` from form toolbar, confirm both meta fields update without clobbering unsaved local edits

**Done when:**
- Per-field click → result in field, no chat panel opens
- Resource agent click → result in field(s), no chat panel opens
- `grep forceAgent packages playground` returns nothing
- Existing chat conversations still work for actual chat use cases

**Estimated LOC:** ~220 (mostly deletions and small swaps)

---

### Phase 6 — Cleanup, docs, memory updates

**Files:**
- `packages/panels/pages/_components/agents/AgentOutput.tsx` → rename to `useAgentRun.ts`, drop the `AgentOutput` component (lines 124-188)
- `playground/pages/(panels)/_components/agents/AgentSidebar.tsx` → delete (orphaned, never imported)
- `playground/pages/(panels)/_components/agents/AgentOutput.tsx` → will be regenerated by `pnpm rudder vendor:publish --tag=panels-pages --force`
- `CLAUDE.md`, `docs/guide/panels.md`, `packages/panels/README.md`
- `docs/plans/standalone-client-tools-plan.md` (this file — mark DONE with actual LOC)
- Memory updates (see below)
- `docs/contributing/new-package.md` if it references `ResourceAgent`

**Changes:**

1. Update docs to:
   - Reflect the rename (`ResourceAgent` → `PanelAgent`)
   - Document `.ai([Agent | string])` overload with a custom-agent example
   - Document the standalone path as the canonical way field/resource AI runs (chat is for conversation only)
   - Document `BuiltInAiActionRegistry` as an extension point

2. Mark this plan DONE with actual LOC.

3. Memory updates:
   - Update `feedback_standalone_field_actions_vs_chat.md` to mark "restored 2026-04-XX"
   - Update `project_ai_loop_parity.md` to note that this prerequisite is done and `ai-loop-parity-plan.md` is now unblocked
   - Update `reference_docs_plans.md` with the new plan doc

**Done when:** docs reflect the new shape, memory reflects the new state, smoke test from Phase 5 still passes a day later.

**Estimated LOC:** ~80 (mostly markdown)

---

## Total Estimated LOC

~1230 across 6 phases.

| Phase | Description | LOC |
|---|---|---|
| 1 — Extract `agentStream` helpers | refactor chat to use shared helpers | ~290 |
| 2 — Upgrade standalone for client tools | standalone path supports round-trips | ~250 |
| 3 — Rename `ResourceAgent` → `PanelAgent` | mechanical rename | ~80 |
| 4 — Built-in actions as registered Agents | drop hardcoded JSX strings | ~280 |
| 5 — Restore standalone, delete bridges | swap call sites + delete dead code | ~220 |
| 6 — Cleanup, docs, memory | docs + plan close-out | ~80 |

This is a meaningful refactor — well above the 150 LOC threshold for needing a plan doc, crosses two surfaces (chat dispatcher + standalone), and touches load-bearing security code (continuation). Plan doc warranted per `feedback_when_to_write_plan_doc.md`.

---

## Risks and Mitigations

**R1: Phase 1 silently breaks chat continuations.**
The refactor moves the streaming/forwarding loop out of `chatHandler.ts`. If the helper drops or reorders any chunk type, the prefix check in `continuation.ts` will diverge and 400 the next continuation post.
*Mitigation:* Phase 1 is a pure refactor with no behavior change. Run the existing mixed-tool smoke test from `mixed-tool-continuation-plan.md` before merging Phase 1. If anything looks wrong, the helper signature is wrong, not the persistence layer — revert and redo.

**R2: Standalone continuation token gets leaked or replayed.**
The `runId + token` pair authenticates continuation POSTs. If a token leaks (e.g. via logs), an attacker could resume someone else's run.
*Mitigation:* Tokens are short-lived (5-minute TTL), bound to a single `runId`, and consumed once per continuation (each successful continuation rotates the token). The signing key is derived from the panels app key (already used for session signing). Don't log tokens.

**R3: Field-scope allowlist gets bypassed by a creative model.**
A field action scoped to `metaTitle` shouldn't be able to write to `metaDescription`. If the allowlist is enforced only in the prompt, the model could disobey.
*Mitigation:* Per D3, the allowlist is enforced in the tool dispatcher. `update_form_state` / `update_field` / `edit_text` all check the request's `scope.fields` and reject any operation outside it, surfacing a tool-result error the model can recover from. This matches `feedback_validate_agent_inputs.md`. Include a unit test that asserts a scoped agent attempting to write outside its scope gets the operation rejected.

**R4: Phase 3 rename misses a re-export and breaks downstream consumers.**
If a downstream package imports `ResourceAgent` from `@rudderjs/panels`, the rename breaks them.
*Mitigation:* Grep the entire monorepo (`packages/`, `playground/`, `apps/` if any) before merging. If we ship a v0.x bump as part of this rename (which we should), document the break in the changeset. **No backwards-compat alias** per D5.

**R5: Built-in action registration timing.**
If `BuiltInAiActionRegistry` isn't populated by the time `Field.ai(['rewrite'])` resolves, the field meta serialization will fail with "unknown action 'rewrite'".
*Mitigation:* Built-in actions are registered in the panels service provider's `boot()`. Field meta serialization happens during request handling, well after boot. Add a startup assertion that all expected built-ins are registered, so a regression fails loudly at boot time, not in production.

**R6: Custom `PanelAgent` instances passed via `.ai([agent])` don't survive serialization.**
Field meta is serialized and shipped to the browser. A `PanelAgent` instance can't be JSON-serialized. The field builder must extract just the slug + meta and store the agent instance server-side.
*Mitigation:* Per D4, `.ai()` normalizes incoming `PanelAgent` instances to `{ slug, label, icon }` for field meta and registers the agent in a runtime registry keyed by slug. The browser only ever sees the meta. The standalone endpoint resolves the slug back to the agent.

**R7: Two custom actions with the same slug collide.**
If two app providers each register `PanelAgent.make('seo-optimize')`, the second silently overrides the first.
*Mitigation:* `PanelAgent` registration logs a warning when overriding an existing slug. Built-ins never warn (they're meant to be overridable). Custom-vs-custom collisions warn loudly.

**R8: The field being clicked doesn't match what the agent actually edits.**
The user clicks `Rewrite` on `metaTitle`, but the agent's prompt or tool call writes to `metaDescription` because the model misread the scope.
*Mitigation:* Defense-in-depth: D3 (server-side allowlist) blocks the wrong-field write at the tool layer; D9 (`{field}` interpolation in instructions) makes the scope unambiguous in the prompt; the standalone endpoint validates that the request's `field` parameter matches one of the agent's declared fields (or is unrestricted if the agent has none).

**R9: Migration of `ArticleResource.ts` reveals undocumented invariants.**
The reference migration in Phase 5 might surface assumptions about how `ResourceAgent.fields([...])` interacts with field meta.
*Mitigation:* Migrate the playground resource as part of Phase 5, not after. Any divergence between intended behavior and actual behavior gets caught immediately and either fixed or scoped out.

---

## Open Questions for Sign-Off

1. **Q1: Where does the panels service provider live, and is `BuiltInAiActionRegistry` registered there?** — RESOLVED: `packages/panels/src/PanelServiceProvider.ts`. Built-in `PanelAgent` registration goes in **`register()`** (the sync phase, line 49), NOT `boot()`. Reason: `register()` runs before any field meta is built, before any panel mounts; `PanelRegistry.register()` already runs there too (line 186 in the `panels()` factory). Putting it in `boot()` would create an ordering risk where field meta serializes before built-ins exist. App-side overrides can still register in their own provider's `register()` and rely on registration order (panels package boots before app providers per `bootstrap/providers.ts`).

2. **Q2: Storage backend for runStore?** — RESOLVED: **Use `@rudderjs/cache`.** Standard facade (`Cache.put` / `Cache.get` / `Cache.forget`) with 5-minute TTL. App devs configure the cache driver (memory / redis / etc.) in `config/cache.ts` — no panels-side branching, no in-memory map, no custom store. Multi-process safety comes for free when redis driver is configured. See D2 and `feedback_use_framework_packages.md`.

3. **Q3: Field-type filtering for built-in actions?** — RESOLVED: **Yes — `appliesTo: FieldType[]` on `PanelAgent`, validated at boot.**
   - Built-in text actions (all 8) declare `appliesTo: ['text', 'textarea', 'richcontent', 'content']`
   - **Zero built-ins ship for non-text types.** Numbers, booleans, dates, selects, tags, relations — app devs define custom `PanelAgent`s for their domain (the meaning is too domain-specific to ship generic built-ins).
   - `Field.ai([slug])` validates at boot: throws if the resolved agent's `appliesTo` doesn't include the field's type. Error message lists allowed types.
   - Custom agents can declare any `appliesTo` they want — including multi-type or `['*']` (any).
   - Failing at boot (not silently in production) matches `feedback_validate_agent_inputs.md`.

4. **Q4: Localization of built-in action labels?** — RESOLVED: **Yes — use the existing panels localization pattern.** Built-in action labels go through `getPanelI18n()` like every other panels string. Bundled TS defaults in `packages/panels/src/i18n/en.ts` (or wherever the existing keys live) + per-locale JSON overrides via `@rudderjs/localization` (preloaded in `PanelServiceProvider.boot()`'s `preloadPanelTranslations()`). No special-casing for AI actions — they're just more i18n keys. Translation keys: `panels.aiActions.rewrite.label`, `panels.aiActions.shorten.label`, etc. Improvements to localization are tracked separately and out of scope for this plan.

5. **Q5: Drop the `AgentOutput` component and the orphaned `AgentSidebar.tsx`?** — RESOLVED: **Yes — confirmed dead code via grep.**
   - `AgentOutput` component (`packages/panels/pages/_components/agents/AgentOutput.tsx` lines 124-188) — only consumer is `playground/pages/(panels)/_components/agents/AgentSidebar.tsx`, which itself is unreferenced. **Delete the component.**
   - `playground/pages/(panels)/_components/agents/AgentSidebar.tsx` — exports `AgentSidebar`, never imported anywhere. Orphaned cruft. **Delete the entire file.**
   - `useAgentRun` hook (lines 24-122 of the same file) — **KEEP and extend** in Phase 2 for client-tool round-trips. Used by Phase 5 from `SchemaRenderer.tsx` and `FormActions.tsx`.
   - **Rename** `packages/panels/pages/_components/agents/AgentOutput.tsx` → `useAgentRun.ts` after the component is removed. Per `feedback_file_organization.md` (split logic into separate files per concern); the file no longer exports a component, just a hook.
   - All deletions land in Phase 6 (cleanup phase). All remaining `AgentOutput` references in the playground vendored copies will need a `pnpm rudder vendor:publish --tag=panels-pages --force` after Phase 6 to propagate (per `feedback_panels_pages_parallel_copy.md`).

6. **Q6: Default tool kit for `PanelAgent` instances?** — RESOLVED: **Yes — add `update_form_state` + `read_form_state` to the default toolkit built by `PanelAgent.buildTools()`.** Every agent now gets the full toolkit by default: `update_field`, `read_record`, `edit_text` (server tools, existing) + `update_form_state`, `read_form_state` (client tools, new). The tool selection logic stays in the system prompt — model picks `edit_text` for collab fields, `update_form_state` for non-collab. This fixes the latent bug where `seo`-style agents on non-collab fields silently clobber unsaved local edits. Both per-field actions and resource agents benefit. Phase 2 (standalone client-tool round-trips) is the prerequisite — adding these tools is meaningless until the standalone path can actually execute them.

7. **Q7: Phase ordering — Phase 3 (rename) first as PR #1?** — RESOLVED: **Yes.** Six PRs in order: **Phase 3 (rename) → Phase 1 (extract helpers) → Phase 2 (upgrade standalone) → Phase 4 (built-ins as agents) → Phase 5 (restore + delete bridges) → Phase 6 (cleanup)**. Rationale: rename is purely mechanical, gets churn out of the way before any logic-change PR.

---

## Sign-Off Checklist

Before any code is written, confirm:

- [ ] D1–D9 decisions are accepted (or amended)
- [ ] Q1–Q7 open questions have answers
- [ ] Phase order is acceptable (six PRs, in order: Phase 3 → 1 → 2 → 4 → 5 → 6)
- [ ] No additional gaps need folding in
- [ ] Latent bug claim is verified — i.e. you confirm that the `seo` resource agent currently runs through chat (not standalone) and the standalone path is effectively unused for non-collab agents today
