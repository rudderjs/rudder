# Selection-Aware Field Actions Plan

Make the existing per-field `✦ Quick Actions` dropdown selection-aware so that when the user has highlighted text in a field, clicking `✦` runs the chosen action against the **selection** instead of the whole field. Same UI, same standalone path, scope determined by selection state. Preserve the existing chat-bridge intent (`💬` button) as a separate trigger for "discuss this selection in chat."

**Status:** DONE 2026-04-09. Both phases shipped + a load-bearing chat-fix prerequisite. Final shape diverged from the initial draft in two places: (a) the inline `✦` was kept in panels-lexical's `FloatingToolbarPlugin` / `SelectionAiPlugin` (instead of removing it as the plan first proposed), so Lexical fields now have BOTH a field-level `✦` and an inline `✦`, both opening the same `AiDropdown` via two anchor modes (`absolute` / `fixed`); (b) the dropdown gained a free-form textarea that posts to a new `freeform` built-in agent — three input modes in one surface (quick actions, chat-bridge item, textarea), all selection-aware.

| Commit | What |
|---|---|
| `c95216e6` | Chat selection-mode fix (prerequisite) — `ResourceChatContext` selection branch directs the model to `update_form_state` + filters the toolkit, fixing the silent-lie bug on non-collab fields |
| `ff408e2e` | Phase 1 server — standalone endpoint accepts `selection`, shared `buildSelectionInstructions` helper between chat and standalone, `PanelAgent.buildTools()` selection-mode toolkit filter, latent fieldScope-on-continuation bug fixed as a side-effect |
| `20875b93` | Phase 2 frontend — shared `AiDropdown` component, `readFieldSelection` helper, `Field.ai()` extended to accept object form, slimmed `AiQuickActions`, removed `useNativeSelectionAi` (no inline buttons on plain non-collab inputs) |

Three deferred follow-ups (none blocking):
- **i18n** — hardcoded English in `AiDropdown` (`"Selection: "`, `"Tell AI what to do…"`, `"💬 Discuss in chat"`) and the `freeform` built-in's label. Wire through `@rudderjs/localization` per `feedback_panels_localization.md`
- **Selection-only Lexical formatting actions** (`make-bold`, `italicize`, `wrap-link`, `convert-to-heading`) — never built. The textarea may already cover this intent ("make this bold" via natural language) so verify need before building
- **Multi-pause continuation inheritance** — fixed in Phase 1 as a beneficial side-effect; recorded in `feedback_mixed_tool_continuation_validation.md` as the third variation of that bug

| Phase | Description | LOC est |
|---|---|---|
| 1 | Server: standalone endpoint accepts `selection`, shared selection-instructions helper | ~110 |
| 2 | Frontend: `AiQuickActions` becomes selection-aware; selection-only built-in actions; preserve `💬` chat-bridge trigger | ~150 |

**Total est:** ~260 LOC across 2 PRs.
**Packages affected:** `@rudderjs/panels` (handlers, agents, frontend dropdown, fields), `@rudderjs/panels-lexical` (no behavior change — unchanged callback signature flows the new selection data through).
**Depends on:** `standalone-client-tools-plan.md` (DONE), chat selection-mode fix (DONE).
**Blocks:** nothing currently scheduled.
**Related memory:** `feedback_chat_selection_mode_prompt.md`, `feedback_standalone_field_actions_vs_chat.md`, `feedback_inline_over_modal.md`, `feedback_client_tool_for_authoring.md`, `feedback_update_field_headless_only.md`, `reference_panels_ai_surfaces.md`.

---

## Goal

After this plan, four things are true:

1. **Two triggers, two purposes, shared action source.** The field-level `✦ Quick Actions` dropdown (bottom-left of each field) stays exactly as it is today — whole-field actions only, no selection-awareness. A second `✦` trigger lives in the **floating selection toolbar** (the existing one in `FloatingToolbarPlugin` for Lexical and `useNativeSelectionAi` for plain inputs) and opens its own dropdown anchored next to itself, containing **selection-scoped actions**. Both dropdowns pull from the same `BuiltInAiActionRegistry` source — the action list logic is shared via a small hook, only the trigger and anchor differ. No scope-switching ambiguity inside any single dropdown: each has one purpose.

2. **The standalone endpoint accepts `selection` in its body**, mirroring the chat endpoint's contract. The `PanelAgentContext.selection` field propagates through to the agent. The system-prompt selection block — currently inlined in `ResourceChatContext.buildSystemPrompt()` — is factored into a shared helper so chat and standalone paths use one source of truth and can't drift again. (This is the structural "factor a helper" item the chat-fix memory recommends.)

3. **Selection edits use `update_form_state` with `search`-string ops, not offsets.** The chat fix proved this works for `replace`, `delete`, `format_text`, `set_link`, `unset_link`, `set_paragraph_type`. No new tools, no new ops, no offset tracking, no Lexical `replace_selection` op.

4. **The existing chat-bridge intent is preserved.** The `💬` button (or its equivalent — see Phase 2 for placement) sits next to `✦` in the floating selection toolbar. Clicking `💬` opens the chat panel with the selection as context, exactly as today. Two distinct triggers, two distinct intents:
   - `✦` = "do this to the selection now" → quick-actions dropdown → standalone agent run → result lands in field
   - `💬` = "let's discuss this selection" → chat panel with selection chip → conversational, multi-turn

---

## Non-Goals

- **A separate floating popover anchored to the selection.** Considered and rejected: the existing `✦` dropdown is a known UI affordance, and adding a second floating surface for one mental concept ("AI on this field") doubles the UX surface for marginal ergonomic gain. If real users complain about mouse travel, revisit in a v2.
- **Moving the `✦` button next to the selection when one is active.** The button stays at its current anchor (bottom-left of the field). Panel fields are short enough that the travel cost is small. Revisit only if it becomes a friction point in real use.
- **Caret-coordinate measurement.** The original popover plan needed this for plain-input anchoring. The dropdown is anchored to the field, so we don't need it.
- **Any new client tools.** No `read_selection`, no `replace_selection`. The `update_form_state` schema already covers every selection edit via `search` strings.
- **Persisting selection-action history.** Same fire-and-forget model as today's per-field quick actions. The field's value updates; if the user doesn't like it they undo.
- **Selection editing on multiple non-contiguous ranges.** One contiguous selection, one action.
- **Block-level selection (richcontent).** "Selection" means *text* selection. A user clicking inside a builder block without selecting text gets no special treatment.
- **Resource-level "AI Agents" dropdown changes.** That surface (`FormActions`) already runs standalone for the whole record; out of scope.
- **Migrating any playground resource.** No reference resource changes required — the dropdown adapts based on UI state, no schema changes needed on the user side.

---

## Background

### What works today (post chat-fix)

The chat path is the existence proof for the entire selection-edit pipeline:

- **Frontend (`AiChatContext.tsx`):** clicking `✦` in the selection toolbar (`FloatingToolbarPlugin` for Lexical, `useNativeSelectionAi` for plain) calls `aiChat.setSelection({field, text})` and opens the chat panel. The selection rides in the request body to `/{panel}/api/_chat`.
- **Server (`ResourceChatContext.ts`):** `body.selection` is parsed at line 109, threaded into the system prompt's selection block (lines 171-189 post-fix), and the agent is told to use `update_form_state` with `search: "<selected text>"`. The toolkit is filtered to `read_form_state` + `update_form_state` only in selection mode (lines 118-129) so the model can't escalate to `delete_record` / `edit_text` / `run_agent`.
- **Selection ops:** the `update_form_state` schema's `replace`, `delete`, `format_text`, `set_link`, `unset_link`, `set_paragraph_type` ops all take `search` strings, which is exactly what a selection IS.

This works for plain text, plain textarea, collaborative text, and Lexical rich-content, on any field type — verified end-to-end with the `metaDescription` "delete VPN" trace.

### What doesn't exist yet

The **standalone path** doesn't know about selection at all. `useAgentRun` POSTs to `/{panel}/api/{resource}/:id/_agents/:slug` and `handleAgentRun` builds a `PanelAgentContext` with no `selection` field. So the existing per-field quick actions (`✦ Rewrite` from Phase 5 of standalone-client-tools) always run against the whole field, regardless of whether the user has text highlighted.

That's the gap this plan fills: teach the standalone path the same selection trick chat now does, then expose it through the existing `AiQuickActions` dropdown by reading the user's selection at dropdown-open time.

### Why this shape (one dropdown, not two surfaces)

Same set of *verbs* (rewrite, format, translate), different *object* (whole field vs highlighted span). At a mental-model level, the user is still saying "do an AI thing to this field." The dropdown adapts to scope, the trigger doesn't move. One UI affordance to learn, one mental model.

The conversational intent ("let's discuss this paragraph") is genuinely different — it deserves its own trigger (`💬`) and routes to chat. That distinction is preserved.

---

## Architecture

### Server side

A new `body.selection: { field, text }` schema field on the standalone endpoint (mirror of chat). When present:

- Plumbed into `PanelAgentContext.selection`
- The agent's instructions get the same selection block chat now uses, via a **shared helper**:

```ts
// packages/panels/src/handlers/chat/selectionInstructions.ts (new file)
export function buildSelectionInstructions(selection: { field: string; text: string }): string {
  return [
    `## ACTIVE SELECTION — "${selection.field}" field`,
    'The user selected this text:',
    '"""',
    selection.text,
    '"""',
    '',
    'INSTRUCTIONS:',
    '1. You MUST call `update_form_state`...',
    // ...same body as today's selection branch in ResourceChatContext
  ].join('\n')
}
```

`ResourceChatContext.buildSystemPrompt()` calls this helper for its selection branch (refactor — no behavior change). `PanelAgent.resolveInstructions()` also calls this helper when `context.selection` is set, appending it to the agent's `instructions`. One source of truth, no drift risk.

The helper lives in `handlers/chat/` rather than `agents/` because chat is the historical home of selection mode and the helper is a chat concept being shared *into* the agent layer, not a primitive originating from agents. (Open to bikeshedding the location if it feels wrong during implementation.)

### Toolkit filter on standalone

The standalone path's toolkit comes from `PanelAgent.buildTools()`. When `context.selection` is set, filter the same way `ResourceChatContext` now does: `read_form_state` + `update_form_state` only. Hide `update_field`, `read_record`, `edit_text`. This is the same defense-in-depth structural fix we applied to chat — even if a custom `PanelAgent` adds destructive tools, selection mode strips them.

This filtering happens in `PanelAgent.buildTools()` based on `context.selection != null`. App devs writing custom `PanelAgent`s with extra tools get the same protection automatically.

### Frontend side

Two trigger surfaces, one shared action-list hook, two thin presentational dropdowns.

#### Shared logic: `useFieldQuickActions(fieldName, mode)`

A new hook at `pages/_components/agents/useFieldQuickActions.ts`. Returns:

```ts
{
  actions: QuickAction[]   // filtered + scoped action list
  run: (slug, opts?) => void
  isRunning: boolean
  entries: ProgressEntry[] // for AiActionProgress
  status: RunStatus
  reset: () => void
}
```

The hook reads from `BuiltInAiActionRegistry`, filters by `appliesTo` (matching the field's type) and by `mode` (`'field'` for whole-field actions, `'selection'` for selection-scoped actions). It owns its own `useAgentRun` instance internally so each consumer gets independent run state.

This is the single source of truth for what actions exist in either mode and how they execute. Both triggers below call this hook with the same field name but different `mode`.

#### Trigger 1: field-level `✦ Quick Actions` (unchanged from today)

The existing `AiQuickActions` component in `pages/_components/edit/SchemaRenderer.tsx` stays as-is structurally — same anchor (bottom-left of the field), same dropdown UI. Internally it's refactored to call `useFieldQuickActions(fieldName, 'field')` instead of building its action list inline. Pure refactor, no behavior change for the user. Only purpose: whole-field actions.

#### Trigger 2: floating selection toolbar `✦` (new behavior)

The `✦` button currently sitting in `FloatingToolbarPlugin` (Lexical, alongside bold/italic/link) and `useNativeSelectionAi` (plain inputs, anchored next to the cursor/selection) **changes its behavior**. Today it calls `onAskAi(text)` which routes to chat. After this plan it opens a small dropdown anchored to itself — let's call it `SelectionActionsMenu` — that calls `useFieldQuickActions(fieldName, 'selection')`.

Position stays exactly as today:
- **Lexical:** the button stays inline with the formatting toolbar (next to bold/italic/link), and the dropdown opens just below the toolbar
- **Plain text/textarea:** the button stays anchored next to the cursor / selection rect, and the dropdown opens just below the button

Selection capture happens at click time, BEFORE the editor blurs:
- **Plain inputs:** `useNativeSelectionAi` already captures `text` from `selectionStart`/`selectionEnd` on click — this stays
- **Lexical:** the existing `selectedTextRef.current` in `FloatingToolbarPlugin` already captures the text from `$getSelection().getTextContent()` on `updateToolbar()` — this stays

The captured text is passed into `SelectionActionsMenu` as a prop. The dropdown shows:
- A small quoted preview header (truncated to ~40 chars, full text in title attribute)
- The selection-scoped action list from `useFieldQuickActions`
- An inline `<AiActionProgress>` while running, auto-dismisses on success

When an action is clicked, `useFieldQuickActions.run(slug)` fires. The hook internally calls `useAgentRun.run(slug, recordId, input, { field: fieldName, selection: { field: fieldName, text: capturedText } })`. The `selection` payload rides to the standalone endpoint; Phase 1 takes care of the rest server-side.

#### Trigger 3 (preserved): floating `💬` chat-bridge button

A new `💬` button sits next to the floating `✦` in both `FloatingToolbarPlugin` and `useNativeSelectionAi`. It does exactly what the floating `✦` does today: calls `aiChat.setSelection({field, text}) + setOpen(true)`. Completely unchanged from current code, just moved from `✦` to `💬` semantically.

Visibility: gated on chat being available in the panel. Use the same condition the existing `useAiChatSafe()` already uses — if no chat context, hide the `💬` button. The `✦` button does NOT have this gate (it routes to standalone, always available).

```
floating toolbar layout (Lexical):
[B] [I] [U] [S] | [<>] [🔗] | [✦] [💬]
                              |    |
                              |    └── (gated on chat) opens chat with selection as context
                              |
                              └── opens SelectionActionsMenu (selection-scoped quick actions)

floating button layout (plain input/textarea):
[✦] [💬]    ← anchored next to selection/cursor
```

#### Selection capture is once-at-open

The selection text is captured at the moment the user clicks `✦` and passed into `SelectionActionsMenu` as an immutable prop. Subsequent selection changes (e.g. clicking the dropdown causes the editor to blur and `SELECTION_CHANGE` fires) don't matter — the dropdown owns its captured string and doesn't re-read the editor. The action runs against that string via `update_form_state` `search`.

#### Why no popover (recap, with the corrected interpretation)

- Two triggers exist already (field-level `✦`, floating `✦`) — we're not adding a third surface
- The action list is shared via the hook, so "same dropdown actions" is true at the source level even though there are two thin presentational shells
- The floating `✦` keeps its current position next to the selection (zero mouse travel — answers your "anchor near the cursor" requirement)
- The field-level `✦` stays out of the selection-mode logic entirely — no scope-switching ambiguity
- No DOM coupling between plugins (the floating button doesn't need to find or click the field-level dropdown)
- No Lexical `replace_selection` op needed — `update_form_state` + `search` handles everything
- No new client tools, no `selectionStore`, no caret-coordinate measurement

### Built-in actions registry

`BuiltInAiActionRegistry` already exists (Phase 4 of standalone-client-tools). Today its entries have `appliesTo: string[]` keyed by field type. Two extensions:

1. **New entries for selection-only actions** (`make-bold`, `italicize`, `wrap-link`, `convert-heading`) with `appliesTo: ['richcontent']` — Lexical-only.

2. **Existing entries get an optional `selectionMode` flag** (or, simpler, the dropdown just decides at render time which slugs to show in selection mode). The cleanest approach is probably: keep the existing entries unchanged; the dropdown maintains a small allowlist of slugs that "work in selection mode" and shows them with selection-scoped labels.

The runtime behavior is identical either way — the agent sees the same selection block in its instructions, picks the right `update_form_state` op based on the action's natural-language description.

---

## Phases

### Phase 1 — Server: standalone selection support + shared helper (~110 LOC)

**Steps:**

1. **Extract `buildSelectionInstructions(selection)` helper** at `packages/panels/src/handlers/chat/selectionInstructions.ts`. Body is the current selection block from `ResourceChatContext.buildSystemPrompt()` lines 171-189 (post chat-fix), parameterized on `selection.field` and `selection.text`.

2. **Refactor `ResourceChatContext.buildSystemPrompt()`** to call the helper. Pure refactor, no behavior change. Verify by re-running the chat-fix manual test (`select VPN, ask delete`) — tool call should still be `update_form_state`, same field updates.

3. **Add `selection?: { field, text }`** to the standalone request body schema in `packages/panels/src/handlers/agentRun.ts` (initial POST + continuation POST). Round-trip storage: `runStore` already keeps per-run state; add `selection` to that state so continuations see the same selection.

4. **Add `PanelAgentContext.selection?: { field, text }`** in `packages/panels/src/agents/PanelAgent.ts`. Pass through from `handleAgentRun` / `handleAgentRunContinuation`.

5. **`PanelAgent.resolveInstructions()`** appends `buildSelectionInstructions(context.selection)` when set, after the existing tool-selection preamble.

6. **`PanelAgent.buildTools()`** filters when `context.selection` is set: return only `update_form_state` + `read_form_state` from the default toolkit. App-dev custom tools added via `Field.ai([Agent])` are also filtered out — selection mode is one-shot scoped editing, not custom tool execution. (If this turns out to be too aggressive in practice, revisit — but the chat-fix experience strongly suggests "fewer tools, less escalation" is the right default.)

7. **Manual verification:** curl the standalone endpoint with a `selection` body, confirm the SSE stream shows `update_form_state` (not `update_field` / `edit_text`) and the field updates in the playground UI.

**Touches:**
- `packages/panels/src/handlers/chat/selectionInstructions.ts` (new)
- `packages/panels/src/handlers/chat/contexts/ResourceChatContext.ts` (refactor to use helper)
- `packages/panels/src/handlers/agentRun.ts` (body schema + plumbing)
- `packages/panels/src/handlers/agentStream/runStore.ts` (state)
- `packages/panels/src/agents/PanelAgent.ts` (`PanelAgentContext.selection`, `resolveInstructions`, `buildTools` filter)

### Phase 2 — Frontend: shared hook + `SelectionActionsMenu` + floating `💬` button (~150 LOC)

**Steps:**

1. **Extract `useFieldQuickActions(fieldName, mode)` hook** at `packages/panels/pages/_components/agents/useFieldQuickActions.ts`. Reads `BuiltInAiActionRegistry`, filters by field type's `appliesTo` and by `mode` (`'field'` | `'selection'`), owns its own `useAgentRun` instance, returns `{ actions, run, isRunning, entries, status, reset }`. The `run` function accepts an optional `selection` arg that gets forwarded into `useAgentRun.run`'s opts.

2. **`useAgentRun` opts schema gains `selection`.** `useAgentRun.run(slug, recordId, input, opts)` already accepts `{ field?: string }` in opts. Add `selection?: { field, text }`. Forward into the standalone request body. Phase 1 picks it up server-side.

3. **Refactor `AiQuickActions` (in `SchemaRenderer.tsx`) to use the hook with `mode: 'field'`.** Pure refactor — same anchor, same UI, same behavior. Just delegates the action-list logic to the hook. No scope-switching, no selection-awareness inside this component. Verify by re-running today's per-field action flow on any field.

4. **Add new `SelectionActionsMenu` component** at `pages/_components/agents/SelectionActionsMenu.tsx`. Props: `{ fieldName, capturedText, anchorEl, onClose }`. Calls `useFieldQuickActions(fieldName, 'selection')`. Renders:
   - A small popover positioned just below `anchorEl` (use `@floating-ui/dom`'s `computePosition` — same library `FloatingToolbarPlugin` already uses)
   - Header with quoted preview of `capturedText` (truncated to ~40 chars, full text in `title`)
   - Action list — each action is a button that calls `run(slug, { selection: { field: fieldName, text: capturedText } })`
   - While running: replace body with `<AiActionProgress entries={entries} status={status} onDismiss={onClose} />` (the existing inline progress UI from `standalone-client-tools-plan` Phase 5)
   - Auto-close on success after 600ms (matches existing `AiQuickActions` behavior)
   - Close on outside click and Escape

5. **Wire `SelectionActionsMenu` into `FloatingToolbarPlugin`** (Lexical, `packages/panels-lexical/src/lexical/FloatingToolbarPlugin.tsx`). The existing `✦` button in the toolbar already captures `selectedTextRef.current` on `updateToolbar()`. Change `handleAskAi` from "call `onAskAi(text)`" to "open `SelectionActionsMenu` anchored to the `✦` button, with `capturedText = selectedTextRef.current` and `fieldName` passed in via a new prop on `FloatingToolbarPlugin`." The `onAskAi` callback prop becomes `onAskChat` (or similar — see step 7) so the `💬` button can still use it.

6. **Wire `SelectionActionsMenu` into `useNativeSelectionAi`** (plain inputs, `packages/panels/pages/_hooks/useNativeSelectionAi.tsx`). Same shape: the existing `✦` button captures `selectedTextRef.current`; clicking it opens the menu anchored next to the button. The hook's signature already takes `onAskAi` — split into `onSelectionAction` (opens menu) and `onAskChat` (routes to chat).

7. **Add `💬` chat-bridge button next to `✦`** in both `FloatingToolbarPlugin` and `useNativeSelectionAi`. Visibility gated on `useAiChatSafe()` returning a non-null context (matches today's gate). Click handler calls the existing `aiChat.setSelection({field, text}) + setOpen(true)` flow. Pure preservation of today's behavior, just moved from `✦` to `💬`.

8. **Selection-only built-in actions registered.** Add new `BuiltInAiActionRegistry` entries (in `packages/panels/src/ai-actions/builtin.ts`):
   - `make-bold`, `italicize`, `underline-text`, `strikethrough` — `appliesTo: ['richcontent']`, instruction text tells the agent to call `update_form_state` `format_text` op
   - `wrap-link` — `appliesTo: ['richcontent']`, calls `set_link`
   - `convert-to-heading` — `appliesTo: ['richcontent']`, calls `set_paragraph_type`
   - These appear ONLY in `mode: 'selection'` (registry entries get an optional `mode?: 'field' | 'selection' | 'both'` discriminator; field-mode actions default to `both`, selection-only actions set `'selection'`)

9. **Manual verification:**
   - **Plain non-collab:** select text in `metaDescription`, the floating `✦` appears next to selection. Click it → small dropdown opens next to the button with selection actions. Click `Delete` → text deleted in the live form. Select text again, click `💬` → chat opens with selection chip (today's behavior).
   - **Collab text:** same flow on `title` → works.
   - **Lexical richcontent:** select text in `body`, formatting toolbar appears with `[B][I][U][S]|[<>][🔗]|[✦][💬]`. Click `✦` → dropdown opens below toolbar with selection actions including `Make bold`, `Wrap in link`, etc. Click `Make bold` → selection becomes bold in the live editor.

**Skipped (deferred):**
- **i18n entries** for new labels (`Selection: <text>`, `Make bold`, etc.). Hardcoded English for v1; add translation entries in a follow-up. Tracked as a TODO at the top of `SelectionActionsMenu.tsx` and in the relevant `BuiltInAiActionRegistry` entries.

**Touches:**
- `packages/panels/pages/_components/agents/useFieldQuickActions.ts` (new)
- `packages/panels/pages/_components/agents/SelectionActionsMenu.tsx` (new)
- `packages/panels/pages/_components/agents/useAgentRun.ts` (opts schema)
- `packages/panels/pages/_components/edit/SchemaRenderer.tsx` (`AiQuickActions` refactored to use hook)
- `packages/panels/src/ai-actions/builtin.ts` (new selection-only entries)
- `packages/panels/src/ai-actions/registry.ts` (optional `mode` discriminator on entries)
- `packages/panels-lexical/src/lexical/FloatingToolbarPlugin.tsx` (split `onAskAi`, render selection menu, add `💬` button)
- `packages/panels/pages/_hooks/useNativeSelectionAi.tsx` (split callbacks, render selection menu, add `💬` button)
- `packages/panels/pages/_components/fields/{TextInput,TextareaInput,RichContentInput}.tsx` (pass `fieldName` to the floating-button surfaces; wire the new callback shape)

---

## Decisions made (no remaining open questions)

All five questions from the initial draft are decided:

1. **Formatting actions are Lexical-only.** Plain `<input>` / `<textarea>` get the text-only selection actions (`Rewrite`, `Shorten`, `Expand`, `Fix grammar`, `Translate`, `Make formal`, `Simplify`, `Summarize`, `Delete`). Lexical richcontent fields get those PLUS `Make bold`, `Italicize`, `Underline`, `Strikethrough`, `Wrap in link`, `Convert to heading`. The dropdown's action list is filtered by the field type's `appliesTo` automatically — no per-field special-casing.

2. **No DOM coupling between plugins.** The floating `✦` button anchors its OWN dropdown next to itself (Lexical: below the formatting toolbar; plain: next to the cursor). It does NOT programmatically open the field-level `AiQuickActions` dropdown. Each trigger has its own anchor. Shared logic lives in the `useFieldQuickActions` hook, not in coupled DOM/event-bus glue.

3. **`💬` button is gated on chat availability.** Visibility check uses the same `useAiChatSafe()` non-null condition the existing `aiChat.setSelection` path already uses. The `✦` button has no such gate — it routes to standalone, which is always available.

4. **i18n is deferred.** Hardcoded English labels for v1. New labels (action names, "Selection:" header prefix) are tracked as TODOs at the top of `SelectionActionsMenu.tsx` and in the new `BuiltInAiActionRegistry` entries. Follow-up plan: add `@rudderjs/localization` entries per `feedback_panels_localization.md`.

5. **Selection captured once at dropdown open.** The captured text is passed into `SelectionActionsMenu` as an immutable prop. Subsequent selection changes (e.g. dropdown click blurs the editor and `SELECTION_CHANGE` fires) are ignored. The action runs against the captured string via `update_form_state` `search`, not against any live DOM state. This matches how every other dropdown in the world works and avoids jarring re-renders mid-interaction.

---

## Risks

- **Lexical selection collapse on dropdown click.** When the user clicks `✦` to open the dropdown, the editor blurs and Lexical's `SELECTION_CHANGE` fires with a collapsed selection. Mitigation: the existing `FloatingToolbarPlugin` already solves this for its formatting buttons via `selectedTextRef` (captured during `updateToolbar()` before any click). The selection menu reuses the same captured ref — no new mechanism needed.

- **Selection-mode toolkit filter is too aggressive for custom agents.** App devs who add custom tools to a `PanelAgent` via `Field.ai([Agent])` will see those tools stripped in selection mode. This is intentional (defense in depth from the chat-fix experience) but may surprise someone. Mitigation: document it in the panels README; consider an opt-in escape hatch (`PanelAgent.allowToolsInSelection: string[]`) only if a real use case appears.

- **The "search-string" approach fails when the selection appears multiple times in the field.** If the user selects the second occurrence of "VPN" in a 500-word article, `update_form_state.delete` with `search: "VPN"` will delete the FIRST occurrence. Mitigation: the `buildSelectionInstructions` helper should tell the agent "if the selected text is not unique within the field, expand the search string with surrounding context until it is." This is the kind of guidance the model handles well when told explicitly. Add this instruction in Phase 1 when extracting the helper.

- **Plain-input selection persistence across button click.** Browsers preserve `selectionStart`/`selectionEnd` on `<input>` and `<textarea>` even after blur, so reading them after the dropdown opens should work. The existing `useNativeSelectionAi` already captures the text on `mouseDown` — same approach the formatting toolbar uses. No change needed.

- **Two visible `✦` buttons could confuse users.** Field-level `✦` (whole-field actions) and floating `✦` (selection actions) are both visible when the user has a selection. Mitigation: they sit in clearly different locations (field bottom-left vs cursor / formatting toolbar), they show distinct dropdown content (whole-field vs selection-scoped), and the floating toolbar only appears when there's actually a selection. If real users find this confusing in practice, we can hide the field-level `✦` while a selection exists — but that adds state-coupling that's better avoided unless needed.

---

## Definition of done

- Standalone endpoint accepts `selection` in the request body and threads it into `PanelAgentContext.selection`.
- `PanelAgent.resolveInstructions()` appends the shared selection-instructions block when selection is set.
- `PanelAgent.buildTools()` filters to `update_form_state` + `read_form_state` only when selection is set.
- `ResourceChatContext.buildSystemPrompt()` selection branch uses the shared helper. Refactor verified by re-running the chat-fix manual test — behavior is byte-identical.
- The shared helper at `handlers/chat/selectionInstructions.ts` is the single source of truth for selection-mode agent instructions, including the "expand search string with surrounding context if not unique" guidance.
- `useFieldQuickActions(fieldName, mode)` hook exists and is the single source of truth for the action list and run logic in either mode.
- `AiQuickActions` (field-level) refactored to use the hook with `mode: 'field'`. Pure refactor — behavior unchanged from today.
- `SelectionActionsMenu` component exists and is wired into both `FloatingToolbarPlugin` (Lexical) and `useNativeSelectionAi` (plain inputs). It anchors to the floating `✦` button and shows the selection-scoped action list with a quoted preview header.
- New selection-only built-in actions registered for richcontent fields (`make-bold`, `italicize`, `underline-text`, `strikethrough`, `wrap-link`, `convert-to-heading`).
- Floating selection toolbar has two buttons in both Lexical and plain-input surfaces: `✦` (opens `SelectionActionsMenu` anchored to itself) and `💬` (gated on `useAiChatSafe()`, opens chat panel with selection as context).
- Manual verification on a non-collab field (`metaDescription`): select text, the floating `✦` appears next to the selection. Click it → small dropdown opens beside the button with selection actions. Click `Delete` → text deleted in the live form. Click `💬` instead → chat opens with selection chip.
- Manual verification on a collab field (`title`): same flow, same result.
- Manual verification on a Lexical richcontent field (`body`): formatting toolbar shows `[B][I][U][S]|[<>][🔗]|[✦][💬]`. Click `✦` → dropdown below the toolbar with selection actions including `Make bold`. Click `Make bold` → selection becomes bold in the live editor.
- `reference_panels_ai_surfaces.md` (memory) updated to describe (a) the standalone endpoint's `selection` body param, (b) the shared `buildSelectionInstructions` helper, (c) the new `useFieldQuickActions` hook, (d) the `SelectionActionsMenu` component as the third AI surface alongside chat and standalone.
- `project_selection_ai_popover_followup.md` (memory) deleted — superseded by this plan and its DONE state.
- Panels README mentions the selection-aware dropdown and the two-trigger structure.
- Follow-up i18n task captured (TODO comments in code + a one-line entry in `MEMORY.md` if appropriate).
