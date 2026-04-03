# @rudderjs/panels-lexical

Lexical rich-text editor adapter for `@rudderjs/panels`. Provides rich content editing, collaborative text fields, and block-based content for panel resources.

## Installation

```bash
pnpm add @rudderjs/panels-lexical
```

Requires `@rudderjs/panels` and Lexical peer dependencies.

## Setup

Register the editor in your panel layout:

```ts
import { registerLexical } from '@rudderjs/panels-lexical'
registerLexical()
```

For Tailwind CSS to scan the component classes, add to your CSS:

```css
@source "../../packages/panels-lexical/src";
```

(Adjust the path based on your project structure)

## Components

- **LexicalEditor** — Rich text editor with collaboration support, slash commands, toolbar profiles, drag handles
- **CollaborativePlainText** — Lexical-based collaborative plain text field (single-line or multi-line)
- **BlockNode** — Custom decorator node for embedding typed blocks in rich text
- **SlashCommandPlugin** — "/" slash command menu (headings, lists, quotes, code, divider, custom blocks)
- **FloatingToolbarPlugin** — Floating formatting toolbar on text selection
- **FixedToolbarPlugin** — Google Docs-style persistent toolbar pinned to editor top
- **FloatingLinkEditorPlugin** — Inline link URL editor (view + edit modes)

## Usage

### Basic

```ts
import { RichContentField } from '@rudderjs/panels-lexical'

RichContentField.make('body').label('Body')
```

### Toolbar Profiles

```ts
// Google Docs-style fixed toolbar (undo/redo, headings, B/I/U/S, align, lists, etc.)
RichContentField.make('content').toolbar('document')

// Floating toolbar on selection (default — B, I, U, S, code, link)
RichContentField.make('notes').toolbar('default')

// Simplified floating toolbar (bold, italic, link, lists, heading)
RichContentField.make('comment').toolbar('simple')

// Minimal (bold, italic, link only)
RichContentField.make('bio').toolbar('minimal')

// No toolbar
RichContentField.make('code').toolbar('none')

// Explicit tool list
RichContentField.make('article').toolbar(['bold', 'italic', 'heading', 'link', 'bulletList'])
```

#### Available Tools

| Tool | Description |
|------|-------------|
| `bold` | Bold text |
| `italic` | Italic text |
| `underline` | Underline text |
| `strikethrough` | Strikethrough text |
| `code` | Inline code |
| `link` | Hyperlink |
| `heading` | H1/H2/H3 dropdown |
| `h1` / `h2` / `h3` | Individual heading levels |
| `bulletList` | Unordered list |
| `orderedList` | Ordered list |
| `blockquote` | Block quote |
| `codeBlock` | Code block |
| `divider` | Horizontal rule |
| `align` | Text alignment (left/center/right) |
| `indent` | Indent/outdent |
| `undo` / `redo` | Undo/redo history |

#### Profile Comparison

| Tool | `document` | `default` | `simple` | `minimal` | `none` |
|------|:---:|:---:|:---:|:---:|:---:|
| undo/redo | ✓ | | | | |
| heading | ✓ | | ✓ | | |
| bold/italic | ✓ | ✓ | ✓ | ✓ | |
| underline/strikethrough | ✓ | ✓ | | | |
| code/link | ✓ | ✓ | ✓ (link) | ✓ (link) | |
| align | ✓ | | | | |
| lists | ✓ | | ✓ | | |
| indent | ✓ | | | | |
| blockquote/codeBlock/divider | ✓ | | | | |
| **Fixed toolbar** | ✓ | | | | |

### Slash Commands

The `/` slash command menu adapts to the toolbar profile — it only shows commands for enabled tools. Custom blocks always appear.

```ts
// Follows toolbar profile (default)
RichContentField.make('content').toolbar('simple')
// Slash menu shows: headings, bullet list, ordered list (matching simple profile)

// Disable slash commands entirely
RichContentField.make('content').slashCommand(false)

// Explicit slash command items
RichContentField.make('content').slashCommand(['heading', 'bulletList'])
```

### Custom Blocks

```ts
import { Block, TextField, TextareaField, SelectField } from '@rudderjs/panels'

RichContentField.make('article')
  .toolbar('document')
  .blocks([
    Block.make('callout')
      .label('Callout')
      .icon('💡')
      .schema([
        TextField.make('title'),
        TextareaField.make('content').required(),
        SelectField.make('type').options([
          { value: 'info', label: 'Info' },
          { value: 'warning', label: 'Warning' },
        ]),
      ]),
  ])
```

### Links

Links use an inline floating editor (Lexical's official pattern):
1. Select text → click 🔗 in toolbar → text wraps in a link with placeholder URL
2. Floating link editor appears below the link — type the real URL
3. Click on an existing link → view mode shows URL + edit/remove buttons
4. Changes sync to all connected users via Yjs

## Collaborative Editing

### Architecture

Each collaborative field gets its own **Y.Doc** (Yjs document) + WebSocket room. This isolation ensures multiple editors on the same form don't interfere with each other.

```
Form (resource edit page)
├── Y.Map "fields" — simple collab fields (toggle, date, color)
│   ├── WebSocket provider (real-time sync)
│   └── IndexedDB provider (local persistence)
│
├── Y.Doc per text field — CollaborativePlainText
│   ├── Room: panel:articles:id:text:title
│   ├── WebSocket provider
│   └── IndexedDB provider
│
└── Y.Doc per richcontent field — LexicalEditor
    ├── Room: panel:articles:id:richcontent:content
    ├── WebSocket provider
    └── IndexedDB provider
```

### Persistence Layers

| Layer | Scope | Survives refresh | Survives server restart | Cross-device |
|-------|-------|:---:|:---:|:---:|
| **WebSocket** (server memory) | All users | ✓ | ✗ | ✓ |
| **IndexedDB** (browser) | Single browser | ✓ | ✓ | ✗ |
| **livePrisma** (database) | All users | ✓ | ✓ | ✓ |

For production, enable `livePrisma()` in your live config for full persistence:

```ts
// config/live.ts
import { livePrisma } from '@rudderjs/live'

export default {
  path: '/ws-live',
  persistence: livePrisma(),
  providers: ['websocket', 'indexeddb'],
}
```

### Making Fields Collaborative

```ts
// Rich text — uses its own Lexical Y.Doc room
RichContentField.make('content')
  .toolbar('document')
  .collaborative()
  // or: .persist(['websocket', 'indexeddb'])

// Plain text — uses CollaborativePlainText (Lexical under the hood)
TextField.make('title').collaborative()
TextField.make('title').persist(['websocket', 'indexeddb'])  // equivalent

// Textarea — same as text, but multi-line
TextareaField.make('notes').collaborative()

// Simple fields (toggle, date, color) — use Y.Map, no Lexical
ToggleField.make('featured').collaborative()
DateField.make('publishedAt').collaborative()
```

### Key Rules for Collaborative Fields

1. **`.collaborative()` is shorthand for `.persist(['websocket', 'indexeddb'])`** — both work the same way.

2. **The form must have Yjs enabled** — this happens automatically when any field has `.collaborative()` or `.persist(['websocket', ...])`.

3. **`config/live.ts` `providers` controls the form-level Y.Map** — set `providers: ['websocket', 'indexeddb']` to enable persistence for simple collab fields (toggle, date, color).

4. **Per-field Y.Doc rooms are created automatically** — each text/richcontent collaborative field gets its own WebSocket room + IndexedDB database. Room names follow the pattern: `panel:{resource}:{recordId}:{type}:{fieldName}`.

5. **IndexedDB loads before WebSocket** — the `useYjsCollab` hook creates IndexedDB first (fire-and-forget), then WebSocket. IndexedDB is local (~ms), WebSocket has network latency. Local content naturally loads first.

6. **Never clear Y.Doc rooms on normal save** — rooms already have the correct content after save. Only clear on explicit "Re-sync" actions or version restore.

7. **Version restore uses imperative refs** — `EditorRefPlugin` / `PlainTextEditorRefPlugin` expose `setContent()` so the form can write directly to the editor. Changes propagate through CollaborationPlugin to Y.Doc and all connected users.

8. **SeedPlugin handles fresh rooms** — when a Y.Doc room is empty (first load, after server restart without livePrisma), the SeedPlugin seeds from the DB value. It checks actual root content (not state vector) and retries to handle CollaborationPlugin race conditions.

### Seeding Behavior

When the edit page loads:

```
1. +data.ts loads record from DB
2. Live.seed(docName, fieldData) seeds the form-level Y.Map (simple fields)
3. Form renders with DB values as initialValues
4. Each collaborative field mounts:
   a. useYjsCollab creates Y.Doc + IndexedDB + WebSocket providers
   b. IndexedDB loads local content (if any)
   c. WebSocket connects to server room
   d. CollaborationPlugin binds Y.Doc to editor
   e. SeedPlugin checks: if Y.Doc root is empty AND value prop exists → seeds from DB
```

### Version History

Version history uses a **comparison view** — not a preview mode:

1. User clicks "Version History" → version list appears
2. User selects a version → per-field comparison (current vs version)
3. Each field has a **[Restore]** button → updates that single field in the live form
4. For text/richcontent: uses imperative `setContent()` ref → writes to editor → propagates via Yjs to all users
5. For simple fields: writes to Y.Map directly
6. Collab stays active throughout — no disconnection, no re-mounting

## Without this package

If `@rudderjs/panels-lexical` is not installed, rich content fields fall back to a plain `<textarea>` and collaborative text fields use native inputs without real-time sync.
