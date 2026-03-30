# @boostkit/panels-lexical

Lexical rich-text editor adapter for `@boostkit/panels`. Provides rich content editing, collaborative text fields, and block-based content for panel resources.

## Installation

```bash
pnpm add @boostkit/panels-lexical
```

Requires `@boostkit/panels` and Lexical peer dependencies.

## Setup

Register the editor in your panel layout:

```ts
import { registerLexical } from '@boostkit/panels-lexical'
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

## Usage

### Basic

```ts
import { RichContentField } from '@boostkit/panels-lexical'

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
import { Block, TextField, TextareaField, SelectField } from '@boostkit/panels'

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

### Collaborative Editing

```ts
// Rich text with real-time collaboration
RichContentField.make('content')
  .toolbar('document')
  .collaborative()

// Plain text fields also support collaboration
TextField.make('title').collaborative()
TextareaField.make('notes').collaborative()
```

Collaboration requires `@boostkit/live` for the Yjs WebSocket server.

## Without this package

If `@boostkit/panels-lexical` is not installed, rich content fields fall back to a plain `<textarea>` and collaborative text fields use native inputs without real-time sync.
