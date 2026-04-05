# @rudderjs/panels

Admin panel builder for RudderJS. Define resources and pages in TypeScript — the package auto-generates CRUD API routes and a polished React UI.

```bash
pnpm add @rudderjs/panels
```

---

## Quick Start

```ts
// app/Panels/Admin/AdminPanel.ts
import { Panel } from '@rudderjs/panels'
import { UserResource } from './resources/UserResource.js'
import { SiteSettingsGlobal } from './globals/SiteSettingsGlobal.js'

export const adminPanel = Panel.make('admin')
  .path('/admin')
  .branding({ title: 'My Admin' })
  .layout('sidebar')
  .guard(async (ctx) => ctx.user?.role === 'admin')
  .resources([UserResource])
  .globals([SiteSettingsGlobal])
```

### Plugins

Extend panels with `.use()`:

```ts
import { media } from '@rudderjs/media/server'
import { panelsLexical } from '@rudderjs/panels-lexical/server'

export const adminPanel = Panel.make('admin')
  .path('/admin')
  .use(panelsLexical())
  .use(media({ conversions: [{ name: 'thumb', width: 200, format: 'webp' }] }))
  .resources([UserResource])
```

```ts
// bootstrap/providers.ts
import { panels } from '@rudderjs/panels'
import { adminPanel } from '../app/Panels/Admin/AdminPanel.js'

export default [
  panels([adminPanel]),
]
```

Publish the React UI pages:

```bash
pnpm rudder vendor:publish --tag=panels-pages
pnpm rudder vendor:publish --tag=panels-pages --force  # after upgrading
```

---

## Defining Resources

Resources use `table()`, `form()`, and `detail()` to configure CRUD. Each method receives a pre-configured schema element and returns it with your configuration.

```ts
import {
  Resource, Table, Form, Column, Tab,
  TextField, TextareaField, SelectField, DateField, SelectFilter, Action,
  Stats, Stat,
} from '@rudderjs/panels'
import { Article } from '../../Models/Article.js'

export class ArticleResource extends Resource {
  static model = Article
  static label = 'Articles'
  static labelSingular = 'Article'
  static icon = 'file-text'

  table(table: Table) {
    return table
      .columns([
        Column.make('title').sortable().searchable(),
        Column.make('status').badge(),
        Column.make('createdAt').date().sortable(),
      ])
      .sortBy('createdAt', 'DESC')
      .paginated('pages', 15)
      .searchable(['title'])
      .remember('session')
      .softDeletes()
      .live()
      .tabs([
        Tab.make('All'),
        Tab.make('Published').scope((q) => q.where('status', 'published')),
        Tab.make('Drafts').scope((q) => q.where('status', 'draft')),
      ])
      .filters([
        SelectFilter.make('status').options([
          { label: 'Published', value: 'published' },
          { label: 'Draft', value: 'draft' },
        ]),
      ])
      .actions([
        Action.make('publish').bulk().handler(async (records) => { /* ... */ }),
        Action.make('delete').destructive().confirm('Delete selected?').bulk()
          .handler(async (records) => { /* ... */ }),
      ])
  }

  form(form: Form) {
    return form
      .versioned()
      .draftable()
      .fields([
        TextField.make('title').required().searchable().sortable(),
        TextareaField.make('body'),
        SelectField.make('status').options(['draft', 'published']),
        DateField.make('createdAt').readonly().hideFromCreate().hideFromEdit(),
      ])
  }

  detail(record?: Record<string, unknown>) {
    return [
      Stats.make([
        Stat.make('Status').value(String(record?.status ?? 'draft')),
        Stat.make('Views').value(Number(record?.views ?? 0)),
      ]),
    ]
  }
}
```

### Table Configuration

| Method | Description |
|---|---|
| `.columns([Column.make(...)])` | Define table columns |
| `.sortBy('col', 'DESC')` | Default sort |
| `.paginated('pages', 15)` | Pagination mode and per-page count |
| `.searchable(['col1', 'col2'])` | Enable search on specific columns |
| `.remember('session')` | Persist table state (`'session'` \| `'url'` \| `'localStorage'`) |
| `.softDeletes()` | Enable trash/restore |
| `.live()` | Real-time WebSocket updates |
| `.tabs([Tab.make(...)])` | Filter tabs with independent state |
| `.filters([SelectFilter.make(...)])` | Filter dropdowns |
| `.actions([Action.make(...)])` | Bulk/row actions |
| `.titleField('name')` | Field used as record display title |
| `.emptyState({ icon, heading, description })` | Custom empty state |
| `.creatable()` | Show "+ Create" button |

### Column Options

```ts
Column.make('title').sortable().searchable()
Column.make('status').badge()
Column.make('createdAt').date().sortable()
Column.make('price').numeric()
Column.make('active').boolean()
Column.make('avatar').image()
Column.make('featured').boolean().editable(ToggleField.make('featured'))  // inline editing
Column.make('role').editable(SelectField.make('role').options([...]))     // inline select
```

### Form Configuration

| Method | Description |
|---|---|
| `.fields([...])` | Form fields (TextField, Section, Tabs, etc.) |
| `.versioned()` | Enable version history |
| `.draftable()` | Enable draft/publish workflow |
| `.autosave(interval)` | Enable periodic autosave (ms) |
| `.onSubmit(fn)` | Custom submit handler |
| `.beforeSubmit(fn)` | Transform data before validation |
| `.afterSubmit(fn)` | Run after successful submit |
| `.successMessage(msg)` | Success message text |

---

## Field Types

| Class | Description |
|---|---|
| `TextField` | Text input |
| `EmailField` | Email input |
| `PasswordField` | Password input |
| `NumberField` | Number input (min, max, step, progressBar) |
| `TextareaField` | Multi-line text |
| `SelectField` | Dropdown (single or multi) |
| `BooleanField` | Checkbox |
| `ToggleField` | Toggle switch |
| `DateField` | Date / datetime picker |
| `SlugField` | Slug with auto-generation from source field |
| `TagsField` | Multi-value tag input |
| `ColorField` | Color picker |
| `HiddenField` | Hidden form value |
| `JsonField` | JSON editor |
| `FileField` | File upload (image, optimize, conversions) |
| `RelationField` | BelongsTo / BelongsToMany select |
| `HasMany` | HasMany relation table |
| `ComputedField` | Virtual computed field |
| `RichContentField` | Lexical rich text editor |
| `RepeaterField` | Repeatable field group |
| `BuilderField` | Block-based builder |

### Field Options

```ts
TextField.make('name')
  .label('Full Name')
  .required()
  .searchable()
  .sortable()
  .placeholder('Enter name...')
  .default('Untitled')
  .hideFromTable()
  .hideFromCreate()
  .hideFromEdit()
  .readonly()
  .collaborative()           // Yjs real-time sync
  .persist('websocket')      // persist mode: 'websocket' | 'indexeddb' | 'localStorage' | 'url' | 'session'
  .showWhen('role', 'admin') // conditional visibility
  .validate(async (value, data) => value ? true : 'Required')
```

---

## Schema Elements

Schema elements are self-contained UI components that can be used anywhere — Pages, Resources, Globals, inside other elements.

### Heading & Text

```ts
Heading.make('Title')
Heading.make('Subtitle').level(2)   // h1, h2, h3
Text.make('Description text.')
```

### Code

```ts
Code.make('const x = 1').language('ts').title('Example').lineNumbers()
```

### Snippet

Tabbed code display with copy button:

```ts
Snippet.make('Install')
  .tab('npm', 'npx create-rudderjs-app', 'bash')
  .tab('pnpm', 'pnpm create rudderjs-app', 'bash')
  .tab('yarn', 'yarn create rudderjs-app', 'bash')
```

### Example

Live preview + expandable code:

```ts
Example.make('Toggle Field')
  .description('A boolean toggle switch.')
  .code(`ToggleField.make('active').label('Active')`)
  .schema([
    ToggleField.make('active').label('Active'),
  ])
```

### Card

Lightweight wrapper with title/description:

```ts
Card.make('User Profile')
  .description('Basic information')
  .schema([
    TextField.make('name').label('Name'),
    EmailField.make('email').label('Email'),
  ])
```

### Alert

Callout box with severity:

```ts
Alert.make('Record saved successfully.').success().title('Success')
Alert.make('This cannot be undone.').danger().title('Warning')
Alert.make('Maintenance tonight.').warning()
Alert.make('New feature available.').info()
```

### Divider

Horizontal separator:

```ts
Divider.make()                      // simple line
Divider.make('Advanced Options')    // labeled divider
```

### Stats

```ts
Stats.make([
  Stat.make('Users').value(150),
  Stat.make('Articles').value(42),
  Stat.make('Revenue').value('$12.5K'),
])
```

### Table

Standalone table (not tied to a Resource):

```ts
Table.make('Recent Articles')
  .fromModel(Article)
  .columns([
    Column.make('title').sortable().searchable(),
    Column.make('createdAt').date(),
  ])
  .sortBy('createdAt', 'DESC')
  .paginated('pages', 10)
  .searchable()
  .remember('session')
  .live()
```

### Form

Standalone form (not tied to a Resource):

```ts
Form.make('contact')
  .fields([
    TextField.make('name').required(),
    EmailField.make('email').required(),
    TextareaField.make('message'),
  ])
  .onSubmit(async (data) => {
    await sendEmail(data)
  })
  .successMessage('Thanks! We'll be in touch.')
```

### Section

Collapsible card wrapper for field grouping:

```ts
Section.make('SEO Settings')
  .description('Search engine optimization.')
  .collapsible()
  .collapsed()
  .columns(2)
  .schema(
    TextField.make('metaTitle'),
    TextareaField.make('metaDescription'),
  )
```

### Tabs

Tab groups with persist:

```ts
Tabs.make('settings-tabs')
  .persist('session')
  .tab('General', TextField.make('name'), EmailField.make('email'))
  .tab('Security', PasswordField.make('password'))
```

### Chart

```ts
Chart.make('Revenue')
  .chartType('bar')
  .labels(['Jan', 'Feb', 'Mar'])
  .datasets([{ label: 'Sales', data: [100, 200, 150] }])
```

### Dashboard & Widgets

Customizable widget grid with drag-and-drop, per-user layout, and polling:

```ts
Dashboard.make('overview')
  .label('Overview')
  .widgets([
    Widget.make('total-users')
      .label('Total Users')
      .small()
      .icon('users')
      .schema(async () => [
        Stats.make([Stat.make('Users').value(await User.query().count())]),
      ]),

    Widget.make('revenue-chart')
      .label('Revenue')
      .defaultSize({ w: 8, h: 3 })
      .schema(() => [
        Chart.make('Revenue')
          .chartType('bar')
          .labels(['Jan', 'Feb', 'Mar'])
          .datasets([{ label: 'Sales', data: [100, 200, 150] }]),
      ]),
  ])
```

Widget sizing: `.small()` (3 cols), `.medium()` (6), `.large()` (12), or `.defaultSize({ w, h })`.

Widgets support `.lazy()` (client-side fetch), `.poll(ms)` (auto-refresh), `.settings([...])` (user-configurable), and `.render(path)` (custom React component).

---

## Data-Driven Elements

### Each

Iterate over a collection and render schema per item:

```ts
// From static array
Each.make()
  .fromArray([
    { title: 'Users', count: 150 },
    { title: 'Articles', count: 42 },
  ])
  .columns(3)
  .content((item) => [
    Card.make(item.title).schema([
      Stats.make([Stat.make(item.title).value(item.count)]),
    ])
  ])

// From model
Each.make()
  .fromModel(Category)
  .columns(4)
  .content((record) => [
    Card.make(record.name).schema([
      Stats.make([Stat.make('Articles').value(record._count?.articles ?? 0)]),
    ])
  ])
```

### View

Render schema from a single data object:

```ts
View.make()
  .data(async (ctx) => {
    const user = await User.find(ctx.params.id)
    return user
  })
  .content((user) => [
    Heading.make(user.name),
    Stats.make([
      Stat.make('Posts').value(user.postsCount),
      Stat.make('Joined').value(user.createdAt),
    ]),
  ])
```

---

## Globals

Single-record settings pages:

```ts
import { Global, Form, TextField, ToggleField, Section } from '@rudderjs/panels'

export class SiteSettingsGlobal extends Global {
  static slug  = 'site-settings'
  static label = 'Site Settings'
  static icon  = 'settings'

  form(form: Form) {
    return form.fields([
      Section.make('General').schema(
        TextField.make('siteName').required(),
        TextField.make('tagline'),
      ),
      Section.make('Maintenance').schema(
        ToggleField.make('maintenanceMode').label('Maintenance Mode'),
      ),
    ])
  }
}
```

---

## Pages

Custom pages with schema elements:

```ts
import { Page, Heading, Text, Table, Column, Example, Alert, Each, Card, Stats, Stat } from '@rudderjs/panels'

export class DashboardPage extends Page {
  static slug  = 'dashboard'
  static label = 'Dashboard'
  static icon  = 'layout-dashboard'

  static async schema(ctx) {
    return [
      Heading.make('Dashboard'),
      Alert.make('Welcome back!').success(),

      Each.make()
        .fromArray([
          { title: 'Users', count: 150 },
          { title: 'Articles', count: 42 },
          { title: 'Views', count: 12500 },
        ])
        .columns(3)
        .content((item) => [
          Card.make(item.title).schema([
            Stats.make([Stat.make(item.title).value(item.count)]),
          ])
        ]),

      Table.make('Recent Articles')
        .fromModel(Article)
        .columns([Column.make('title'), Column.make('createdAt').date()])
        .limit(5),
    ]
  }
}
```

---

## Features

### Collaborative Editing (Yjs)

Fields with `.collaborative()` or `.persist('websocket')` get real-time sync across tabs/users:

```ts
TextField.make('title').collaborative()
RichContentField.make('body').collaborative()
```

Each field gets its own Y.Doc — no conflicts between fields.

### Version History

```ts
form(form: Form) {
  return form.versioned().fields([...])
}
```

Enables version snapshots on save with restore/preview.

### Draft/Publish Workflow

```ts
form(form: Form) {
  return form.draftable().fields([...])
}
```

Adds Save Draft / Publish / Unpublish actions.

### Autosave

```ts
form(form: Form) {
  return form.autosave(10000).fields([...])  // save every 10s when dirty
}
```

### Inline Table Editing

```ts
Column.make('featured').boolean().editable(ToggleField.make('featured'))
Column.make('status').editable(SelectField.make('status').options([...]))
Column.make('title').editable()  // auto-detects field type
```

### Live Tables (WebSocket)

```ts
table(table: Table) {
  return table.live().columns([...])
}
```

Table auto-refreshes when records change.

### Table Persist

```ts
table.remember('session')      // server session (SSR-restored)
table.remember('url')          // URL params (shareable)
table.remember('localStorage') // browser storage
```

### Tabs with Independent State

```ts
table.tabs([
  Tab.make('All'),
  Tab.make('Published').scope((q) => q.where('status', 'published')),
  Tab.make('Drafts').scope((q) => q.where('status', 'draft')),
])
```

Each tab gets its own table with independent pagination, sort, search, and filters.

### Soft Deletes

```ts
table.softDeletes()
```

Adds trash toggle, restore, and force-delete.

---

## AI Agents

Define AI agents on resources — they read record data, update fields in real-time, and stream progress to a global chat panel.

```ts
import { Resource, ResourceAgent, TextField, TextareaField, Form } from '@rudderjs/panels'

export class ArticleResource extends Resource {
  static model = Article

  form(form: Form) {
    return form.fields([
      TextField.make('title').required(),
      TextareaField.make('excerpt'),
      TextField.make('metaTitle'),
      TextareaField.make('metaDescription'),
    ])
  }

  agents() {
    return [
      ResourceAgent.make('seo')
        .label('Improve SEO')
        .icon('Search')
        .instructions('Analyse and improve the meta title and description for better SEO.')
        .fields(['metaTitle', 'metaDescription']),

      ResourceAgent.make('summarize')
        .label('Write Excerpt')
        .icon('Sparkles')
        .instructions('Write a concise excerpt based on the article title and content.')
        .fields(['excerpt']),
    ]
  }
}
```

Agents appear in the form's action bar as an "AI Agents" dropdown. When triggered, output streams into the AI chat sidebar.

### AI Chat Sidebar

A collapsible right sidebar (toggled from the header) provides a unified chat experience:

- **Free-form chat** — ask questions about your data, get AI assistance
- **Agent runs inline** — when you trigger an agent (from dropdown or by asking in chat), tool calls, text, and completion appear as structured message parts in the conversation
- **Resource-aware** — on resource edit pages, the AI knows the current record and available agents. Ask "write me an excerpt" and the AI will invoke the Write Excerpt agent automatically
- **Field animation** — agent `update_field` tool calls animate into the form in real-time via Yjs
- **Conversation persistence** — conversations are stored in the database (Prisma), auto-titled, and restorable across sessions via a conversation switcher dropdown
- **Model selection** — users choose which AI model to use from a dropdown in the chat input area. Models are configured in `config/ai.ts`

The chat endpoint (`POST /{panel}/api/_chat`) supports:
- `message` — user's text
- `conversationId` — for persistent conversation history
- `model` — user-selected AI model
- `resourceContext` — current resource slug + record ID
- `selection` — selected text context (field name + text)
- `forceAgent` — bypass AI intent detection, run a specific agent directly

### Selected Text Context

Select text in any collaborative field (title, textarea, or rich content) and click the **✦** button that appears. This opens the AI chat with the selection pre-filled — the AI knows exactly which field and text to edit.

```
1. Select text in editor → ✦ button appears
2. Click ✦ → chat opens with selection context
3. Type "make this shorter" → AI edits that exact text in that exact field
```

The selection context locks the AI to the correct field — it cannot accidentally edit a different field. After editing, the AI confirms what it changed.

### AI Quick Actions (`.ai()`)

Add predefined AI actions to any field with `.ai()`:

```ts
TextField.make('title')
  .ai(['rewrite', 'shorten', 'expand', 'fix-grammar'])

RichContentField.make('content')
  .ai(['rewrite', 'expand', 'shorten', 'fix-grammar', 'translate', 'simplify'])

TextareaField.make('excerpt')
  .ai()  // default actions: rewrite, expand, shorten, fix-grammar
```

A **✦** sparkle button appears next to the field label. Click it to see a dropdown of actions — each sends a one-click prompt to the AI chat that edits the field directly.

**Available built-in actions:**

| Action | Prompt |
|---|---|
| `rewrite` | Rewrite while keeping the same meaning |
| `expand` | Expand with more detail |
| `shorten` | Shorten while keeping key points |
| `fix-grammar` | Fix grammar and spelling |
| `translate` | Translate to English |
| `summarize` | Summarize concisely |
| `make-formal` | Rewrite in a more formal tone |
| `simplify` | Simplify for easier understanding |

### Class-Based Agents

For complex agents with custom tools:

```ts
import { ResourceAgent } from '@rudderjs/panels'
import { toolDefinition } from '@rudderjs/ai'
import { z } from 'zod'

class TranslateAgent extends ResourceAgent {
  constructor() {
    super('translate')
    this.label('Translate').icon('Languages')
    this.fields(['title', 'content', 'metaDescription'])
  }

  resolveInstructions() {
    return 'Translate all fields. Preserve formatting.'
  }

  extraTools() {
    return [
      toolDefinition({
        name: 'lookup_term',
        description: 'Look up domain-specific term translation',
        inputSchema: z.object({ term: z.string(), lang: z.string() }),
      }).server(async ({ term, lang }) => `"${term}" → ...`),
    ]
  }
}
```

Requires `@rudderjs/ai` as a peer dependency.

---

## Theming

Configure your panel's visual theme — colors, fonts, radius, and more. Theme CSS variables are injected at runtime, overriding the app's defaults. Supports light and dark mode.

```ts
Panel.make('admin')
  .theme({
    preset: 'nova',              // 'default' | 'nova' | 'maia' | 'lyra'
    baseColor: 'zinc',           // 'neutral' | 'stone' | 'zinc' | 'slate' | 'olive' | 'taupe'
    accentColor: 'blue',         // 16 accent colors (blue, red, green, amber, violet, etc.)
    chartPalette: 'ocean',       // 'default' | 'ocean' | 'sunset' | 'forest' | 'berry'
    radius: 'medium',            // 'none' | 'small' | 'default' | 'medium' | 'large'
    fonts: {
      heading: 'Space Grotesk',  // Google Fonts name
      body: 'Inter',
    },
    iconLibrary: 'lucide',       // 'lucide' | 'tabler' | 'phosphor' | 'remix'
  })
  .themeEditor()                 // enable the visual theme editor page
```

### Theme Layering

Themes are resolved by merging layers (each overrides the previous):

1. **Preset** — full set of CSS variables (all 31 light + dark values)
2. **Base color** — overrides the gray/neutral scale
3. **Accent color** — overrides primary, ring, sidebar-primary
4. **Chart palette** — overrides chart-1 through chart-5
5. **CSS variables** — escape hatch for raw OKLCH overrides

```ts
.theme({
  preset: 'nova',
  accentColor: 'violet',
  cssVariables: {
    light: { '--destructive': 'oklch(0.6 0.25 30)' },
    dark:  { '--destructive': 'oklch(0.7 0.2 25)' },
  },
})
```

### Theme Editor

Enable `.themeEditor()` to add a visual theme settings page at `/{panel}/theme`. Features:

- **Live iframe preview** — changes apply instantly in an isolated preview
- **Dark/light preview** — syncs with the panel's dark mode toggle
- **Save to database** — persists theme overrides to the `panelGlobal` table
- **Shuffle** — randomize all theme settings
- **Reset** — clear saved overrides, return to code defaults

Saved overrides merge with code defaults at runtime — code defines the base, admins customize via the UI.

### Fonts

Fonts are loaded from Google Fonts via `<link>` tags. The theme system overrides `--default-font-family` (Tailwind v4's runtime variable) and auto-applies heading fonts to `h1`-`h6`.

### Icon Library

The panel's icon system supports multiple icon libraries via an adapter pattern:

- **lucide** (default) — included, no extra install needed
- **tabler** — `pnpm add @tabler/icons-react`
- **phosphor** — `pnpm add @phosphor-icons/react`
- **remix** — `pnpm add @remixicon/react`

Internal panel icons (sidebar, buttons) use a canonical name mapping. Resource icons resolve through the active adapter with PascalCase fallback.

### Dark Mode

Built-in light/dark/system theme toggle. Persists to `localStorage`.

---

## Architecture

Resource is a thin wrapper that auto-generates schema elements:

| Component | Generates | Renders via |
|---|---|---|
| Resource list | DataView (Table extends List) | `resolveDataView()` → `SchemaDataView` |
| Resource create | Form | `resolveForm()` → `SchemaForm` |
| Resource edit | Form | `resolveForm()` → `SchemaForm` (+ autosave/versioning) |
| Resource show | detail() elements | `SchemaElementRenderer` |
| Global | Form | `resolveForm()` → `SchemaForm` |
| Page | schema elements | `resolveSchema()` → `SchemaElementRenderer` |

One rendering path for everything. Table, List, and DataView all resolve through `resolveDataView()` → `SchemaDataView`. Features added to List (scopes, views, search, filters, reorder, export, live) work in both standalone pages and resource tables.
