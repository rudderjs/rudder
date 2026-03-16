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

- **LexicalEditor** — Rich text editor with collaboration support, slash commands, floating toolbar, drag handles
- **CollaborativePlainText** — Lexical-based collaborative plain text field (single-line or multi-line)
- **BlockNode** — Custom decorator node for embedding typed blocks in rich text
- **SlashCommandPlugin** — "/" slash command menu (headings, lists, quotes, code, divider, custom blocks)
- **FloatingToolbarPlugin** — Bold/Italic/Underline/Strikethrough/Code/Link formatting toolbar

## Usage

Once registered, `RichContentField` in your resources automatically uses the Lexical editor:

```ts
import { RichContentField } from '@boostkit/panels'

class ArticleResource extends Resource {
  fields() {
    return [
      RichContentField.make('body').label('Body'),
    ]
  }
}
```

Collaborative text fields (`TextField.make('title').collaborative()`) also use Lexical-based collaborative editing.

## Without this package

If `@boostkit/panels-lexical` is not installed, rich content fields fall back to a plain `<textarea>` and collaborative text fields use native inputs without real-time sync.
