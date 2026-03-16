# Widgets & Schema Elements

Schema elements are the building blocks for panel landing pages (`Panel.schema()`) and resource show page widgets (`Resource.widgets()`). They render stats, charts, tables, lists, and text content. When combined with `@boostkit/dashboards`, they also power user-customizable dashboard grids.

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

Row of stat cards. Each stat has a label, value, optional description, and trend indicator.

```ts
import { Stats, Stat } from '@boostkit/panels'

Stats.make([
  Stat.make('Users').value(1250).description('+12 this week').trend('up'),
  Stat.make('Revenue').value('$48,200').trend('up'),
  Stat.make('Bounce Rate').value('32%').trend('down'),
  Stat.make('Active Now').value(42).trend('neutral'),
])
```

| Method | Description |
|--------|-------------|
| `Stat.make(label)` | Create a stat with a label |
| `.value(v)` | The primary display value (string or number) |
| `.description(text)` | Secondary text below the value |
| `.trend('up' \| 'down' \| 'neutral')` | Trend indicator arrow and color |

### `Table`

Data table sourced from a panel resource. Displays records with sorting and a configurable row limit.

```ts
import { Table } from '@boostkit/panels'

Table.make('Recent Articles')
  .resource('articles')                    // resource slug
  .columns(['title', 'status', 'createdAt'])
  .sortBy('createdAt', 'DESC')
  .limit(5)
```

| Method | Description |
|--------|-------------|
| `.resource(slug)` | Resource slug to query |
| `.columns([...])` | Column names to display |
| `.sortBy(column, direction)` | Sort order (`'ASC'` or `'DESC'`) |
| `.limit(n)` | Maximum rows to show |

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

---

## Panel Landing Page (`Panel.schema()`)

By default, visiting the panel root (e.g. `/admin`) redirects to the first resource. Use `.schema()` to define a custom landing page with schema elements, standalone widgets, and user-customizable dashboards.

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

For user-customizable dashboards with drag-and-drop, layout persistence, lazy loading, and polling, see the [@boostkit/dashboards](/packages/dashboards) documentation.

Key concepts:

- **Standalone widgets**: `Widget.make()` placed directly in `Panel.schema()` renders as a static grid element
- **Dashboard widgets**: `Widget.make()` inside `Dashboard.make().widgets()` supports drag-and-drop, resize, and per-user customization
- **Dashboard tabs**: `Dashboard.tab('id').label('Name').widgets([...])` for tabbed widget sections
- **Lazy + polling**: `.lazy()` defers to client-side, `.poll(ms)` re-fetches periodically
- **Widget settings**: Configurable per-widget fields editable by users
