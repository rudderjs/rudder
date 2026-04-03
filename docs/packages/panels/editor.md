# Editor

`@rudderjs/panels` uses a pluggable editor registry for rich-text fields. By default, rich content fields render as plain `<textarea>` elements. Install `@rudderjs/panels-lexical` to upgrade them to a full Lexical rich-text editor.

---

## RichContentField

`RichContentField` is a full rich-text editor field powered by [Lexical](https://lexical.dev/).

```ts
import { RichContentField, Block, TextField, SelectField } from '@rudderjs/panels'

RichContentField.make('content')
  .label('Content')
  .placeholder('Start writing your article…')
  .blocks([
    Block.make('callToAction')
      .label('Call to Action')
      .icon('📣')
      .schema([
        TextField.make('title').label('Title').required(),
        TextField.make('buttonText').label('Button Text'),
        TextField.make('url').label('URL'),
        SelectField.make('style').label('Style').options([
          { value: 'primary', label: 'Primary' },
          { value: 'outline', label: 'Outline' },
        ]),
      ]),
    Block.make('video')
      .label('Video Embed')
      .icon('🎬')
      .schema([
        TextField.make('url').label('URL').required(),
        TextField.make('caption').label('Caption'),
      ]),
  ])
  .collaborative()
```

### RichContentField Methods

| Method | Description |
|--------|-------------|
| `.placeholder(text)` | Placeholder text shown when the editor is empty |
| `.blocks(blocks)` | Register custom block types (appear in the slash menu) |
| `.collaborative()` | Enable real-time Yjs collaboration (each field gets its own Y.Doc + WebSocket room) |
| `.required()` | Mark as required |
| `.readonly()` | Make read-only |
| `.hideFrom(...)` | Hide from specific views |

The field value is stored as **Lexical JSON** (the serialized editor state).

---

## Block API

`Block` defines a custom block type for use with `RichContentField`. Custom blocks appear in the slash command menu alongside built-in node types.

```ts
import { Block, TextField, NumberField } from '@rudderjs/panels'

Block.make('pricing')
  .label('Pricing Card')
  .icon('💰')
  .schema([
    TextField.make('title').label('Plan Name').required(),
    NumberField.make('price').label('Monthly Price'),
    TextField.make('description').label('Description'),
  ])
```

| Method | Description |
|--------|-------------|
| `Block.make(name)` | Create a block with a unique identifier |
| `.label(text)` | Display label in the block picker (defaults to `name`) |
| `.icon(emoji)` | Emoji or icon string shown in the slash menu |
| `.schema(fields)` | Fields rendered when the block is inserted |

Each block renders as an inline card in the editor with its fields displayed in a form layout. Blocks can be reordered via drag-and-drop.

---

## Built-in Editor Features

When `@rudderjs/panels-lexical` is installed, the editor includes:

### Slash Commands

Type `/` anywhere in the editor to open a command menu. Built-in commands:

| Command | Description |
|---------|-------------|
| Heading 1 | Large heading (`h1`) |
| Heading 2 | Medium heading (`h2`) |
| Heading 3 | Small heading (`h3`) |
| Bullet List | Unordered list |
| Numbered List | Ordered list |
| Quote | Block quote |
| Code Block | Code snippet |
| Divider | Horizontal rule |

Custom blocks registered via `.blocks()` also appear in the slash menu with their label and icon.

### Floating Toolbar

Select text to reveal a floating toolbar with formatting options:

- **Bold**, **Italic**, **Underline**, **Strikethrough**
- **Code** (inline code)
- **Link** (insert/remove hyperlink)

The toolbar follows the selection and repositions on scroll.

### Drag-and-Drop Blocks

Hover over any block to see a drag handle on the left side. Grab the handle to reorder blocks within the editor. A visual indicator shows the drop target position.

---

## Editor Registry

The editor registry (`editorRegistry`) is a global registry that maps editor keys to React components. When a field like `RichContentField` renders, it looks up the registered editor component. If none is registered, it falls back to a plain textarea.

---

## Installing `@rudderjs/panels-lexical`

```bash
pnpm add @rudderjs/panels-lexical
```

### Setup

Register the Lexical editor in your app's panel entry point (typically in `pages/(panels)/_components/` or a shared setup file):

```ts
import { registerLexical } from '@rudderjs/panels-lexical'

registerLexical()
```

This registers the Lexical rich-text editor for all `RichContentField` and collaborative text fields in the panel.

---

## Tailwind Class Scanning

`@rudderjs/panels-lexical` ships its own styled components. To ensure Tailwind picks up the classes used by the editor, add a `@source` directive to your CSS:

```css
/* src/index.css */
@source "../node_modules/@rudderjs/panels-lexical/dist";
```

This tells Tailwind v4 to scan the editor package's dist files for class names during the build.

---

## Fallback Behavior

Without `@rudderjs/panels-lexical`:

- `RichContentField` renders as a `<textarea>` with raw text/HTML
- Collaborative text fields still sync via Yjs but use plain text editing
- All other panel features work normally

This keeps `@rudderjs/panels` lightweight -- the Lexical dependency (~200KB) is only pulled in when you need rich-text editing.

---

## Schema Publishing

If you need to customize the editor's Prisma schema (e.g., for editor-specific models), publish it:

```bash
pnpm rudder vendor:publish --tag=panels-schema
```

This copies the panel schema definitions into your project for customization.
