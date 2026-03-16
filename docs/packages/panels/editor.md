# Editor

`@boostkit/panels` uses a pluggable editor registry for rich-text fields. By default, rich content fields render as plain `<textarea>` elements. Install `@boostkit/panels-lexical` to upgrade them to a full Lexical rich-text editor.

---

## Editor Registry

The editor registry (`editorRegistry`) is a global registry that maps editor keys to React components. When a field like `RichContentField` renders, it looks up the registered editor component. If none is registered, it falls back to a plain textarea.

---

## Installing `@boostkit/panels-lexical`

```bash
pnpm add @boostkit/panels-lexical
```

### Setup

Register the Lexical editor in your app's panel entry point (typically in `pages/(panels)/_components/` or a shared setup file):

```ts
import { registerLexical } from '@boostkit/panels-lexical'

registerLexical()
```

This registers the Lexical rich-text editor for all `RichContentField` and collaborative text fields in the panel.

---

## Tailwind Class Scanning

`@boostkit/panels-lexical` ships its own styled components. To ensure Tailwind picks up the classes used by the editor, add a `@source` directive to your CSS:

```css
/* src/index.css */
@source "../node_modules/@boostkit/panels-lexical/dist";
```

This tells Tailwind v4 to scan the editor package's dist files for class names during the build.

---

## Fallback Behavior

Without `@boostkit/panels-lexical`:

- `RichContentField` renders as a `<textarea>` with raw text/HTML
- Collaborative text fields still sync via Yjs but use plain text editing
- All other panel features work normally

This keeps `@boostkit/panels` lightweight -- the Lexical dependency (~200KB) is only pulled in when you need rich-text editing.

---

## Schema Publishing

If you need to customize the editor's Prisma schema (e.g., for editor-specific models), publish it:

```bash
pnpm artisan vendor:publish --tag=panels-schema
```

This copies the panel schema definitions into your project for customization.
