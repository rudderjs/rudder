# Custom Pages

Register custom pages alongside resources. They appear in the sidebar/topbar nav in the order defined -- resources first, then pages.

---

## Defining Pages

```ts
// app/Panels/Admin/pages/DashboardPage.ts
import { Page } from '@boostkit/panels'

export class DashboardPage extends Page {
  static slug  = 'dashboard'     // URL slug — defaults to class name sans "Page", lowercased
  static label = 'Dashboard'    // nav label — defaults to class name sans "Page", title-cased
  static icon  = 'layout-dashboard'  // optional lucide icon shown in nav
}
```

```ts
// app/Panels/Admin/AdminPanel.ts
export const adminPanel = Panel.make('admin')
  .resources([UserResource, TodoResource])
  .pages([DashboardPage, SettingsPage])
```

The `Page` class controls nav metadata only. The actual UI is a standard Vike page you create yourself after publishing.

The panel layout (`AdminLayout`) is applied automatically -- your page just returns its content:

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

To replace the default table for a specific resource, create a Vike page at the resource's static path. Vike's route priority makes static segments win over dynamic ones -- your page is served instead of the built-in table.

```
pages/(panels)/@panel/users/+Page.tsx    <- custom index for 'users'
pages/(panels)/@panel/users/+data.ts
```

The panel layout (`AdminLayout`) is applied automatically -- your page just returns its content.

Use `resourceData()` to fetch panel data without duplicating the built-in query logic:

```ts
// pages/(panels)/@panel/users/+data.ts
import { resourceData } from '@boostkit/panels'
import type { PageContextServer } from 'vike/types'

export type Data = Awaited<ReturnType<typeof resourceData>>

export async function data(pageContext: PageContextServer) {
  const { panel } = pageContext.routeParams as { panel: string }
  return resourceData({ panel, resource: 'users', url: pageContext.urlOriginal })
}
```

```tsx
// pages/(panels)/@panel/users/+Page.tsx
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

`resourceData()` applies the same sort / search / filter / pagination logic as the default table -- search, sort, and filters all work out of the box.

---

## Panel Schema (Landing Page)

By default, visiting the panel root (e.g. `/admin`) redirects to the first resource. Use `.schema()` to render a custom landing page instead.

```ts
import { Panel, Heading, Text, Stats, Stat, Table } from '@boostkit/panels'

Panel.make('admin')
  .schema(async (ctx) => [
    Heading.make('Welcome back'),
    Text.make(`Logged in as ${ctx.user?.email ?? 'guest'}`),

    Stats.make([
      Stat.make('Users').value(await User.query().count()),
      Stat.make('Articles').value(await Article.query().count()),
    ]),

    Table.make('Recent Articles')
      .resource('articles')
      .columns(['title', 'status', 'publishedAt'])
      .sortBy('createdAt', 'DESC')
      .limit(5),
  ])
```

The function receives `PanelContext` (`{ user, headers, path }`) and can be `async`. For a static schema (no context needed), pass an array directly:

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
| `Stat.make(label)` | Single stat -- `.value(n)`, `.description(text)`, `.trend('up'\|'down'\|'neutral')` |
| `Table.make(title)` | Data table -- `.resource(slug)`, `.columns([...])`, `.limit(n)`, `.sortBy(col, dir)` |
