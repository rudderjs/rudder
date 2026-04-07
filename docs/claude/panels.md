# Panels, Lexical & Collaborative Editing

> This file is read on-demand by Claude Code when working on panels, lexical, or collaborative editing.
> For the always-loaded essentials, see `/CLAUDE.md`.

---

## @rudderjs/panels

Admin panel: Resource `table()`/`form()`/`detail()`/`agents()`/`relations()` API, 25+ field types, FieldType enum, schema elements (Table, Form, Column, Section, Tabs, Stats, Chart, List, Heading, Text, Code, Snippet, Example, Card, Alert, Divider, Each, View, Dialog, Dashboard, Widget, Wizard/Step, Import, RelationManager), filters (DateFilter, BooleanFilter, NumberFilter, QueryFilter + base Filter.indicator()), ActionGroup + Action.form() modal forms + List.headerActions(), List.importable(), Panel.use() plugin system, persist(url/session/localStorage), lazy, poll, DataSource, versioning, collaboration (Yjs), inline editing, autosave, draftable.

### AI Features
- AI resource agents (ResourceAgent, SSE streaming, unified AI chat sidebar)
- `POST /{panel}/api/_chat` with `run_agent` + `edit_text` + `read_form_state` (client tool) + `delete_record` (server tool, `needsApproval: true`) tools, resource context, field typing animation
- **Block introspection (Plan 5.3)**: `extractBuilderCatalog()` at `src/handlers/chat/blockCatalog.ts` walks the resource form (Section + Tabs aware) and pulls each `BuilderField`'s declared blocks (`_extra.blocks` populated by `BuilderField.blocks([Block.make(...).schema(...)])`). `ResourceChatContext` injects the catalog as an "Available block types" markdown section in the system prompt so the agent calls `update_block` against the structured schema instead of guessing block names from rendered `[BLOCK: ...]` placeholders. Static injection by design — catalog is naturally scoped to one resource so it stays small. The extractor is a pure function reusable as a `describe_blocks` tool wrapper if a hybrid (summary in prompt + tool for detail) is ever needed — no rewrite required.
- **Pluggable ChatContext architecture** (`ResourceChatContext`, `PageChatContext` stub, `GlobalChatContext`) at `src/handlers/chat/contexts/`. One slim dispatcher in `chatHandler.ts` resolves the context, loads/persists conversation, runs the agent loop. New context kinds (page chat, field chat) drop in cleanly.
- **Client-tool round-trip**: `read_form_state` is a Vercel-style client tool — server stops the loop with `pending_client_tools` SSE event, the browser's `clientTools` registry executes the handler against `SchemaForm`'s `valuesRef`, then re-POSTs with `messages: [...]`. Closes the non-collab field visibility gap.
- **`needsApproval` enforcement**: `delete_record` pauses the loop with `tool_approval_required` SSE event. The chat panel renders an **inline amber Approve/Reject card** inside the assistant bubble (no modal). On approve, the dispatcher's continuation flow runs the tool server-side via `resumePendingToolCalls` (in `@rudderjs/ai`), which fulfills the orphan `tool_use` block before re-entering the model loop and exposes the result via `result.resumedToolMessages` so persistence stays sound.
- **Continuation security**: `validateContinuation()` (`src/handlers/chat/continuation.ts`) verifies the prefix of `body.messages` matches the persisted store and that any `approvedToolCallIds`/`rejectedToolCallIds` reference real pending tool calls. Without this, an attacker could rewrite history or bypass approval gates.
- Conversation persistence: AiConversation/AiChatMessage Prisma models, PrismaConversationStore, conversation switcher, auto-title, auto-restore. `persistConversation` writes the full `AiMessage[]` graph (assistant `toolCalls` + tool result messages); `persistContinuation` writes the diff plus `result.resumedToolMessages`.
- Model selection: AiModelConfig in ai config, GET `/_chat/models`, selector in chat input
- AiChatProvider takes panelPath prop — chat is panel-wide, not resource-tied
- Selected text context: select text in any field -> Ask AI button -> chat opens with selection locked to that field. edit_text tool constrained via z.literal(field).
- Field.ai(actions?) — quick action sparkle menu next to field labels (rewrite, expand, shorten, fix-grammar, translate, summarize, make-formal, simplify)

### Theming
- `Panel.theme()` — runtime CSS variable injection (presets, base colors, accent colors, chart palettes, radius, fonts, icon library). resolveTheme() layering system.
- `Panel.themeEditor()` — built-in /theme settings page with iframe live preview, DB persistence (panelGlobal), save/reset/shuffle, dark mode sync
- Icon adapter system: PanelIcon + IconAdapterProvider for lucide/tabler/phosphor/remix
- 4 presets (default/nova/maia/lyra), 6 base colors, 16 accent colors, 5 chart palettes, radius presets, Google Fonts

### Plugin System
- `registerLazyElement`/`registerResolver` for plugins
- Panel.notifications() config + notification routes
- Panel.use() plugin system — PanelPlugin with schemas/pages/register/boot hooks

### i18n Override Mechanism
- Bundled defaults live in `packages/panels/src/i18n/{en,ar}.ts` (flat `PanelI18n` schema). These are the canonical type and ship with the package.
- Apps can override individual strings or add a new locale by creating `lang/<locale>/panels.json`. `getPanelI18n()` deep-merges the override on top of the bundled default and caches the result per locale.
- Override resolution requires `@rudderjs/localization` to be installed. `PanelServiceProvider.boot()` calls `preloadNamespace(locale, 'panels')` (and the fallback) before any panel request renders, so `getPanelI18n()` stays sync at render time. If localization isn't installed, panels falls back to bundled defaults silently.
- `_clearI18nCache()` from `panels/src/i18n/index.ts` is the test/HMR escape hatch — used by `i18n-override.test.ts` and called once after preload to drop any merged result computed before the override landed in cache.
- Starter file is published via `pnpm rudder vendor:publish --tag=panels-translations` (registered in `PanelServiceProvider.register()`, source at `packages/panels/lang/en/panels.json`).
- `@rudderjs/localization` is an **optional peer dependency** — keep it that way. The dynamic import in `preloadPanelTranslations()` swallows resolution errors so the package still works standalone.

---

## @rudderjs/panels-lexical

Lexical rich-text editor adapter — `RichContentField`, `CollaborativePlainText`, block editor, toolbar profiles (document/default/simple/minimal/none), slash commands, floating link editor, useYjsCollab hook (WebSocket + IndexedDB providers), imperative editor refs for version restore, FloatingToolbarPlugin Ask AI button, CollaborativePlainText SelectionAiPlugin.

---

## Panels Pitfalls

- **Panels pages not updated after source edit**: `packages/panels/pages/` are published copies. After editing source, re-run `pnpm rudder vendor:publish --tag=panels-pages --force` from `playground/`
- **`panels-lexical` cycle**: `@rudderjs/panels` must NOT depend on `@rudderjs/panels-lexical`. The `+Layout.tsx` registers it client-side via `if (typeof window !== 'undefined') import('@rudderjs/panels-lexical').then(...)`. `RichContentField` lives in `@rudderjs/panels-lexical`, not `@rudderjs/panels`.
- **Plugin element registration**: Plugin schema elements use `registerLazyElement` (SSR-safe via `React.lazy`). Plugin SSR resolvers use `registerResolver` (via `PanelPlugin.resolvers`). Plugins publish `_register-{name}.ts` files auto-discovered by `+Layout.tsx` via `import.meta.glob('../_register-*.ts', { eager: true })`.
- **Media plugin pattern**: `@rudderjs/media` uses `PanelPlugin.resolvers` for SSR data + `_register-media.ts` for client component. Zero media-specific code in panels.

---

## Collaborative Editing Architecture

Each collaborative field gets its own Y.Doc + WebSocket room. The form has a separate Y.Map for simple fields.

**Three persistence layers** (all work together):
- **WebSocket** — real-time sync between users (server memory, lost on restart)
- **IndexedDB** — browser-local persistence (survives refresh + server restart)
- **livePrisma/liveRedis** — server-side persistence (survives everything, cross-device)

**Key implementation rules:**
- IndexedDB provider must be created **before** WebSocket provider (fire-and-forget, no await). IndexedDB is local (~ms) and naturally loads before WebSocket (network latency), ensuring local content isn't overwritten by empty server rooms.
- Never clear Y.Doc rooms on normal save — rooms already have correct content.
- SeedPlugin checks **actual root content** (`root.length > 0` or `root.getTextContent()`) not state vector (`sv.length`). State vector can be > 1 from provider metadata alone.
- SeedPlugin uses a **retry pattern** — CollaborationPlugin may overwrite the first seed, so retry until content sticks (max 5 attempts).
- Version restore uses **imperative editor refs** (`EditorRefPlugin.setContent()`) — writes to the editor which propagates through CollaborationPlugin binding to Y.Doc and all connected users. Never fight Yjs — use it.
- Registration keys for editor components use `_lexical:` prefix (`_lexical:richcontent`, `_lexical:collaborativePlainText`) to avoid collision with the `FieldInput` registry shortcut.

**Y.Doc room naming:**
- Form fields map: `panel:{resource}:{recordId}`
- Text fields: `panel:{resource}:{recordId}:text:{fieldName}`
- Rich text fields: `panel:{resource}:{recordId}:richcontent:{fieldName}`

**Server-side AI editing (Live facade):**
- `Live.editText(docName, op, aiCursor?)` — surgical text replace/insert/delete in Y.XmlText. Walks root -> Y.XmlText children (paragraphs/headings) -> inner delta text runs. `aiCursor` sets visible AI selection highlight.
- `Live.editBlock(docName, blockType, blockIndex, field, value)` — updates block data via `Y.XmlElement.setAttribute('__blockData', obj)`. Blocks are inside paragraph Y.XmlText children, not at root level.
- `Live.readText(docName)` — extracts plain text from a Lexical Y.Doc room (for `read_record` to include collaborative richcontent/textarea field content).
- `Live.setAiAwareness(docName, { name, color }, cursorTarget?)` — broadcasts AI cursor/selection to all clients. Uses synthetic client ID (999999999) and lib0 varint encoding matching y-protocols awareness wire format. `cursorTarget.length` creates a selection highlight instead of a cursor line.
- `Live.clearAiAwareness(docName)` — removes AI cursor from all clients.
- `Resource.getFieldMeta()` — extracts `{ type, yjs }` from form fields for agent routing.
- ResourceAgent `edit_text` is a `.server()` tool: collab fields -> `Live.editText/editBlock` with AI cursor; non-collab -> string ops + `Live.updateMap`.

**Lexical Y.Doc tree structure (verified):**
```
root (Y.XmlText)
  ├── Y.XmlText (__type="heading")   <- NOT Y.XmlElement!
  │     ├── Y.Map (__type="text")    <- TextNode metadata, offset += 1
  │     └── "hello world"            <- actual text, offset += string.length
  ├── Y.XmlText (__type="paragraph")
  │     ├── Y.XmlElement (custom-block)  <- block INSIDE paragraph
  │     │     attrs: __blockType, __blockData (raw object, NOT JSON string)
  │     ├── Y.Map (__type="text")
  │     └── "some text"
  └── Y.XmlText (__type="list")
        ├── Y.XmlText (list item)    <- nested
        └── Y.XmlText (list item)
```
- `toString()` is unreliable — returns `[object Object]text`. Must walk inner delta for text search.
- `Y.XmlText.delete(offset, len)` / `insert(offset, text)` work on flattened offset across all inner items.

**Config layers:**
- `config/live.ts` `providers: ['websocket', 'indexeddb']` — controls form-level Y.Map providers
- `.persist(['websocket', 'indexeddb'])` or `.collaborative()` on a field — marks it as collaborative, enables per-field Y.Doc
