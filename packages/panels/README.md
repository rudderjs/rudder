# @boostkit/panels

Admin panel builder for BoostKit. Define resources and pages in TypeScript — the package auto-generates CRUD API routes and a polished React UI.

```bash
pnpm add @boostkit/panels
```

---

## Quick Start

```ts
// app/Panels/Admin/AdminPanel.ts
import { Panel } from '@boostkit/panels'
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
import { media } from '@boostkit/media/server'
import { panelsLexical } from '@boostkit/panels-lexical/server'

export const adminPanel = Panel.make('admin')
  .path('/admin')
  .use(panelsLexical())
  .use(media({ conversions: [{ name: 'thumb', width: 200, format: 'webp' }] }))
  .resources([UserResource])
```

```ts
// bootstrap/providers.ts
import { panels } from '@boostkit/panels'
import { adminPanel } from '../app/Panels/Admin/AdminPanel.js'

export default [
  panels([adminPanel]),
]
```

Publish the React UI pages:

```bash
pnpm artisan vendor:publish --tag=panels-pages
pnpm artisan vendor:publish --tag=panels-pages --force  # after upgrading
```

---

## Defining Resources

Resources use `table()`, `form()`, and `detail()` to configure CRUD. Each method receives a pre-configured schema element and returns it with your configuration.

```ts
import {
  Resource, Table, Form, Column, Tab,
  TextField, TextareaField, SelectField, DateField, SelectFilter, Action,
  Stats, Stat,
} from '@boostkit/panels'
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
  .tab('npm', 'npx create-boostkit-app', 'bash')
  .tab('pnpm', 'pnpm create boostkit-app', 'bash')
  .tab('yarn', 'yarn create boostkit-app', 'bash')
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
import { Global, Form, TextField, ToggleField, Section } from '@boostkit/panels'

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
import { Page, Heading, Text, Table, Column, Example, Alert, Each, Card, Stats, Stat } from '@boostkit/panels'

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

## Dark Mode

Built-in light/dark/system theme toggle. Persists to `localStorage`.

Customize via CSS variables:

```css
:root { --primary: oklch(0.5 0.2 250); }
.dark { --primary: oklch(0.7 0.15 250); }
```

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
