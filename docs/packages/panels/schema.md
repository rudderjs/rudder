# Widgets & Schema Elements

Schema elements are the building blocks for panel landing pages (`Panel.schema()`) and resource show page widgets (`Resource.widgets()`). They render stats, charts, tables, lists, and text content. Dashboard widgets (`Widget`, `Dashboard`) are also part of this package, powering user-customizable dashboard grids.

---

## Schema Elements Reference

### `Heading`

Section heading with configurable level.

```ts
import { Heading } from '@boostkit/panels'

Heading.make('Welcome back')
Heading.make('Section Title').level(2)   // 1 | 2 | 3 (default: 1)
```

### `Text`

Paragraph of text.

```ts
import { Text } from '@boostkit/panels'

Text.make('Logged in as admin@example.com')
Text.make('Manage your application from the sidebar.')
```

### `Stats`

Row of stat cards. Each stat has a label, value, optional description, and trend percentage. When a single stat is rendered, it fills the container without a grid wrapper.

**Static mode** — inline stat values:

```ts
import { Stats, Stat } from '@boostkit/panels'

Stats.make([
  Stat.make('Total Articles').value(await Article.query().count()).trend(12),
  Stat.make('Total Categories').value(await Category.query().count()),
  Stat.make('Total Todos').value(await Todo.query().count()).description('Including completed'),
  Stat.make('Total Users').value(await User.query().count()).trend(-3),
])
```

**Async mode** — load data on the client with lazy loading and polling:

```ts
// Async stats with lazy loading and polling
Stats.make('dashboard-stats')
  .data(async (ctx) => [
    { label: 'Users', value: await User.query().count() },
    { label: 'Articles', value: await Article.query().count(), trend: 5 },
    { label: 'Revenue', value: '$12,450', description: 'This month' },
  ])
  .poll(60000)  // refresh every minute
```

| Method | Description |
|--------|-------------|
| `Stats.make([...])` | Create with inline `Stat` instances (static mode) |
| `Stats.make(id)` | Create with string ID for async mode |
| `Stat.make(label)` | Create a stat with a label |
| `.value(v)` | The primary display value (string or number) |
| `.description(text)` | Secondary text below the value |
| `.trend(n)` | Percentage change — positive shows ↑ green, negative shows ↓ red |
| `.data(fn)` | Async function returning `PanelStatMeta[]` (async mode) |
| `.lazy()` | Defer loading to client-side (shows skeleton) |
| `.poll(ms)` | Re-fetch every N milliseconds |

The `Stats` row auto-sizes: 1 stat = full width, 2 = two columns, 3 = three columns, 4 = four columns (max).

### `Table`

Data table sourced from a Resource class, a raw ORM model, or an array. Supports sort, search, pagination, lazy loading, polling, filters, and actions.

Three data source methods:

**Resource-linked** — inherits the Resource's model, default sort, and field labels. "View all" links to the resource index.

```ts
import { Table } from '@boostkit/panels'
import { ArticleResource } from './resources/ArticleResource.js'

// Column names resolved from Resource fields
Table.make('Recent Articles')
  .fromResource(ArticleResource)
  .columns(['title', 'status', 'createdAt'])
  .sortBy('createdAt', 'DESC')
  .limit(5)

// Or with typed Column instances
Table.make('Recent Articles')
  .fromResource(ArticleResource)
  .columns([
    Column.make('title').label('Title').sortable().searchable(),
    Column.make('createdAt').label('Published').date(),
  ])
  .limit(5)
```

**Model-backed** — query any ORM model directly, no resource needed.

```ts
import { Table, Column } from '@boostkit/panels'
import { User } from 'App/Models/User.js'

Table.make('All Users')
  .fromModel(User)
  .columns([
    Column.make('name').label('Name').sortable().searchable(),
    Column.make('email').label('Email').sortable().searchable(),
    Column.make('createdAt').label('Joined').date(),
  ])
  .sortBy('createdAt', 'DESC')
  .limit(10)
  .reorderable('position')   // enable drag-to-reorder rows
```

**Array data** — static array or async function. No model or resource needed.

```ts
// Static array
Table.make('Browser Stats')
  .fromArray([
    { name: 'Chrome', share: 65 },
    { name: 'Firefox', share: 10 },
    { name: 'Safari', share: 18 },
  ])
  .columns([Column.make('name'), Column.make('share').numeric()])

// Async function — receives PanelContext, works with .lazy() and .poll()
Table.make('Top Customers')
  .fromArray(async (ctx) => {
    const rows = await db.query('SELECT name, total FROM customers ORDER BY total DESC LIMIT 10')
    return rows
  })
  .columns([Column.make('name'), Column.make('total').numeric()])
  .lazy()
  .poll(60000)
```

`DataSource<T>` is exported from `@boostkit/panels`:

```ts
type DataSource<T> = T[] | ((ctx: PanelContext) => T[] | Promise<T[]>)
```

| Method | Description |
|--------|-------------|
| `.fromResource(Class)` | Use a Resource class as data source — inherits model, sort defaults, and field labels |
| `.fromModel(Class)` | Use an ORM Model class directly as data source |
| `.fromArray(data)` | Static array or async function returning rows. Async functions receive `PanelContext` |
| `.columns([...])` | Column names (`string[]`) or `Column` instances |
| `.sortBy(col, dir)` | Server-side sort order (`'ASC'` or `'DESC'`) |
| `.limit(n)` | Maximum rows to show (default: 5) |
| `.reorderable(field?)` | Enable drag-to-reorder rows, saves to `field` (default: `'position'`) |
| `.scope(fn)` | Custom query filter: `.scope(q => q.where('active', true))` |
| `.description(text)` | Subtitle below the table title |
| `.emptyMessage(text)` | Custom "no records" message |
| `.href(pattern)` | Row click URL with `:field` placeholders |
| `.searchable(cols?)` | Show search input — optionally restrict to specific columns |
| `.paginated(mode?, perPage?)` | Enable pagination: `'pages'` or `'loadMore'` (default: `'pages'`, 15/page) |
| `.lazy()` | Defer data loading to client-side (shows skeleton) |
| `.poll(ms)` | Re-fetch data every N milliseconds |
| `.id(id)` | Explicit ID for API endpoint (auto-generated from title if not set) |
| `.filters([...])` | Attach `SelectFilter` / `SearchFilter` dropdowns |
| `.actions([...])` | Attach bulk/row `Action` handlers |
| `.remember(mode)` | Persist table state across navigations: `false` (default), `'localStorage'`, `'url'`, `'session'` |

#### Pagination

Tables support two pagination modes via `.paginated()`:

```ts
// Classic page-based pagination (default: 15 rows per page)
Table.make('All Users')
  .fromModel(User)
  .columns([Column.make('name'), Column.make('email')])
  .paginated('pages', 25)

// "Load more" button — appends rows incrementally
Table.make('Activity Log')
  .fromModel(Activity)
  .columns([Column.make('action'), Column.make('createdAt').date()])
  .paginated('loadMore', 10)
```

When no `.paginated()` is called, the table renders all rows up to `.limit()` with no pagination controls.

#### Lazy & Polling

Use `.lazy()` to defer data loading to the client — the table renders a skeleton placeholder on initial SSR and fetches data via the API once mounted. Combine with `.poll(ms)` to keep data fresh.

```ts
Table.make('Live Orders')
  .id('live-orders')
  .fromModel(Order)
  .columns([
    Column.make('customer').sortable(),
    Column.make('total').numeric(),
    Column.make('status').badge(),
  ])
  .lazy()
  .poll(5000)  // re-fetch every 5 seconds
```

#### Table State Persistence (`.remember()`)

Persist page, sort column, sort direction, search query, and filters across navigations and page refreshes:

```ts
Table.make('Recent Articles')
  .fromModel(Article)
  .columns([...])
  .paginated('pages', 10)
  .searchable()
  .remember()              // localStorage (default)
  .remember('url')         // URL query params — shareable, SSR
  .remember('session')     // server session — SSR, clean URL
  .remember(false)         // no persistence (default)
```

| Mode | URL changes | SSR state | Survives refresh | Shareable |
|------|------------|-----------|------------------|-----------|
| `false` | No | No | No | No |
| `'localStorage'` | No | No | Yes | No |
| `'url'` | Yes | Yes | Yes | Yes |
| `'session'` | No | Yes | Yes | No |

The `mode` parameter accepts the shared `PersistMode` type (see below), which is also used by `Tabs.persist()`.

### `Column`

Typed display column for `Table.make()`. Distinct from `Field` — Column is for display/sort/search only, not for input or validation.

```ts
import { Column } from '@boostkit/panels'

Column.make('title').label('Article Title').sortable().searchable()
Column.make('status').label('Status').badge()
Column.make('createdAt').label('Date').date()
Column.make('price').label('Price').numeric()
Column.make('active').label('Active').boolean()
Column.make('avatar').label('Photo').image()
Column.make('name').label('Name').href('/admin/resources/users/:id')
```

| Method | Description |
|--------|-------------|
| `.label(text)` | Column header label |
| `.sortable()` | Enables client-side sort on click |
| `.searchable()` | Includes in client-side search |
| `.date(format?)` | Format value as a date (`'medium'` or `'datetime'`) |
| `.numeric()` | Right-align and treat as number |
| `.boolean()` | Render as Yes/No |
| `.badge()` | Render as a badge |
| `.image()` | Render as a small thumbnail |
| `.href(pattern)` | Wrap cell in a link; use `:id` as placeholder |
| `.compute(fn)` | Derive value from the full record — runs server-side |
| `.display(fn)` | Format value for display — runs server-side |

#### Computed & Display Columns

Use `.compute()` to create derived columns from the full record, and `.display()` to format any column value. Both run server-side before the response is sent.

```ts
// Derived column — value computed from record fields
Column.make('wordCount').label('Words')
  .compute((record) => record.title?.split(/\s+/).length ?? 0)
  .display((v) => `${v} words`)

// Display-only — format an existing value
Column.make('price').label('Price')
  .display((v) => `$${((v as number) / 100).toFixed(2)}`)
```

`.compute(fn)` receives the full record and returns a derived value. `.display(fn)` receives the raw (or computed) value and returns a formatted string. Chain both to derive and format in one column.

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

| Method | Description |
|--------|-------------|
| `.chartType(type)` | `'line'` \| `'bar'` \| `'area'` \| `'pie'` \| `'doughnut'` |
| `.labels([...])` | X-axis labels (or slice labels for pie/doughnut) |
| `.datasets([...])` | Array of `{ label, data, color? }` |
| `.height(px)` | Chart height in pixels (default: 300) |

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

| Method | Description |
|--------|-------------|
| `.items([...])` | Array of `{ label, description?, href?, icon? }` |
| `.limit(n)` | Maximum items to display (default: 5) |

### `Tab` and `Tabs` (schema-level)

Group schema elements into tabbed sections. `Tab` is a first-class exported class with its own API for icon, badge, and lazy loading. `Tabs` is the container that holds `Tab` instances.

#### `Tab` — individual tab

```ts
import { Tab, Tabs, Stats, Stat, Chart, Table, Column } from '@boostkit/panels'

Tabs.make('content-tabs', [
  Tab.make('Overview')
    .icon('home')
    .badge(async () => await Article.query().count())
    .schema([
      Stats.make([Stat.make('Total').value(42)]),
      Table.make('Recent').fromModel(Article).columns([
        Column.make('title').sortable(),
        Column.make('createdAt').date(),
      ]).lazy(),
    ]),
  Tab.make('Charts')
    .icon('bar-chart')
    .schema([
      Chart.make('Traffic').chartType('area')
        .labels(['Mon', 'Tue', 'Wed', 'Thu', 'Fri'])
        .datasets([{ label: 'Visitors', data: [120, 230, 180, 350, 290] }]),
    ]),
  Tab.make('Heavy Data')
    .icon('database')
    .lazy()  // entire tab loads on demand
    .schema([
      Table.make('All Records').fromModel(Record).columns([
        Column.make('name').sortable().searchable(),
      ]).paginated(),
    ]),
])
```

| Method | Description |
|--------|-------------|
| `Tab.make(label)` | Create a tab with a label |
| `.schema(items[])` | Tab content -- fields or schema elements |
| `.icon(name)` | Lucide icon name |
| `.badge(value \| fn)` | Static or async badge value |
| `.lazy()` | Skip SSR for this tab -- loads on demand |

#### `.tab()` shorthand

The `.tab()` shorthand still works for quick inline definitions:

```ts
Tabs.make()
  .tab('Overview', Stats.make([...]), Chart.make(...)...)
  .tab('Links', List.make(...)...)
```

Each tab can contain any schema element type -- `Stats`, `Chart`, `Table`, `List`, `Heading`, `Text`, `Widget`, or even a `Dashboard`. The same `Tabs` class works in both contexts:

| Context | Content | Example |
|---------|---------|---------|
| Resource fields | `Field` instances | `Tabs.make().tab('Content', TextField.make('title'))` |
| Panel schema | Schema elements | `Tabs.make().tab('Charts', Chart.make('Revenue')...)` |

#### SSR behavior

All tabs' content is SSR'd by default. Tab switching is instant (no fetch). Use `.lazy()` on `Tab` or on inner elements (`Table`, `Stats`) to defer heavy queries.

#### Model-backed tabs

Generate tabs dynamically from model records. Each record becomes a tab, with its content defined via `.content()`.

```ts
// Model-backed tabs — each Project record becomes a tab
Tabs.make('projects')
  .fromModel(Project)
  .title('name')
  .scope(q => q.where('active', true))
  .content((record) => [
    Stats.make([
      Stat.make('Tasks').value(record.taskCount),
      Stat.make('Members').value(record.memberCount),
    ]),
    Table.make('Tasks')
      .fromModel(Task)
      .scope(q => q.where('projectId', record.id))
      .columns([Column.make('title').sortable(), Column.make('status').badge()])
      .limit(10),
  ])
  .creatable()
  .editable()
```

Model-backed tabs are mutually exclusive with `.tab()` -- use one or the other.

#### Method reference

| Method | Description |
|--------|-------------|
| `.tab(label, ...elements)` | Add a static tab with content (mutually exclusive with `.fromModel()`) |
| `.fromModel(Model)` | Generate tabs from model records (mutually exclusive with `.tab()`) |
| `.fromResource(Resource)` | Generate tabs from a Resource's model |
| `.fromArray(data)` | Generate tabs from a static array or async function (`DataSource<T>`) |
| `.title(field)` | Model field to use as tab label (default: `'name'`) |
| `.scope(fn)` | Filter which records appear as tabs |
| `.content(fn)` | Content for each tab -- receives the record |
| `.creatable()` | Show [+] button to create new tabs/records |
| `.editable()` | Allow renaming tab labels |
| `.onCreate(fn)` | Custom create handler |
| `.canCreate(fn)` | Gate who can create tabs |
| `.canEdit(fn)` | Gate who can edit tabs |
| `.persist(mode)` | Control active tab persistence (see below) |
| `.lazy()` | Defer tab loading to client-side |
| `.poll(ms)` | Re-fetch tab data periodically |

#### Tab Persistence (`.persist()`)

Controls how the active tab is remembered across navigation and page refreshes:

```ts
Tabs.make('my-tabs', [...])
  .persist('localStorage')  // remembers in browser (no URL change)
  .persist('url')            // URL query param (?my-tabs=charts) — shareable, SSR
  .persist('session')        // server session — SSR active tab, clean URL
  .persist(false)            // no persistence (default)
```

| Mode | URL changes | SSR active tab | Survives refresh | Shareable |
|------|------------|----------------|------------------|-----------|
| `false` | No | First tab | No | No |
| `'localStorage'` | No | First tab | Yes | No |
| `'url'` | Yes | Yes | Yes | Yes |
| `'session'` | No | Yes | Yes | No |

Default: `false` (no persistence). Must explicitly opt in.

The `mode` parameter accepts the shared `PersistMode` type, exported from `@boostkit/panels`. The same type is used by `Table.remember()`.

#### `ListTab` — Resource list tabs

For Resource list filtering tabs (e.g. All / Published / Draft), use `ListTab` -- distinct from the schema-level `Tab`:

```ts
import { ListTab } from '@boostkit/panels'

// In Resource.tabs()
tabs() {
  return [
    ListTab.make('all').label('All'),
    ListTab.make('published').label('Published').query(q => q.where('status', 'published')),
    ListTab.make('draft').label('Draft').query(q => q.where('status', 'draft')),
  ]
}
```

---

## Panel Landing Page (`Panel.schema()`)

By default, visiting the panel root (e.g. `/admin`) redirects to the first resource. Use `.schema()` to define a custom landing page with schema elements, standalone widgets, and user-customizable dashboards.

```ts
import { Panel, Heading, Text, Stats, Stat, Table, Chart, List, Dashboard, Widget } from '@boostkit/panels'

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

    // Standalone widgets -- static, no drag/customize
    Widget.make('total-articles')
      .label('Published Articles')
      .component('stat')
      .defaultSize({ w: 4, h: 2 })
      .icon('newspaper')
      .data(async () => ({ value: await Article.query().count(), trend: 5 })),

    // User-customizable dashboard
    Dashboard.make('overview')
      .label('Overview')
      .widgets([
        Widget.make('total-users').label('Users').component('stat').small()
          .data(async () => ({ value: await User.query().count() })),
      ])
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
      .fromResource(ArticleResource)
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

---

## Resource Widgets (`Resource.widgets()`)

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

---

## SchemaElementRenderer Component

The `SchemaElementRenderer` React component renders any schema element type. It is used internally by the panel landing page, resource show page, and the dashboard builder. Also available for custom pages.

```tsx
import { SchemaElementRenderer } from '@boostkit/panels/client'

export default function CustomPage({ data }) {
  return <SchemaElementRenderer widgets={data.widgets} panel="admin" />
}
```

`SchemaElementRenderer` handles all element types and renders the appropriate UI component for each (stat cards, charts, tables, lists, headings, text, tabs).

---

## Dashboard Widgets

For user-customizable dashboards with drag-and-drop, layout persistence, lazy loading, and polling, see the [Widgets documentation](/packages/panels/schema).

Key concepts:

- **Standalone widgets**: `Widget.make()` placed directly in `Panel.schema()` renders as a static grid element
- **Dashboard widgets**: `Widget.make()` inside `Dashboard.make().widgets()` supports drag-and-drop, resize, and per-user customization
- **Dashboard tabs**: `Dashboard.tab('id').label('Name').widgets([...])` for tabbed widget sections
- **Lazy + polling**: `.lazy()` defers to client-side, `.poll(ms)` re-fetches periodically
- **Widget settings**: Configurable per-widget fields editable by users

---

## `Form` (Standalone)

A standalone form in the panel schema — not tied to a resource. Useful for contact forms, settings forms, feedback, etc. The submit handler runs server-side via a POST to `/{panel}/api/_forms/{id}/submit`.

```ts
import { Form, TextField, EmailField, TextareaField } from '@boostkit/panels'

Form.make('contact')
  .fields([
    TextField.make('name').label('Your Name').required(),
    EmailField.make('email').label('Email Address').required(),
    TextareaField.make('message').label('Message').required(),
  ])
  .submitLabel('Send Message')
  .successMessage('Message sent! We\'ll get back to you shortly.')
  .onSubmit(async (data) => {
    // data = { name, email, message }
    await Mail.to('admin@example.com').send(new ContactMail(data))
  })
```

| Method | Description |
|--------|-------------|
| `.fields([...])` | Array of `Field | Section | Tabs` — supports grouping fields in sections |
| `.onSubmit(fn)` | Async handler called with form data on submit |
| `.submitLabel(text)` | Submit button label (default: `'Submit'`) |
| `.successMessage(text)` | Message shown after successful submit |
| `.description(text)` | Description text above the form fields |
| `.method('PUT')` | HTTP method (default: `'POST'`) |
| `.action(url)` | Custom submit URL (overrides default endpoint) |
| `.data(fn)` | Pre-populate form with initial values from async function |
| `.beforeSubmit(fn)` | Transform data before submission |
| `.afterSubmit(fn)` | Run after successful submission |

**Collaborative form** — real-time sync across tabs/users via `.persist('websocket')`:

```ts
Form.make('collab-notes')
  .fields([
    TextField.make('title').persist('websocket'),
    TextareaField.make('notes').persist('websocket'),
    ToggleField.make('published').persist('websocket'),
  ])
```

Text fields get per-field Y.Doc with character-level CRDT sync. Non-text fields (toggle, select, date) sync via a shared Y.Map (last-write-wins). The form shows connection status and presence count when collaborative fields are present.

**Advanced example** — pre-populated settings form with sections and lifecycle hooks:

```ts
Form.make('settings')
  .description('Update your profile settings')
  .method('PUT')
  .data(async (ctx) => {
    const user = await User.query().find(ctx.user.id)
    return { name: user.name, email: user.email }
  })
  .fields([
    Section.make('Profile').schema(
      TextField.make('name').required(),
      EmailField.make('email').required(),
    ),
    Section.make('Preferences').schema(
      BooleanField.make('notifications'),
    ),
  ])
  .beforeSubmit(async (data) => ({ ...data, updatedAt: new Date() }))
  .afterSubmit(async (result, ctx) => {
    await logActivity('settings.updated', ctx.user.id)
  })
  .onSubmit(async (data, ctx) => {
    await User.query().update(ctx.user.id, data)
  })
```

---

## `Dialog` (Modal Wrapper)

A presentational modal dialog. The trigger button opens the dialog; the content is defined via `.schema()`. Any schema element can be placed inside — most commonly a `Form`.

```ts
import { Dialog, Form, TextField, EmailField, TextareaField } from '@boostkit/panels'

Dialog.make('contact-modal')
  .trigger('Contact Support')
  .title('Send a Message')
  .description('We\'ll get back to you within 24 hours.')
  .schema([
    Form.make('contact-modal-form')
      .fields([
        TextField.make('name').label('Your Name').required(),
        EmailField.make('email').label('Email Address').required(),
        TextareaField.make('message').label('Message').required(),
      ])
      .submitLabel('Send Message')
      .successMessage('Message sent!')
      .onSubmit(async (data) => {
        console.log('[contact modal]', data)
      }),
  ])
```

| Method | Description |
|--------|-------------|
| `.trigger(label)` | Button label that opens the dialog |
| `.title(text)` | Dialog header title |
| `.description(text)` | Subtitle / description below the title |
| `.schema([...elements])` | Schema elements rendered inside the dialog |
