# @boostkit/panels

Admin panel builder for BoostKit. Define resources in TypeScript — the package auto-generates CRUD API routes and a polished React UI.

```bash
pnpm add @boostkit/panels
```

---

## Quick Start

```ts
// app/Panels/Admin/AdminPanel.ts
import { Panel } from '@boostkit/panels'
import { UserResource } from './resources/UserResource.js'
import { TodoResource } from './resources/TodoResource.js'

export const adminPanel = Panel.make('admin')
  .path('/admin')
  .branding({ title: 'My Admin' })
  .layout('sidebar')           // 'sidebar' (default) | 'topbar'
  .guard(async (ctx) => ctx.user?.role === 'admin')
  .resources([UserResource, TodoResource])
```

```ts
// bootstrap/providers.ts
import { panels } from '@boostkit/panels'
import { adminPanel } from '../app/Panels/Admin/AdminPanel.js'

export default [
  panels([adminPanel]),
  // ...
]
```

Publish the React UI pages:

```bash
# First install — copies pages into pages/(panels)/
pnpm artisan vendor:publish --tag=panels-pages

# After upgrading @boostkit/panels — overwrite with latest UI
pnpm artisan vendor:publish --tag=panels-pages --force
```

The panel UI uses [shadcn/ui](https://ui.shadcn.com) components. Install them after publishing:

```bash
npx shadcn@latest add sidebar dropdown-menu alert-dialog table breadcrumb tooltip tabs badge separator avatar sheet switch dialog
```

---

## Dark Mode

A light/dark/system theme toggle is built in. Theme persists to `localStorage` (`panels-theme` key). An inline script prevents flash on page load.

Customize colors via CSS variables in `src/index.css`:

```css
:root { --primary: oklch(0.5 0.2 250); }
.dark { --primary: oklch(0.7 0.15 250); }
```

---

## Defining Resources

```ts
import { Resource, TextField, EmailField, SelectField, DateField, SelectFilter, Action } from '@boostkit/panels'
import { User } from '../../Models/User.js'

export class UserResource extends Resource {
  static model = User
  static label = 'Users'
  static labelSingular = 'User'
  static titleField = 'name'   // used as show page heading, breadcrumbs, and relation displays
  static perPage = 25               // records per page (default: 15)
  static perPageOptions = [25, 50, 100]    // per-page dropdown choices (default: [10, 15, 25, 50, 100])
  static paginationType = 'pagination'     // 'pagination' | 'loadMore'
  static persistTableState = true          // persist filters, sort, search, page & selection

  fields() {
    return [
      TextField.make('name').required().searchable().sortable(),
      EmailField.make('email').required().searchable().sortable(),
      SelectField.make('role').options(['user', 'admin']).required(),
      DateField.make('createdAt').readonly().hideFromCreate().hideFromEdit(),
    ]
  }

  filters() {
    return [
      SelectFilter.make('role').options([
        { label: 'User',  value: 'user' },
        { label: 'Admin', value: 'admin' },
      ]),
    ]
  }

  actions() {
    return [
      Action.make('suspend')
        .label('Suspend')
        .destructive()
        .confirm('Suspend selected users?')
        .bulk()
        .handler(async (records) => {
          // ...
        }),
    ]
  }
}
```

---

## Field Types

| Class | Description |
|---|---|
| `TextField` | `<input type="text">` |
| `EmailField` | `<input type="email">` |
| `PasswordField` | `<input type="password">` |
| `NumberField` | `<input type="number">` |
| `TextareaField` | `<textarea>` |
| `SelectField` | Dropdown (single or multi) |
| `BooleanField` | Checkbox |
| `ToggleField` | Toggle switch |
| `DateField` | Date / datetime picker |
| `SlugField` | Slug input with auto-generation from a source field |
| `TagsField` | Multi-value tag input |
| `ColorField` | Color picker |
| `HiddenField` | Hidden form value |
| `JsonField` | JSON code editor |
| `FileField` | File upload |
| `RelationField` | BelongsTo / belongsToMany relation select |
| `HasMany` | Reverse relation table on the show page |
| `RepeaterField` | Repeating group of fields |
| `BuilderField` | Block-based content builder |

All field types share a fluent base API:

```ts
TextField.make('name')
  .label('Full Name')   // display label (defaults to title-cased name)
  .required()           // required in create/edit forms
  .readonly()           // show in form, not editable; excluded from payloads
  .sortable()           // allow sorting by this column in the table
  .searchable()         // include in global search (LIKE query)
  .collaborative()      // shorthand for .persist('websocket') — real-time Yjs sync
  .persist()            // survive page reload (localStorage, indexeddb, or websocket)
  .hideFrom('table' | 'create' | 'edit' | 'view')
  .hideFromTable()
  .hideFromCreate()
  .hideFromEdit()
```

---

## Layout Grouping

Group fields into visual sections or tabs using `Section` and `Tabs`. Both can be mixed freely with plain fields in `fields()`.

### Section

A titled card — optionally collapsible and multi-column:

```ts
import { Section, TextField, TextareaField, FileField } from '@boostkit/panels'

fields() {
  return [
    Section.make('Content')
      .schema(
        TextField.make('title').required(),
        TextareaField.make('excerpt').rows(3),
        FileField.make('coverImage').image().disk('public').directory('articles'),
      ),

    Section.make('SEO')
      .description('Search engine optimization settings')
      .collapsible()
      .collapsed()           // starts collapsed
      .schema(
        TextField.make('metaTitle'),
        TextareaField.make('metaDescription').rows(2),
      ),

    Section.make('Publishing')
      .columns(2)            // 1 (default) | 2 | 3
      .schema(
        SelectField.make('status').options(['draft', 'published']),
        DateField.make('publishedAt').withTime(),
      ),
  ]
}
```

| Method | Description |
|--------|-------------|
| `Section.make(title)` | Create a section with the given title |
| `.description(text)` | Subtitle shown below the title |
| `.collapsible()` | Allow expanding / collapsing |
| `.collapsed()` | Start collapsed (implies collapsible) |
| `.columns(n)` | Field grid: `1` (default), `2`, or `3` columns |
| `.schema(...fields)` | Fields in this section |

### Tabs

Divide fields into tabs within a single card:

```ts
import { Tabs, TextField, TextareaField } from '@boostkit/panels'

fields() {
  return [
    Tabs.make()
      .tab('General',
        TextField.make('name').required(),
        TextareaField.make('bio'),
      )
      .tab('Preferences',
        SelectField.make('theme').options(['light', 'dark']),
        BooleanField.make('newsletter'),
      ),
  ]
}
```

| Method | Description |
|--------|-------------|
| `Tabs.make()` | Create a tabs group |
| `.tab(label, ...fields)` | Add a tab with the given label and fields |

---

## File Uploads

Use `FileField` to upload files directly from the admin form. Files are uploaded to the panel's `/_upload` endpoint (auto-mounted) and stored via `@boostkit/storage`.

```ts
import { FileField } from '@boostkit/panels'

FileField.make('coverImage')
  .label('Cover Image')
  .image()               // shows thumbnail preview; sets type to 'image'
  .accept('image/*')     // MIME type filter
  .maxSize(5)            // max file size in MB (default: 10)
  .disk('public')        // storage disk (default: 'local')
  .directory('articles') // storage subdirectory (default: 'uploads')
```

**For public-facing files** (images, PDFs shown in the browser), use the `public` disk and set up the symlink once:

```bash
pnpm artisan storage:link
```

This links `public/storage → storage/app/public`. Vite serves it as static assets — no API route needed. See [`@boostkit/storage`](../storage) for full configuration.

---

## Relations

Use `RelationField` to render belongs-to and belongs-to-many dropdowns in create/edit forms.

```ts
import { RelationField } from '@boostkit/panels'

// BelongsTo — FK lives on this model (e.g. parentId → parent)
RelationField.make('parentId')
  .label('Parent Category')
  .resource('categories')   // slug of the related resource
  .display('name')          // field to show as label (default: 'name')
  .as('parent')             // override Prisma relation name (default: strip 'Id' suffix)

// BelongsToMany — Prisma implicit M2M join table
RelationField.make('categories')
  .label('Categories')
  .resource('categories')
  .display('name')
  .multiple()               // enables M2M multi-select
  .creatable()              // allow creating new related records inline
  .hideFromTable()
```

**`.creatable()`** — when set on a `belongsToMany` field, the multi-select dropdown shows a "Create X" option when the typed value has no exact match. Selecting it opens a dialog that renders the related resource's full create form. The new record is created via POST and automatically added to the selection.

**UI for `belongsTo`**: native `<select>` with options fetched from the related resource.

**UI for `belongsToMany`**: searchable chip multi-select. Keyboard: `↑↓` navigate, `Enter` select, `Escape` close, `Backspace` removes last chip.

**Options are fetched from** `GET /{panel}/api/{resource}/_options?label={displayField}`.

**`static titleField`** on Resource sets which field is used as the record's display title in show page headers, breadcrumbs, and relation displays:

```ts
export class CategoryResource extends Resource {
  static titleField = 'name'   // used as show page heading and in relation links
  // ...
}
```

---

## Reverse Relations (HasMany)

Use `HasMany` to render a paginated relation table below the record on the show page.

```ts
import { HasMany } from '@boostkit/panels'

// FK-based hasMany (e.g. sub-categories where parentId = current id)
HasMany.make('children')
  .label('Sub-categories')
  .resource('categories')   // related resource slug
  .foreignKey('parentId')   // FK column on the related model

// M2M reverse (e.g. articles linked via implicit join table)
HasMany.make('articles')
  .label('Articles')
  .resource('articles')
  .foreignKey('categories') // relation name on the related model
  .throughMany()            // use Prisma { some: { id } } filter instead of FK equality
```

`HasMany` fields are automatically hidden from the table, create, and edit views — they only render on the **show page** as a paginated table below the record details.

The table includes a **"+ New"** button that links to the related resource's create page with the FK pre-filled via `?prefill[{foreignKey}]={currentId}`.

---

## Create Page Prefill

The create page reads `prefill[field]=value` query params and uses them as initial field values:

```
/admin/categories/create?prefill[parentId]=abc123
```

This pre-selects `parentId` in the create form. Useful for the "create related" flow from a HasMany table.

---

## Panel Schema (Landing Page)

By default, visiting the panel root (e.g. `/admin`) redirects to the first resource. Use `.schema()` to define a custom landing page with stats, headings, text, data tables, charts, lists, standalone widgets, and user-customizable dashboards.

```ts
import { Panel, Heading, Text, Stats, Stat, Table, Chart, List } from '@boostkit/panels'
import { Dashboard, Widget } from '@boostkit/dashboards'

export const adminPanel = Panel.make('admin')
  .path('/admin')
  .resources([UserResource, ArticleResource])
  .schema(async (ctx) => [
    Heading.make('Welcome back'),
    Text.make(`Logged in as ${ctx.user?.email ?? 'guest'}`),

    Stats.make([
      Stat.make('Users').value(await User.query().count()),
      Stat.make('Articles').value(await Article.query().count()),
      Stat.make('Published').value(await Article.query().where('status', 'published').count()),
    ]),

    // Standalone widgets — static, no drag/customize
    Widget.make('total-articles')
      .label('Published Articles')
      .component('stat')
      .defaultSize({ w: 4, h: 2 })
      .icon('newspaper')
      .data(async () => ({ value: await Article.query().count(), trend: 5 })),

    // User-customizable dashboard
    Dashboard.make('overview')
      .label('Overview')
      .widgets([...])
      .tabs([
        Dashboard.tab('content').label('Content').widgets([...]),
        Dashboard.tab('charts').label('Charts').widgets([...]),
      ]),

    Chart.make('Monthly Revenue')
      .chartType('bar')
      .labels(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'])
      .datasets([
        { label: 'Revenue', data: [4200, 5800, 4900, 7100, 6300, 8200] },
        { label: 'Expenses', data: [3100, 3800, 3200, 4500, 4100, 5000], color: '#ef4444' },
      ])
      .height(350),

    Table.make('Recent Articles')
      .resource('articles')
      .columns(['title', 'status', 'publishedAt'])
      .sortBy('createdAt', 'DESC')
      .limit(5),

    List.make('Quick Links')
      .items([
        { label: 'Documentation', href: '/docs', icon: '📖' },
        { label: 'Settings', href: '/admin/site-settings', icon: '⚙️' },
      ]),
  ])
```

The schema function receives `PanelContext` (`{ user, headers, path }`) and can be async -- safe to run ORM queries.

**Static schema** (no context needed):

```ts
.schema([
  Heading.make('Admin Panel'),
  Text.make('Manage your application from the sidebar.'),
])
```

### Schema Elements

| Class | Description |
|---|---|
| `Heading.make(text)` | Section heading. `.level(1\|2\|3)` controls size (default: `1`) |
| `Text.make(content)` | Paragraph of text |
| `Stats.make([...stats])` | Row of stat cards |
| `Stat.make(label)` | Single stat -- `.value(n)`, `.description(text)`, `.trend(n)` (positive=↑, negative=↓) |
| `Table.make(title)` | Data table -- `.resource(slug)`, `.columns([...])`, `.limit(n)`, `.sortBy(col, dir)` |
| `Chart.make(title)` | Chart -- `.chartType('line'\|'bar'\|'area'\|'pie'\|'doughnut')`, `.labels([...])`, `.datasets([...])`, `.height(n)` |
| `List.make(title)` | Item list card -- `.items([{ label, description?, href?, icon? }])`, `.limit(n)` |
| `Tabs.make()` | Tabbed sections -- `.tab(label, ...elements)` groups schema elements into tabs |
| `Widget.make(id)` | Dashboard widget (from `@boostkit/dashboards`) -- standalone or inside `Dashboard.make()` |
| `Dashboard.make(id)` | User-customizable dashboard grid (from `@boostkit/dashboards`) -- drag-and-drop, per-user layout |

### `Chart`

Render line, bar, area, pie, or doughnut charts. Uses `recharts` (optional peer dependency).

```ts
import { Chart } from '@boostkit/panels'

Chart.make('Revenue')
  .chartType('line')          // 'line' | 'bar' | 'area' | 'pie' | 'doughnut'
  .labels(['Jan', 'Feb', 'Mar', 'Apr'])
  .datasets([
    { label: 'Revenue', data: [100, 200, 150, 300] },
    { label: 'Expenses', data: [80, 120, 100, 180], color: '#ef4444' },
  ])
  .height(350)                // default: 300
```

Chart types:

| Type | Description |
|------|-------------|
| `line` | Line chart (default) |
| `bar` | Vertical bar chart |
| `area` | Filled area chart |
| `pie` | Pie chart |
| `doughnut` | Doughnut (pie with inner radius) |

**Requirement**: Install `recharts` -- `pnpm add recharts`

### `List`

Render a card with a list of items. Each item has a label, optional description, href, and icon.

```ts
import { List } from '@boostkit/panels'

List.make('Quick Links')
  .items([
    { label: 'Documentation', description: 'Read the docs', href: '/docs', icon: '📖' },
    { label: 'GitHub', description: 'View source code', href: 'https://github.com/...', icon: '🐙' },
    { label: 'Support', description: 'Get help', icon: '💬' },
  ])
  .limit(5)                   // default: 5, truncates items
```

---

## Navigation Groups

Group resources in the sidebar by assigning a `navigationGroup`. Resources with the same group are grouped under a collapsible heading. Ungrouped resources appear at the top level.

```ts
export class ArticleResource extends Resource {
  static navigationGroup = 'Content'
}

export class CategoryResource extends Resource {
  static navigationGroup = 'Content'
}

export class UserResource extends Resource {
  static navigationGroup = 'Settings'
}
```

Groups appear in the order they are first encountered in the resource list.

---

## Navigation Badges

Show dynamic counts or labels next to resource links in the sidebar.

```ts
export class ArticleResource extends Resource {
  static navigationBadge = async () => await Article.query().count()
  static navigationBadgeColor = 'primary' // 'gray' | 'primary' | 'success' | 'warning' | 'danger'
}
```

| Property | Description |
|----------|-------------|
| `static navigationBadge` | Async function returning a number or string to display |
| `static navigationBadgeColor` | Badge color variant (default: `'gray'`) |

Badges are resolved server-side on each page load.

---

## Empty State Customization

Customize the message shown when a resource table has no records.

```ts
export class ArticleResource extends Resource {
  static emptyStateIcon = 'file-text'            // lucide icon name (defaults to resource icon)
  static emptyStateHeading = 'No :label yet'     // :label placeholder replaced with resource label
  static emptyStateDescription = 'Write your first article.'
}
```

| Property | Default |
|----------|---------|
| `static emptyStateIcon` | Resource icon |
| `static emptyStateHeading` | `'No :label yet'` |
| `static emptyStateDescription` | `'Create your first :labelSingular to get started.'` |

The `:label` and `:labelSingular` placeholders are replaced with the resource's `label` and `labelSingular` values.

---

## Tab Filters

Define filtered views as tabs above the table. Users click a tab to apply a preset query filter.

```ts
import { Tab } from '@boostkit/panels'

export class ArticleResource extends Resource {
  tabs() {
    return [
      Tab.make('all').label('All'),
      Tab.make('published').label('Published').icon('circle-check')
        .query((q) => q.where('draftStatus', 'published')),
      Tab.make('draft').label('Drafts').icon('pencil-line')
        .query((q) => q.where('draftStatus', 'draft')),
    ]
  }
}
```

| Method | Description |
|--------|-------------|
| `Tab.make(key)` | Create a tab with a unique key |
| `.label(text)` | Display label |
| `.icon(name)` | Lucide icon name shown before the label |
| `.query(fn)` | Query callback — receives the ORM query builder |

The first tab without a `.query()` callback (e.g. `'all'`) shows unfiltered records. The active tab persists in `sessionStorage` and restores when navigating back via the sidebar.

---

## Live Debounced Search

The per-resource search input filters results as you type with a 150 ms debounce. No search button is needed — results update automatically. Mark fields as `.searchable()` to include them in the search query.

---

## Schema Publishing

Panels ships its own database models (`PanelVersion`, `PanelGlobal`) used by the versioning and globals features. Publish the Prisma schema shard into your project:

```bash
pnpm artisan vendor:publish --tag=panels-schema
```

After publishing, merge it into your main schema and regenerate the Prisma client:

```bash
pnpm artisan module:publish   # merges *.prisma shards into prisma/schema.prisma
pnpm exec prisma generate
pnpm exec prisma db push      # or prisma migrate dev
```

---

## Editor Registry

Panels uses a pluggable editor system via `editorRegistry`. By default, text fields use plain inputs. Install `@boostkit/panels-lexical` for rich text editing:

```bash
pnpm add @boostkit/panels-lexical
```

The Lexical package auto-registers its editors on import. It provides rich text editing for `RichContentField` and collaborative plain-text editing for text-based fields with `.collaborative()`.

See [`@boostkit/panels-lexical`](../panels-lexical) for configuration and customization.

---

## Layout Options

```ts
Panel.make('admin').layout('sidebar')   // vertical sidebar (default)
Panel.make('admin').layout('topbar')    // horizontal top navigation
```

---

## Internationalization (i18n) and RTL

The panel UI is fully internationalized. By default the locale is inherited from `@boostkit/localization` (read from `globalThis`). Override it per panel with `.locale()`:

```ts
Panel.make('admin')
  .path('/admin')
  .locale('ar')   // Arabic + RTL layout
```

Built-in translations: **`en`** (English) and **`ar`** (Arabic).

When a locale is set, the panel automatically:
- Applies the correct UI strings (buttons, labels, toasts, empty states)
- Sets `dir="rtl"` on the layout root for RTL languages
- Uses CSS logical properties so padding, borders, and alignment flip correctly

**RTL languages detected automatically**: `ar`, `he`, `fa`, `ur`, `ps`, `sd`, `ug`

If `.locale()` is not called, the panel reads the active locale from `@boostkit/localization`. This means all panels in a multilingual app will use the right locale without any extra config.

---

## Custom Pages

Register custom pages alongside resources. They appear in the sidebar/topbar nav and link to any URL you define.

```ts
// app/Panels/Admin/pages/DashboardPage.ts
import { Page } from '@boostkit/panels'

export class DashboardPage extends Page {
  static slug  = 'dashboard'
  static label = 'Dashboard'
  static icon  = '📊'
}
```

```ts
// app/Panels/Admin/AdminPanel.ts
export const adminPanel = Panel.make('admin')
  .resources([UserResource, TodoResource])
  .pages([DashboardPage, SettingsPage])
```

Resources appear first in the nav, then pages — in the order listed.

The page class controls only nav metadata (slug, label, icon). The actual UI is a standard Vike page at `pages/(panels)/@panel/dashboard/+Page.tsx` — create it after publishing the panels pages.

The panel layout (`AdminLayout`) is applied automatically by the shared `+Layout.tsx` — your page just returns its content:

```tsx
// pages/(panels)/admin/dashboard/+Page.tsx
export default function DashboardPage() {
  return (
    <>
      <h1>Dashboard</h1>
      {/* your content */}
    </>
  )
}
```

---

## Custom Resource Views

To replace the default table for a specific resource, create a Vike page at the resource's static path. Vike's route priority makes static segments win over dynamic ones — your page is served instead of the built-in table.

```
pages/(panels)/@panel/users/+Page.tsx    ← custom index for 'users'
pages/(panels)/@panel/users/+data.ts
```

The panel layout (`AdminLayout`) is applied automatically — your page just returns its content.

Use `resourceData()` in `+data.ts` to fetch the same data the default table uses:

```ts
// pages/(panels)/@panel/users/+data.ts
import { resourceData } from '@boostkit/panels'
import type { PageContextServer } from 'vike/types'

export type Data = Awaited<ReturnType<typeof resourceData>>

export async function data(pageContext: PageContextServer) {
  const { panel, resource } = pageContext.routeParams as { panel: string; resource: string }
  return resourceData({
    panel,                         // panel path segment, e.g. 'admin'
    resource,                      // resource slug, e.g. 'users'
    url: pageContext.urlOriginal,  // full URL — used to parse sort/search/filter/page
  })
}
```

**`ResourceDataResult`** fields: `panelMeta`, `resourceMeta`, `records`, `pagination`, `pathSegment`, `slug`.

The URL query params `resourceData()` honours: `?page`, `?perPage`, `?sort`, `?dir`, `?search`, `?filter[field]` — identical to the default table. See the [full reference](https://boostkitjs.dev/guide/panels#resourcedata) in the docs.

---

## Custom Field Types

Use `.component(key)` on any field to hand off form rendering to a custom React component.

```ts
// In your Resource
NumberField.make('priority').label('Priority').component('rating')
```

Register the component in `pages/(panels)/_components/CustomFieldRenderers.tsx` (a published file — edit it directly):

```tsx
import type { FieldMeta } from '@boostkit/panels'
import { RatingInput } from './fields/RatingInput.js'

export interface FieldInputProps {
  field:    FieldMeta
  value:    unknown
  onChange: (value: unknown) => void
}

export const customFieldRenderers: Record<string, React.ComponentType<FieldInputProps>> = {
  rating: RatingInput,
}
```

> **Note:** `CustomFieldRenderers.tsx` is a published file you own. Re-publishing with `--force` will overwrite it — back it up or commit it before upgrading `@boostkit/panels`.

---

## Filters

```ts
import { SelectFilter } from '@boostkit/panels'

// Simple — default column=value equality
SelectFilter.make('status')
  .label('Status')
  .column('status')     // column name (defaults to filter name)
  .options([
    { label: 'Draft',     value: 'draft' },
    { label: 'Published', value: 'published' },
  ])
```

### Custom Query

Use `.query(fn)` when the default equality check isn't enough. The callback receives the raw ORM query builder and the selected value:

```ts
SelectFilter.make('status')
  .options([...])
  .query((q, value) => {
    q.where('status', value)
    if (value === 'published') q.where('publishedAt', '!=', null)
  })

// Date range
SelectFilter.make('period')
  .label('Period')
  .options([
    { label: 'Last 7 days',  value: '7d' },
    { label: 'Last 30 days', value: '30d' },
  ])
  .query((q, value) => {
    const days = value === '7d' ? 7 : 30
    q.where('createdAt', '>=', new Date(Date.now() - days * 86400000))
  })
```

Without `.query()`, the filter applies `WHERE column = value` using the filter name (or `.column()`) as the column.

---

## Global Search

The panel header includes a keyboard-driven global search that searches **all resources** at once.

- **Open**: click the search button or press `⌘K` / `Ctrl+K` from anywhere in the panel
- **Results**: grouped by resource, up to 5 matches per resource
- **Keyboard nav**: `↑` / `↓` to move, `Enter` to navigate, `Escape` to close
- **Debounced**: 300 ms delay before querying

Only resources that have a model and at least one `.searchable()` field are included. The `static titleField` controls which field is displayed in the results.

The endpoint is `GET /{panel}/api/_search?q=query&limit=5` (max 20).

---

## Conditional Fields

Show, hide, or disable form fields based on another field's current value.
Conditions are evaluated live in create and edit forms — no page reload.

```ts
// Show only when status = "published"
DateField.make('publishedAt').showWhen('status', 'published')

// Show when one of multiple values
TextareaField.make('archiveReason').showWhen('status', ['archived', 'rejected'])

// Hide when featured is false
TextField.make('featuredLabel').hideWhen('featured', false)

// Show when views exceeds a threshold (operator overload)
TextField.make('trendingBadge').showWhen('views', '>', 1000)

// Show when a field has any value (non-empty)
TextField.make('subtitle').showWhen('hasSubtitle', 'truthy')

// Disable (show but readonly) when verified
EmailField.make('email').disabledWhen('verified', true)
```

| Method | Description |
|--------|-------------|
| `.showWhen(field, value)` | Show when `field === value` |
| `.showWhen(field, op, value)` | Show when `field {op} value` — ops: `=` `!=` `>` `>=` `<` `<=` |
| `.showWhen(field, [values])` | Show when `field` is one of `[values]` |
| `.showWhen(field, 'truthy')` | Show when field is non-empty / non-null / non-zero |
| `.showWhen(field, 'falsy')` | Show when field is empty / null / zero / false |
| `.hideWhen(...)` | Inverse of showWhen — same overloads |
| `.disabledWhen(...)` | Show but make readonly — same overloads |

Multiple conditions can be stacked — all must pass.
Conditions only apply to **create and edit forms**. Use `.hideFromTable()` / `.hideFrom('view')` for table/show visibility.

---

## Field-Level Access Control

Restrict individual fields based on the current user — independent of the resource-level `policy()`.
Inspired by PayloadCMS's `access: { read, update }`.

```ts
// Only admins can see internal notes
TextField.make('internalNotes')
  .readableBy((ctx) => ctx.user?.role === 'admin')

// Non-admins see the field but can't edit it
EmailField.make('email')
  .editableBy((ctx) => ctx.user?.role === 'admin')
```

| Method | Behavior when `fn` returns `false` |
|--------|-------------------------------------|
| `.readableBy(ctx => bool)` | Field stripped from list + show responses |
| `.editableBy(ctx => bool)` | Field marked `readonly: true` in the form |

`ctx` is `PanelContext` (`{ user, headers, path }`).

---

## Per-Field Validation

Add async validators directly on a field — runs server-side alongside Zod validation.
Inspired by PayloadCMS's `validate: async (value, { data }) => string | true`.

```ts
// Unique slug check (cross-field — receives full form data)
SlugField.make('slug')
  .validate(async (value, data) => {
    const q = Article.query().where('slug', value as string)
    if (data['id']) q.where('id', '!=', data['id'] as string)
    return await q.first() ? 'Slug already in use' : true
  })

// Cross-field date validation
TextField.make('endDate')
  .validate((value, data) => {
    if ((value as string) < (data['startDate'] as string))
      return 'End date must be after start date'
    return true
  })
```

- Return `true` → passes
- Return a string → shown as a field-level validation error (same UI as Zod errors)
- `data` is the full request body — use it to compare with other fields

---

## Display Transformers + Computed Fields

### `.display(fn)` — format a raw value for the table and show page

Runs server-side before the response is sent. The pre-formatted value replaces the raw one.
Inspired by FilamentPHP's `->formatStateUsing(fn)` and PayloadCMS's `hooks.afterRead`.

```ts
// Format cents as currency
NumberField.make('price')
  .display((v) => `$${((v as number) / 100).toFixed(2)}`)

// Custom date format
DateField.make('createdAt')
  .display((v) => v
    ? new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(new Date(v as string))
    : '—'
  )

// Use the full record for context
TextField.make('status')
  .display((v, record) => {
    const r = record as { status: string; publishedAt?: string }
    return r.publishedAt ? `${v} on ${r.publishedAt}` : String(v)
  })
```

### `ComputedField` — virtual column with no database backing

Always readonly; hidden from create and edit forms.

```ts
import { ComputedField } from '@boostkit/panels'

// Word count from excerpt
ComputedField.make('wordCount')
  .label('Words')
  .compute((r) => (r as Article).excerpt?.split(/\s+/).length ?? 0)
  .display((v) => `${v} words`)

// Full name from parts
ComputedField.make('fullName')
  .label('Full Name')
  .compute((r) => `${(r as User).firstName} ${(r as User).lastName}`)

// Chain .compute() with .display() to both derive and format
ComputedField.make('revenue')
  .compute((r) => (r as any).orders?.reduce((s: number, o: any) => s + o.total, 0) ?? 0)
  .display((v) => `$${((v as number) / 100).toFixed(2)}`)
```

---

## Search & Sort

The list page sends `?search=foo` and `?sort=name&dir=ASC` query params automatically when:
- Field is marked `.searchable()` — search input appears in toolbar
- Field is marked `.sortable()` — clicking column header sorts it

---

## Pagination

**Numbered pages** (default):

```ts
static perPage = 25                       // default: 15
static perPageOptions = [25, 50, 100]     // default: [10, 15, 25, 50, 100]
```

**Load more** — replaces page numbers with an append button:

```ts
static paginationType = 'loadMore'
static perPage = 10   // batch size
```

All data is SSR — `?page=3` loads pages 1–3 server-side in a single query.

---

## Table State Persistence

Persist filters, sort, search, page position, and selected rows in `sessionStorage`. Sidebar links auto-restore the saved URL.

```ts
static persistTableState = true   // default: false
```

Cleared on tab close. "Clear filters" and bulk actions clear saved state.

---

## Actions

```ts
Action.make('markComplete')
  .label('Mark as Complete')
  .bulk()                         // shows in bulk-action bar
  .destructive()                  // red styling
  .confirm('Are you sure?')       // requires confirmation
  .handler(async (records) => {
    for (const r of records as Todo[]) {
      await Todo.query().update(r.id, { completed: true })
    }
  })
```

---

## Duplicate Record

Each table row has a **Duplicate** button (between Edit and Delete). Clicking it:

1. Fetches the full record via `GET /{panel}/api/{resource}/{id}`
2. Builds a prefill URL from the record's fields (skipping `id`, `password`, `hidden`, `slug`, and readonly fields)
3. Navigates to the create page with those values pre-filled

The field that auto-generates a slug (via `SlugField.from()`) gets `" (copy)"` appended to its value, so the new slug is unique:

- Original: `title = "My Article"`, `slug = "my-article"`
- Duplicate: `title = "My Article (copy)"`, `slug = "my-article-copy"`

No configuration required — the button is always present in the row actions.

---

## Bulk Delete

When one or more rows are selected, a selection bar appears at the bottom of the table. It always shows:

- A count of selected rows
- A **"Delete N selected"** button — opens a confirmation dialog before permanently deleting all selected records
- Any custom bulk `Action` buttons defined on the resource

The bulk delete endpoint is `DELETE /{panel}/api/{resource}` (body: `{ ids: string[] }`).

---

## Guard (Authorization)

```ts
Panel.make('admin').guard(async (ctx) => {
  return ctx.user?.role === 'admin'
})
```

`ctx` contains `user`, `headers`, and `path`. Returning `false` redirects unauthenticated users to `/login?redirect=<encodedPath>` for UI requests, and responds with `401 Unauthorized` for API requests.

**Accessing custom user fields** — if your guard (or resource policy) references a custom field like `ctx.user?.role`, you must declare it in `user.additionalFields` in `config/auth.ts`. Without this declaration the field is `undefined` even if it exists in the database:

```ts
// config/auth.ts
export default {
  // ...
  user: {
    additionalFields: {
      role: { type: 'string', defaultValue: 'user', input: false },
    },
  },
} satisfies BetterAuthConfig
```

Override `policy()` per resource for fine-grained access:

```ts
async policy(action: PolicyAction, ctx: PanelContext): Promise<boolean> {
  if (action === 'delete') return ctx.user?.role === 'admin'
  return true
}
```

`PolicyAction`: `'viewAny' | 'view' | 'create' | 'update' | 'delete' | 'restore' | 'forceDelete'`

---

## Globals

Single-record settings pages — same field system as Resources but no list/create/delete. Just an edit form.

```ts
import { Global, TextField, ToggleField, Section } from '@boostkit/panels'

export class SiteSettingsGlobal extends Global {
  static slug  = 'site-settings'
  static label = 'Site Settings'
  static icon  = '⚙️'

  fields() {
    return [
      Section.make('General').schema(
        TextField.make('siteName').required(),
        TextField.make('tagline'),
      ),
      Section.make('Maintenance').schema(
        ToggleField.make('maintenanceMode'),
      ),
    ]
  }
}
```

Register on the panel: `.globals([SiteSettingsGlobal])`. API: `GET/PUT /{panel}/api/_globals/{slug}`.

Storage: single `PanelGlobal` table — `slug` (PK) + `data` (JSON string). No migration needed per global.

---

## Resource Widgets

Define widgets on the show page for a specific resource. The `widgets()` method receives the current record and returns schema elements.

```ts
import { Resource, Stats, Stat, Chart, List } from '@boostkit/panels'

export class ArticleResource extends Resource {
  // ... fields, filters, etc.

  widgets(record?: Record<string, unknown>) {
    return [
      Stats.make([
        Stat.make('Views').value(record?.viewCount ?? 0),
        Stat.make('Word Count').value(String(record?.content ?? '').split(' ').length),
        Stat.make('Status').value(String(record?.draftStatus ?? 'draft')),
      ]),
      Chart.make('Traffic')
        .chartType('area')
        .labels(['Mon', 'Tue', 'Wed', 'Thu', 'Fri'])
        .datasets([{ label: 'Views', data: [45, 120, 89, 200, 156] }])
        .height(200),
      List.make('Related Links')
        .items([
          { label: 'View on site', href: `/articles/${record?.slug}`, icon: '🔗' },
          { label: 'Analytics', href: `/analytics/articles/${record?.id}`, icon: '📊' },
        ]),
    ]
  }
}
```

Widgets render above the record fields on the show page. All schema element types are supported: `Stats`, `Chart`, `List`, `Table`, `Text`, `Heading`.

### WidgetRenderer Component

The `WidgetRenderer` React component renders any schema element type. It is used internally by the panel landing page, resource show page, and the dashboard builder. Available for custom pages:

```tsx
import { WidgetRenderer } from '@boostkit/panels/client'

<WidgetRenderer widgets={widgetData} panel="admin" />
```

`WidgetRenderer` handles all element types and renders the appropriate UI component for each (stat cards, charts, tables, lists, headings, text).

---

## Feature Flags

Resources support several static feature flags. Collaborative mode is derived automatically from fields.

```ts
export class ArticleResource extends Resource {
  static live              = true               // table auto-refreshes on save
  static versioned         = true               // version history with JSON snapshots
  static draftable         = true               // draft/publish workflow
  static softDeletes       = true               // trash & restore
  static autosave          = true               // periodic server save (default 30s)
  static persistFormState  = true               // localStorage backup + restore banner
}
```

### `live`
Table auto-refreshes when any user saves. Uses `@boostkit/broadcast` — no Yjs.

### `versioned`
Each save/publish creates a JSON snapshot in `PanelVersion`. View history and revert. The version history panel highlights the active version and lets users restore any snapshot. No Yjs needed.

### `draftable`
Records have a `draftStatus` field (`'draft'` | `'published'`). Create defaults to draft. Edit page shows "Save Draft" and "Publish" buttons. Requires `draftStatus String @default("draft")` column.

### `softDeletes`
Delete sets `deletedAt` instead of removing. Trash view with restore and force-delete. Requires `deletedAt DateTime?` column.

### `autosave`

Periodically saves form changes to the server without requiring the user to click Save. Only applies to the edit page (create requires explicit submission).

```ts
export class ArticleResource extends Resource {
  static autosave = true                  // enable with default 30s interval
  // or
  static autosave = { interval: 10000 }  // custom interval (ms)
}
```

The edit toolbar shows a status indicator:
- **Unsaved changes** — form is dirty, waiting for next interval
- **Saving...** — autosave request in progress
- **Saved** — autosave succeeded (fades after 3s)

Autosave skips when: a manual save is in progress, the form is in version restore preview, or no changes have been made since the last save. Does not create version snapshots (only manual save does).

### `persistFormState`

Backs up form values to `localStorage` as the user types. On page reload or browser crash, a restore banner offers to recover the draft. Applies to both create and edit pages.

```ts
export class ArticleResource extends Resource {
  static persistFormState = true
}
```

Features:
- **Restore banner** — "You have unsaved changes from 5m ago. Restore / Discard"
- **beforeunload warning** — browser confirms before leaving with unsaved changes
- Drafts are cleared on successful save (manual or autosave)

The two flags are independent — use either or both:

| Config | Behavior |
|--------|----------|
| `autosave` only | Server saves every N seconds. No localStorage, no restore banner. |
| `persistFormState` only | localStorage backup + restore banner + beforeunload. Manual save only. |
| Both | localStorage catches crashes between autosave intervals. |

### Per-Field Persist (`.persist()`)

For granular control, add `.persist()` to individual fields. Values are silently saved and restored — no banner, no prompt.

```ts
fields() {
  return [
    // localStorage — silent save/restore per field
    TextField.make('title').persist(),

    // y-indexeddb — Yjs offline persistence (survives refresh)
    TextField.make('body').persist('indexeddb'),

    // y-websocket — Yjs real-time sync (like .collaborative())
    TextField.make('notes').persist('websocket'),

    // Both Yjs providers — real-time + offline
    TextField.make('content').persist(['websocket', 'indexeddb']),
  ]
}
```

| Mode | Mechanism |
|---|---|
| `.persist()` | localStorage — silent save/restore per field |
| `.persist('indexeddb')` | y-indexeddb — Y.Doc survives browser refresh |
| `.persist('websocket')` | y-websocket — real-time sync between editors |
| `.persist(['websocket', 'indexeddb'])` | Both — real-time + offline persistence |

`.persist()` is independent from `persistFormState`. Use `persistFormState` for full-form backup with a restore banner. Use `.persist()` for individual fields that should quietly survive page reloads.

### Collaborative Editing

No resource-level flag needed — just add `.collaborative()` to any field. `.collaborative()` is a shorthand for `.persist('websocket')` — it enables real-time Yjs sync between all connected editors.

```ts
fields() {
  return [
    // Text-based fields — each gets its own Y.Doc + Lexical editor
    TextField.make('title').collaborative(),
    TextareaField.make('excerpt').collaborative(),
    RichContentField.make('body').collaborative(),

    // Value-based fields — shared Y.Doc, Y.Map (last-write-wins)
    ToggleField.make('featured').collaborative(),
    SelectField.make('status').collaborative(),
    DateField.make('publishedAt').collaborative(),
    ColorField.make('accentColor').collaborative(),

    // Non-collaborative fields work as normal
    SlugField.make('slug').from('title'),
  ]
}
```

**How it works:**

| Field type | Sync mechanism | Details |
|---|---|---|
| `text`, `textarea`, `email` | Own Y.Doc per field (Lexical PlainText) | Character-level CRDT, remote cursors |
| `richcontent`, `content` | Own Y.Doc per field (Lexical RichText) | Full rich-text collaboration with cursors |
| `boolean`, `toggle`, `select`, `date`, `color`, `tags`, etc. | Shared Y.Doc via Y.Map | Last-write-wins, instant sync |

Each text-based field gets its own WebSocket room (`panel:articles:{id}:text:title`, `panel:articles:{id}:richcontent:body`, etc.) for complete isolation. Non-text fields share a single Y.Map in the form-level Y.Doc.

**Requirements**: `@boostkit/live` registered in providers.

The edit page shows connection status and presence avatars when collaborative fields are present.

### Composing Flags

| Combo | Behavior |
|-------|----------|
| `versioned` only | Save creates a JSON snapshot. Can rollback. |
| `draftable` only | Draft/publish workflow. No history. |
| `draftable + versioned` | Draft/publish + version history on each publish. |
| `.collaborative()` fields | Real-time co-editing. Save goes to DB. |
| `.collaborative()` + `versioned` | Co-edit + version snapshots with restore. |
| `autosave` only | Periodic server save, status indicator in toolbar. |
| `persistFormState` only | localStorage backup, restore banner, beforeunload. |
| `autosave + persistFormState` | Server autosave + localStorage crash safety net. |
| All flags | Full power: co-edit, draft/publish, version history, trash, autosave, persist. |

---

## Table Column Types

Fields render visually in table cells:

- **Badge mapping** — `.badge({ draft: { color: 'yellow', label: 'Draft' } })` — any field
- **Select** — shows label from options instead of raw value
- **Image** — thumbnail preview (via `FileField.image()`)
- **Toggle/Boolean** — Yes/No badge
- **Color** — swatch + hex code
- **Tags** — badge pills
- **Progress bar** — `NumberField.progressBar({ max: 100, color: '#22c55e' })`
- **Relations** — linked names with badges

Badge colors: `gray`, `red`, `orange`, `yellow`, `green`, `blue`, `purple`, `pink`.

---

## Inline Table Editing

Edit field values directly in the table — no edit page needed.

```ts
SelectField.make('status').inlineEditable()   // click → dropdown
ToggleField.make('featured').inlineEditable() // click → toggle switch
TextField.make('title').inlineEditable()       // click → text input
NumberField.make('priority').inlineEditable()  // click → number input
```

Sends `PUT /api/{resource}/:id` with just the changed field (partial update). Validation only runs on the submitted field.

---

## API Routes

For each resource, the following routes are automatically mounted:

| Method | Path | Description |
|---|---|---|
| `GET` | `/{panel}/api/_meta` | Panel + resource schema |
| `GET` | `/{panel}/api/_search` | Global search across all resources — `?q=query&limit=5` |
| `GET` | `/{panel}/api/{resource}` | List (paginated, searchable, sortable, filterable) |
| `GET` | `/{panel}/api/{resource}/:id` | Show |
| `POST` | `/{panel}/api/{resource}` | Create |
| `PUT` | `/{panel}/api/{resource}/:id` | Update |
| `DELETE` | `/{panel}/api/{resource}/:id` | Delete one record |
| `DELETE` | `/{panel}/api/{resource}` | Bulk delete — body: `{ ids: string[] }` |
| `POST` | `/{panel}/api/{resource}/_action/:action` | Bulk action |
| `POST` | `/{panel}/api/_upload` | File upload (used by FileField) |
| `GET` | `/{panel}/api/{resource}/_options` | Relation select options — used by RelationField |
| `GET` | `/{panel}/api/{resource}/_schema` | Field definitions — used for inline create dialog |
| `GET` | `/{panel}/api/{resource}/_related` | HasMany records — `?fk=col&id=val[&through=true]` |
| `POST` | `/{panel}/api/{resource}/:id/_restore` | Restore soft-deleted record |
| `DELETE` | `/{panel}/api/{resource}/:id/_force` | Permanently delete |
| `POST` | `/{panel}/api/{resource}/_restore` | Bulk restore — body: `{ ids: string[] }` |
| `DELETE` | `/{panel}/api/{resource}/_force` | Bulk force delete — body: `{ ids: string[] }` |
| `GET` | `/{panel}/api/{resource}/:id/_versions` | List version snapshots |
| `POST` | `/{panel}/api/{resource}/:id/_versions` | Create version snapshot |
| `GET` | `/{panel}/api/{resource}/:id/_versions/:vid` | Version detail |
| `GET` | `/{panel}/api/_globals/{slug}` | Read global settings |
| `PUT` | `/{panel}/api/_globals/{slug}` | Update global settings |

The `GET` list endpoint supports:
- `?page=1&perPage=15` — pagination (defaults configurable via `static perPage` / `static perPageOptions`)
- `?search=foo` — search across `.searchable()` fields (LIKE)
- `?sort=name&dir=ASC` — sort by `.sortable()` field
- `?filter[field]=value` — apply filters
- `?trashed=true` — show soft-deleted records (when `softDeletes` enabled)
