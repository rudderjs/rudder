# @boostkit/dashboards

User-customizable dashboard builder for BoostKit panels. `Dashboard.make()` is a schema element placed inside `Panel.schema()` -- no separate provider config needed. Supports drag-and-drop reordering, per-user layout persistence, widget settings, lazy loading, and polling.

```bash
pnpm add @boostkit/dashboards
```

---

## Quick Start


```ts
// app/Panels/Admin/AdminPanel.ts
import { Panel, Heading, Stats, Stat } from '@boostkit/panels'
import { Dashboard, Widget } from '@boostkit/dashboards'

export const adminPanel = Panel.make('admin')
  .path('/admin')
  .resources([UserResource, ArticleResource])
  .schema(async (ctx) => [
    Heading.make('Welcome back'),

    // Standalone widgets (static, no customization)
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
        Widget.make('total-users')
          .label('Total Users')
          .component('stat')
          .small()
          .icon('users')
          .data(async () => ({ value: await User.query().count(), trend: 12 })),

        Widget.make('revenue')
          .label('Monthly Revenue')
          .component('chart')
          .large()
          .data(async () => ({
            type: 'bar',
            labels: ['Jan', 'Feb', 'Mar', 'Apr'],
            datasets: [{ label: 'Revenue', data: [4200, 5800, 4900, 7100] }],
          })),
      ]),
  ])
```

```ts
// bootstrap/providers.ts
import { panels } from '@boostkit/panels'
import { dashboard } from '@boostkit/dashboards'
import { adminPanel } from '../app/Panels/Admin/AdminPanel.js'

export default [
  panels([adminPanel]),
  dashboard(),    // no config -- auto-discovers Dashboard.make() from panel schemas
  // ...
]
```

---

## Standalone Widgets

Widgets placed directly in `Panel.schema()` (outside a `Dashboard`) render as static, SSR'd elements -- no drag, no customize. Consecutive standalone widgets auto-group into a responsive 12-column grid. Width is controlled by `.defaultSize({ w })`.

```ts
.schema(async (ctx) => [
  // These render as a static grid row
  Widget.make('users').label('Users').component('stat').defaultSize({ w: 4, h: 2 })
    .data(async () => ({ value: 150 })),
  Widget.make('articles').label('Articles').component('stat').defaultSize({ w: 4, h: 2 })
    .data(async () => ({ value: 42 })),
  Widget.make('comments').label('Comments').component('stat').defaultSize({ w: 4, h: 2 })
    .data(async () => ({ value: 389 })),
])
```

---

## Dashboard Sections

Multiple `Dashboard.make()` instances in schema render as separate sections (not tabs):

```
Overview          [Customize]
[widget grid]

Analytics         [Customize]
[widget grid]
```

Each section has its own Customize button and independent layout persistence.

---

## Dashboard with Tabs

```ts
Dashboard.make('main')
  .label('Main')
  .widgets([...])                  // always visible above tabs
  .tabs([
    Dashboard.tab('content').label('Content').widgets([...]),
    Dashboard.tab('charts').label('Charts').widgets([...]),
  ])
```

Top-level `.widgets()` render above the tab bar. Each tab has its own widget grid. Tab layouts are persisted independently.

---

## Widget API

```ts
Widget.make('widget-id')
  .label('Display Name')              // shown in dashboard and palette
  .component('stat')                  // 'stat' | 'chart' | 'table' | 'list' | 'stat-progress' | 'user-card' | 'custom'
  .defaultSize({ w: 6, h: 2 })       // 12-col grid: w=columns, h=row units
  .minSize({ w: 3, h: 2 })           // optional resize constraints
  .maxSize({ w: 12, h: 6 })
  .icon('file-text')                  // lucide icon name or emoji
  .description('Optional tooltip')
  .data(async (ctx, settings) => ({   // async data resolver
    value: 42,
    trend: 5,
  }))
  .settings([                         // per-widget configurable fields
    { name: 'period', type: 'select', options: ['7d', '30d'], default: '30d' },
    { name: 'showTrend', type: 'toggle', default: true },
  ])
  .lazy()                             // defer data loading to client-side
  .poll(10000)                        // re-fetch every 10s after SSR
  .render('/app/widgets/Custom')      // custom React component (sets component to 'custom')
```

### Size Presets

Shorthand methods for common sizes:

```ts
.small()    // { w: 3, h: 2 }
.medium()   // { w: 6, h: 2 }
.large()    // { w: 12, h: 3 }
```

Or use `.defaultSize({ w, h })` for custom sizes on the 12-column grid.

### Size Constraints

```ts
.minSize({ w: 3, h: 2 })    // minimum resize dimensions
.maxSize({ w: 12, h: 6 })   // maximum resize dimensions
```

---

## Widget Components

| Component | Data shape | Description |
|---|---|---|
| `stat` | `{ value, trend?, description? }` | Number card with optional trend arrow |
| `stat-progress` | `{ value, max, label?, color? }` | Circular progress ring |
| `chart` | `{ type, labels, datasets, height? }` | Recharts (line/bar/area/pie/doughnut) |
| `table` | `{ columns, records, href }` | Data table with link |
| `list` | `{ items, limit? }` | Item list with icons/links |
| `user-card` | `{ name, role?, avatar?, href? }` | Avatar card |
| `custom` | any | Custom React component via `.render()` |

---

## Widget Rendering Modes

| Mode | API | Behavior |
|---|---|---|
| SSR (default) | no flag | Data resolved server-side, renders instantly |
| Lazy | `.lazy()` | Shows skeleton, fetches data client-side |
| Polling | `.poll(ms)` | SSR first render, then re-fetches every N ms |

```ts
// SSR -- default, data resolved before page load
Widget.make('users').component('stat').data(async () => ({ value: 42 }))

// Lazy -- skeleton on first render, fetches client-side
Widget.make('slow-query').component('table').lazy()
  .data(async () => ({ columns: [...], records: await expensiveQuery() }))

// Polling -- SSR first, then refresh every 10 seconds
Widget.make('active-now').component('stat').poll(10000)
  .data(async () => ({ value: await getActiveUsers() }))
```

---

## Widget Settings

Widgets can have configurable fields. Users edit them via a drawer in customize mode.

```ts
Widget.make('revenue-chart')
  .label('Revenue')
  .component('chart')
  .settings([
    { name: 'period', type: 'select', label: 'Period', options: ['7d', '30d', '90d'], default: '30d' },
    { name: 'showTrend', type: 'toggle', label: 'Show Trend', default: true },
  ])
  .data(async (ctx, settings) => {
    const days = parseInt(settings.period)
    const records = await Revenue.query().where('date', '>=', daysAgo(days)).get()
    return {
      type: 'bar',
      labels: records.map(r => r.date),
      datasets: [{ label: 'Revenue', data: records.map(r => r.amount) }],
    }
  })
```

Setting field types: `text`, `number`, `select`, `toggle`.

---

## Icons

Supports lucide icon names (kebab-case) and emoji:

```ts
.icon('file-text')    // lucide icon
.icon('newspaper')    // lucide icon
.icon('users')        // lucide icon
.icon('📊')           // emoji
```

---

## Drag-and-Drop

Uses `@dnd-kit/sortable` for reordering widgets. In customize mode:

1. **Drag handle** -- 6-dot grip icon to reorder
2. **Size presets** -- `1/4` `1/3` `1/2` `2/3` `Full` buttons
3. **Settings** -- gear icon (shown when widget has settings)
4. **Remove** -- remove widget from layout
5. **Add Widget** -- palette to add available widgets

Click "Customize" to enter edit mode, "Done" to save.

---

## Layout Persistence

Per-user layout saved to the `PanelDashboardLayout` database table. Each dashboard + tab gets its own layout keyed by `userId + panel + dashboardId`.

```prisma
model PanelDashboardLayout {
  id          String   @id @default(cuid())
  userId      String
  panel       String
  dashboardId String   @default("default")
  layout      String   @default("[]")
  updatedAt   DateTime @updatedAt

  @@unique([userId, panel, dashboardId])
}
```

Then run:

```bash
pnpm exec prisma generate
pnpm exec prisma db push
```

Both widget data AND saved layout are resolved server-side in `resolveSchema()`. No loading flash -- the dashboard renders with the user's customized layout instantly.

---

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `{panel}/api/_dashboard/{dashId}/widgets` | GET | Widgets with resolved data |
| `{panel}/api/_dashboard/{dashId}/layout` | GET | User's saved layout |
| `{panel}/api/_dashboard/{dashId}/layout` | PUT | Save user's layout |

---

## Peer Dependencies

```bash
pnpm add @boostkit/dashboards @boostkit/panels @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities recharts
```

| Dependency | Purpose |
|---|---|
| `@boostkit/panels` | Panel infrastructure and widget rendering |
| `@dnd-kit/core` | Drag-and-drop primitives |
| `@dnd-kit/sortable` | Sortable grid layout |
| `@dnd-kit/utilities` | DnD utility hooks |
| `recharts` | Chart rendering (line/bar/area/pie/doughnut) |
