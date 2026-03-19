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

Data table sourced from a Resource class, a raw ORM model, or static inline rows. Supports sort, search, pagination, lazy loading, polling, filters, and actions.

Three modes:

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

**Static rows** — inline data, no model or resource needed.

```ts
Table.make('Browser Stats')
  .rows([
    { name: 'Chrome', share: 65 },
    { name: 'Firefox', share: 10 },
    { name: 'Safari', share: 18 },
  ])
  .columns([Column.make('name'), Column.make('share').numeric()])
```

| Method | Description |
|--------|-------------|
| `.fromResource(Class)` | Use a Resource class as data source — inherits model, sort defaults, and field labels |
| `.fromModel(Class)` | Use an ORM Model class directly as data source |
| `.rows([...])` | Static inline data — no model or resource needed |
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

### `Tabs` (schema-level)

Group schema elements into tabbed sections on the panel landing page. Uses the same `Tabs.make().tab()` API as resource field tabs.

```ts
import { Tabs, Stats, Stat, Chart, Table, List } from '@boostkit/panels'

Tabs.make()
  .tab('Overview',
    Stats.make([
      Stat.make('Articles').value(await Article.query().count()),
      Stat.make('Users').value(await User.query().count()),
    ]),
  )
  .tab('Charts',
    Chart.make('Weekly Traffic')
      .chartType('area')
      .labels(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])
      .datasets([{ label: 'Visitors', data: [120, 230, 180, 350, 290, 150, 90] }]),
  )
  .tab('Recent',
    Table.make('Recent Articles')
      .fromResource(ArticleResource)
      .columns(['title', 'createdAt'])
      .limit(5),
  )
  .tab('Links',
    List.make('Resources')
      .items([
        { label: 'Docs', href: '/docs', icon: '📖' },
        { label: 'GitHub', href: 'https://github.com/...', icon: '🐙' },
      ]),
  )
```

Each tab can contain any schema element type -- `Stats`, `Chart`, `Table`, `List`, `Heading`, `Text`, `Widget`, or even a `Dashboard`. The same `Tabs` class works in both contexts:

| Context | Content | Example |
|---------|---------|---------|
| Resource fields | `Field` instances | `Tabs.make().tab('Content', TextField.make('title'))` |
| Panel schema | Schema elements | `Tabs.make().tab('Charts', Chart.make('Revenue')...)` |

**URL Persistence**: The active tab is persisted in the URL query string. Clicking "Charts" updates the URL to `?tab=charts`. Refreshing or sharing the URL opens the correct tab (SSR-compatible — no flash).

- Default `?tab=` param when using `Tabs.make()`
- Named param when using `Tabs.make('analytics')` → `?analytics=charts`
- First tab is the default — no query param in the URL
- Multiple tab groups use separate param keys to avoid conflicts

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

## WidgetRenderer Component

The `WidgetRenderer` React component renders any schema element type. It is used internally by the panel landing page, resource show page, and the dashboard builder. Also available for custom pages.

```tsx
import { WidgetRenderer } from '@boostkit/panels/client'

export default function CustomPage({ data }) {
  return <WidgetRenderer widgets={data.widgets} panel="admin" />
}
```

`WidgetRenderer` handles all element types and renders the appropriate UI component for each (stat cards, charts, tables, lists, headings, text).

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
| `.fields([...])` | Array of `Field` instances |
| `.onSubmit(fn)` | Async handler called with form data on submit |
| `.submitLabel(text)` | Submit button label (default: `'Submit'`) |
| `.successMessage(text)` | Message shown after successful submit |

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
