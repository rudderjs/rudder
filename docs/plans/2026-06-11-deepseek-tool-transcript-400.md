# DeepSeek / OpenAI-compatible: 400 "tool must follow tool_calls" after a tool applies

**Status:** OPEN 2026-06-11
**Scope:** `@rudderjs/ai` — `packages/ai/src/providers/openai.ts`, `packages/ai/src/tool-execution.ts`, `packages/ai/src/resume-approval.ts`
**Source:** Reproduced from pilotiq-pro playground (interactive agent that applies edits via the client tool `update_form_state`), `@rudderjs/ai@1.11.1`, provider `deepseek` → `OpenAIAdapter` (`baseUrl https://api.deepseek.com/v1`, model `deepseek-chat`)
**Severity:** high — every tool-applying agent breaks on DeepSeek (and likely all OpenAI-compatible providers with strict tool-protocol validation). Anthropic is unaffected.

An agent successfully applies its edits via tool calls, then the **follow-up/wrap-up model call** fails:

```
Error: 400 Messages with role 'tool' must be a response to a preceding message with 'tool_calls'
```

The edits land (tools execute), but the next request to DeepSeek — the one that carries the tool results back so the model can summarise — is rejected. Works fine on Anthropic; fails only on DeepSeek / OpenAI-compatible.

---

## It is NOT DeepSeek's fault — evidence

Tested directly against `https://api.deepseek.com/v1/chat/completions`, model `deepseek-chat`:

| Scenario | Result |
|---|---|
| Well-formed **single** tool-call transcript `[system, user, assistant(tool_calls), tool]` | **HTTP 200** ✅ |
| Well-formed **parallel** tool-calls (two `tool_calls` in one assistant msg, both answered) | **HTTP 200** ✅ |
| assistant `content: null` **and** `content: ""` variants | both **HTTP 200** ✅ |
| **Streaming** tool-call deltas | carry proper `index` (0, 1) + `id` on start-delta, identical to OpenAI ✅ |

So DeepSeek accepts correct tool transcripts and streams tool calls correctly. The 400 therefore means **the `messages` array we send is malformed**: it contains a `role:'tool'` message whose immediately-preceding message is **not** an `assistant` message carrying the matching `tool_calls`.

Why DeepSeek-only: Anthropic encodes tool results as content blocks inside user turns, so there is no "tool role must immediately follow tool_calls" adjacency rule to violate — a loosely-ordered transcript that Anthropic tolerates is rejected by DeepSeek's stricter OpenAI-protocol validation.

---

## Where the malformed ordering is introduced

The serialization is a faithful 1:1 map — `toOpenAIMessages()` at `packages/ai/src/providers/openai.ts:227` maps each `AiMessage` in order (`assistant`+`toolCalls` → `{role:'assistant', tool_calls}`; `tool` → `{role:'tool', tool_call_id}` at :242). It does not reorder or drop. So the bad ordering exists in the **`AiMessage[]` handed to the provider**, i.e. it is produced upstream in the **agent-loop message assembly**, specifically the **client-tool + approval pause/resume path**:

- `packages/ai/src/tool-execution.ts` — for a **client tool** (e.g. `update_form_state`) the loop pushes the call onto `pendingClientToolCalls` and emits a **placeholder** `role:'tool'` message, then pauses for the client to execute.
- `packages/ai/src/resume-approval.ts` — on resume it rebuilds the trailing `tool` messages against the "parent" assistant (walks back over `tool` messages to find the most recent `assistant` with non-empty `toolCalls`).

Hypothesis: across pause → client-exec → resume (possibly combined with `requireApproval(true)`, which stamps the auto-generated write tools), a `tool` message ends up in the final transcript without its parent `assistant`+`tool_calls` adjacent — e.g. the parent assistant message lost its `toolCalls`, an assistant text message landed between the `tool_calls` and the `tool` result, or a placeholder/real tool result pair got split from its parent.

---

## How to confirm exactly (1-line instrumentation)

In `toOpenAIMessages()` (`packages/ai/src/providers/openai.ts:227`), log the structural shape of the array right before mapping:

```ts
// temporary
console.error('[ds-debug]', messages.map((m, i) =>
  `${i}:${m.role}${m.toolCalls?.length ? '(tool_calls)' : ''}${m.toolCallId ? '(tool_result)' : ''}`
).join(' '))
```

Reproduce one tool-applying agent run on DeepSeek; the printed sequence will show the `tool` entry whose predecessor is not `assistant(tool_calls)`. That pinpoints which assembly site (tool-execution placeholder vs. resume-approval rebuild) produced it.

Repro transcript shapes that DeepSeek **accepts** (for the regression test): see the table above — single + parallel, content null + "".

---

## Suggested fix

Two layers; (A) is the robust safety net and should land regardless:

**A. Normalize before the wire call.** In `toOpenAIMessages` (or a shared pre-provider pass), enforce the invariant: every `role:'tool'` message must be immediately preceded by an `assistant` message whose `tool_calls` contains its `toolCallId`. Drop/repair orphans (or hoist the tool result to follow its parent). This protects all OpenAI-compatible providers (OpenAI, DeepSeek, OpenRouter, Azure — all route through `OpenAIAdapter`).

**B. Fix the root assembly.** Ensure the client-tool placeholder result and the resumed real result always stay adjacent to their parent `assistant`+`tool_calls` message through the pause/resume cycle, and that the parent assistant message retains its `toolCalls` in the persisted/continued transcript.

Add a regression test that runs a 2-tool-call agent step (apply two field edits) through the client-tool + approval resume path against the `FakeProvider`/`OpenAIAdapter` and asserts the serialized `messages` satisfy the adjacency invariant.

---

## Rollout note

pilotiq-pro consumes `@rudderjs/ai` from **npm** (not the local clone), so the fix needs a published patch release for the playground to pick it up. Interim, a local `pnpm patch` of `@rudderjs/ai` in pilotiq-pro can carry the normalization (A) so agent testing on DeepSeek can continue before the upstream release.
