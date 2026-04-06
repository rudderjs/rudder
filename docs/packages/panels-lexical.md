# @rudderjs/panels-lexical

Lexical rich-text editor adapter for `@rudderjs/panels`. Provides rich text editing, real-time collaborative plain text, block editor with slash commands, and AI integration.

## Installation

```bash
pnpm add @rudderjs/panels-lexical
```

## Setup

Register the plugin on your panel:

```ts
// app/Panels/AdminPanel.ts
import { Panel } from '@rudderjs/panels'
import { panelsLexical } from '@rudderjs/panels-lexical'

export default Panel.make('admin')
  .use(panelsLexical())
  .resources([/* ... */])
```

The plugin registers its components using the `_lexical:` prefix (`_lexical:richcontent`, `_lexical:collaborativePlainText`) to avoid collision with the default `FieldInput` registry.

## Usage

### RichContentField

Full rich-text editor with configurable toolbar, slash commands, and floating link editor:

```ts
import { RichContentField } from '@rudderjs/panels-lexical'

Resource.make('Article')
  .form((form) => [
    form.text('title'),
    RichContentField.make('body')
      .toolbar('default')
      .collaborative(),
  ])
```

### Toolbar Profiles

Control the toolbar complexity per field:

| Profile | Description |
|---|---|
| `document` | Full toolbar -- headings, lists, quotes, code blocks, images, tables |
| `default` | Standard editing -- headings, lists, bold, italic, links |
| `simple` | Reduced set -- bold, italic, underline, links |
| `minimal` | Inline formatting only -- bold, italic |
| `none` | No toolbar -- content only |

```ts
RichContentField.make('notes').toolbar('simple')
RichContentField.make('content').toolbar('document')
```

### CollaborativePlainText

Real-time collaborative plain text field backed by Yjs:

```ts
import { CollaborativePlainText } from '@rudderjs/panels-lexical'

Resource.make('Document')
  .form((form) => [
    CollaborativePlainText.make('content'),
  ])
```

### Block Editor

The rich-text editor includes a slash command menu for inserting blocks. Type `/` to open the menu:

- Headings (H1, H2, H3)
- Bullet list, numbered list
- Quote, code block
- Horizontal rule
- Custom blocks registered by plugins

### Floating Toolbar

Selecting text reveals a floating toolbar with formatting options and an "Ask AI" button. The AI button opens the panels chat sidebar with the selected text as context, constrained to that specific field.

### useYjsCollab Hook

For custom components that need Yjs collaboration:

```ts
import { useYjsCollab } from '@rudderjs/panels-lexical'

function MyEditor({ docName }: { docName: string }) {
  const { provider, doc } = useYjsCollab(docName, {
    providers: ['websocket', 'indexeddb'],
  })

  // provider: WebsocketProvider instance
  // doc: Y.Doc instance
}
```

The hook creates the IndexedDB provider before the WebSocket provider to ensure local content loads first.

### SelectionAiPlugin

Adds an "Ask AI" button when text is selected in `CollaborativePlainText` fields:

```ts
CollaborativePlainText.make('content')
  // SelectionAiPlugin is enabled automatically
```

Selected text is sent to the AI chat sidebar with field context, enabling field-locked `edit_text` operations.

## Notes

- `@rudderjs/panels` must NOT depend on `@rudderjs/panels-lexical` -- the plugin is loaded client-side via dynamic import to avoid circular dependencies.
- Registration keys use the `_lexical:` prefix to separate from the core field registry.
- IndexedDB provider must be created before WebSocket provider to prevent server rooms from overwriting local content.
- Imperative editor refs (`EditorRefPlugin.setContent()`) are used for version restore -- writes propagate through the Yjs binding to all connected users.
- Collaborative fields each get their own Y.Doc and WebSocket room, named `panel:{resource}:{recordId}:{type}:{fieldName}`.
