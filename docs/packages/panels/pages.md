# Custom Pages

Register custom pages alongside resources. Pages appear in the sidebar/topbar nav and live at `/{panel}/{slug}`.

---

## Defining Pages

```ts
// app/Panels/Admin/pages/DashboardPage.ts
import { Page } from '@boostkit/panels'

export class DashboardPage extends Page {
  static slug  = 'dashboard'          // URL slug — defaults to class name sans "Page", lowercased
  static label = 'Dashboard'         // nav label — defaults to class name sans "Page", title-cased
  static icon  = 'layout-dashboard'  // optional lucide icon shown in nav
}
```

```ts
// app/Panels/Admin/AdminPanel.ts
export const adminPanel = Panel.make('admin')
  .resources([UserResource, TodoResource])
  .pages([DashboardPage, ReportsPage])
```

Resources and globals appear first in the nav, then pages — in the order listed.

---

## Schema-Based Pages

Pages can define their content entirely via a `schema()` method — no Vike page file needed. The method receives `PanelContext` and can be async.

```ts
import { Page, Heading, Text, Stats, Stat, Chart } from '@boostkit/panels'
import type { PanelContext } from '@boostkit/panels'
import { User } from '../../../Models/User.js'

export class ReportsPage extends Page {
  static slug  = 'reports'
  static label = 'Reports'
  static icon  = 'bar-chart-3'

  static async schema({ user, params }: PanelContext) {
    return [
      Heading.make('Reports'),
      Text.make(`Welcome, ${user?.name ?? 'guest'}`),

      Stats.make([
        Stat.make('Total Users').value(await User.query().count()),
      ]),

      Chart.make('Monthly Signups')
        .chartType('bar')
        .labels(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'])
        .datasets([{ label: 'Signups', data: [12, 19, 8, 25, 14, 22] }]),
    ]
  }
}
```

The `schema()` method is called server-side on every page visit, so it can run ORM queries and access request context freely.

### Alternative: `define()`

For inline or programmatic definitions, use `static { this.define(def) }` instead of overriding `schema()`:

```ts
export class ReportsPage extends Page {
  static slug = 'reports'

  static {
    this.define(async ({ user }) => [
      Heading.make('Reports'),
      Text.make(`Logged in as ${user?.email ?? 'guest'}`),
    ])
  }
}
```

Both patterns are equivalent — `define()` stores the function internally and `schema()` calls it. Override `schema()` when the class structure reads more naturally; use `define()` for one-liners.

---

## Route Params

Page slugs can include route parameters. Params are extracted and passed to `schema()` via `ctx.params`.

```ts
export class OrderPage extends Page {
  static slug = 'orders/:id'   // required param

  static async schema({ params }: PanelContext) {
    const order = await Order.find(params.id!)
    return [
      Heading.make(`Order #${params.id}`),
      // ...
    ]
  }
}
```

### Optional Params

Suffix a param with `?` to make it optional. The segment (and its leading `/`) is omitted when not present:

```ts
export class ReportsPage extends Page {
  static slug = 'reports/:section?'

  static async schema({ params }: PanelContext) {
    // params.section is string | undefined
    return [
      Heading.make(params.section ? `Reports › ${params.section}` : 'Reports'),
    ]
  }
}
```

### Multi-Segment Slugs

Slugs can span multiple URL segments — mix static segments, required params, and optional params freely:

```ts
// /admin/orders/123/items/5
export class OrderItemPage extends Page {
  static slug = 'orders/:id/items/:itemId?'
}
```

| Slug pattern | URL | `params` |
|---|---|---|
| `orders/:id` | `/admin/orders/123` | `{ id: '123' }` |
| `reports/:section?` | `/admin/reports` | `{}` |
| `reports/:section?` | `/admin/reports/traffic` | `{ section: 'traffic' }` |
| `orders/:id/items/:n?` | `/admin/orders/1/items` | `{ id: '1' }` |
| `orders/:id/items/:n?` | `/admin/orders/1/items/5` | `{ id: '1', n: '5' }` |

---

## PanelContext

`schema()` receives a `PanelContext` object:

```ts
interface PanelContext {
  user:    PanelUser | undefined           // authenticated user (from panel guard)
  headers: Record<string, string>          // request headers
  path:    string                          // full URL path
  params:  Record<string, string | undefined>  // extracted route params
}
```

---

## Schema Elements

| Class | Description |
|---|---|
| `Heading.make(text)` | Section heading. `.level(1\|2\|3)` controls size (default: `1`) |
| `Text.make(content)` | Paragraph of text |
| `Stats.make([...stats])` | Row of stat cards |
| `Stat.make(label)` | Single stat — `.value(n)`, `.description(text)`, `.trend('up'\|'down'\|'neutral')` |
| `Chart.make(title)` | Chart — `.chartType('bar'\|'line'\|'area'\|'pie')`, `.labels([...])`, `.datasets([...])` |
| `Table.make(title)` | Data table — `.resource(slug)`, `.columns([...])`, `.limit(n)`, `.sortBy(col, dir)` |
| `List.make(title)` | Link list — `.items([{ label, href, icon }])` |
| `Tabs.make()` | Tab-navigated groups — `.tab(label, ...elements)` |

---

## Sub-Pages

Pages can register child pages via `static pages = [...]`. Sub-page slugs are relative to the parent — the framework builds the full URL automatically.

```ts
// Parent page
export class TablesDemo extends Page {
  static slug = 'tables-demo'
  static label = 'Tables Demo'
  static icon = 'table'
  static pages = [PaginationDemo, ExternalDataDemo]

  static async schema() { ... }
}

// Sub-page — slug is relative (tables-demo/pagination)
export class PaginationDemo extends Page {
  static slug = 'pagination'
  static label = 'Pagination'
  static icon = 'list'

  static async schema() { ... }
}
```

The sidebar renders sub-pages as a collapsible tree:

```
Pages
  Tables Demo          → /admin/tables-demo
    ├── Pagination     → /admin/tables-demo/pagination
    └── External Data  → /admin/tables-demo/external-data
  Tabs Demo
  Forms Demo
```

### Key Points

- `static pages = [...]` — structural: parent owns children, relative slugs, auto URL nesting
- Sub-pages can have their own sub-pages (recursive)
- Dynamic slugs with params work on sub-pages (e.g. `static slug = 'item/:id'`)
- Only top-level pages need to be registered in `Panel.pages([...])`

### Visual-Only Nesting (navigationParent)

For sidebar grouping without structural ownership, use `static navigationParent`. The page keeps its own URL — only the sidebar position changes:

```ts
export class FormsDemo extends Page {
  static slug = 'forms-demo'              // keeps its own URL: /admin/forms-demo
  static navigationParent = 'Tables Demo' // just sidebar nesting
}
```

| Property | Structural? | URL | Sidebar |
|---|---|---|---|
| `static pages = [...]` | Yes — parent owns children | Relative slug appended to parent | Collapsible tree |
| `static navigationParent` | No — visual only | Page keeps its own slug | Nested under named parent |

---

## Vike-Backed Pages

Pages without a `schema()` method render via a Vike page file. Create `+Page.tsx` at the static path after publishing:

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

The panel layout (`AdminLayout`) is applied automatically via the shared `+Layout.tsx` — your page just returns its content.

---

## Custom Resource Views

To replace the default table for a specific resource, create a Vike page at the resource's static path under `resources/`. Vike's route priority makes static segments win over dynamic `@resource`:

```
pages/(panels)/@panel/resources/users/+Page.tsx    ← custom index for 'users'
pages/(panels)/@panel/resources/users/+data.ts
```

Use `resourceData()` to fetch panel data without duplicating the built-in query logic:

```ts
// pages/(panels)/@panel/resources/users/+data.ts
import { resourceData } from '@boostkit/panels'
import type { PageContextServer } from 'vike/types'

export type Data = Awaited<ReturnType<typeof resourceData>>

export async function data(pageContext: PageContextServer) {
  const { panel } = pageContext.routeParams as { panel: string }
  return resourceData({ panel, resource: 'users', url: pageContext.urlOriginal })
}
```

```tsx
// pages/(panels)/@panel/resources/users/+Page.tsx
import { useData } from 'vike-react/useData'
import type { Data } from './+data.js'

export default function UsersGridPage() {
  const { resourceMeta, records } = useData<Data>()
  return (
    <div className="grid grid-cols-3 gap-4">
      {(records as any[]).map((r) => (
        <div key={r.id} className="rounded-lg border p-4">{r.name}</div>
      ))}
    </div>
  )
}
```

`resourceData()` applies the same sort / search / filter / pagination logic as the default table — `?page`, `?perPage`, `?sort`, `?dir`, `?search`, `?filter[field]` all work out of the box.
