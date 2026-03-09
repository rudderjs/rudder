# @boostkit/panels

Admin panel builder for BoostKit. Define resources in TypeScript — the package auto-generates CRUD API routes and a polished React UI with two layout options (sidebar or topbar).

## Installation

```bash
pnpm add @boostkit/panels
```

---

## Setup

### 1. Define a Panel

```ts
// app/Panels/Admin/AdminPanel.ts
import { Panel } from '@boostkit/panels'
import { UserResource } from './resources/UserResource.js'
import { TodoResource } from './resources/TodoResource.js'

export const adminPanel = Panel.make('admin')
  .path('/admin')
  .branding({ title: 'My Admin' })
  .layout('sidebar')
  .guard(async (ctx) => ctx.user?.role === 'admin')
  .resources([UserResource, TodoResource])
```

### 2. Register the provider

```ts
// bootstrap/providers.ts
import { panels } from '@boostkit/panels'
import { adminPanel } from '../app/Panels/Admin/AdminPanel.js'

export default [
  panels([adminPanel]),
  // ...
]
```

### 3. Publish the UI pages

```bash
# First install
pnpm artisan vendor:publish --tag=panels-pages

# After upgrading @boostkit/panels — update to latest UI
pnpm artisan vendor:publish --tag=panels-pages --force
```

This copies the React pages into `pages/(panels)/` in your app.

---

## Defining Resources

```ts
// app/Panels/Admin/resources/UserResource.ts
import {
  Resource,
  TextField, EmailField, SelectField, DateField,
  SelectFilter,
  Action,
} from '@boostkit/panels'
import { User } from '../../Models/User.js'

export class UserResource extends Resource {
  static model         = User
  static label         = 'Users'
  static labelSingular = 'User'

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
      SelectFilter.make('role').label('Role').options([
        { label: 'User',  value: 'user' },
        { label: 'Admin', value: 'admin' },
      ]),
    ]
  }

  actions() {
    return [
      Action.make('suspend')
        .label('Suspend Users')
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

| Class | Input type | Description |
|---|---|---|
| `TextField` | `text` | Single-line text |
| `EmailField` | `email` | Email address |
| `NumberField` | `number` | Numeric input |
| `TextareaField` | `textarea` | Multi-line text |
| `SelectField` | dropdown | Predefined options |
| `BooleanField` | checkbox | True / false |
| `DateField` | `date` | Date picker |

### Shared fluent methods

```ts
TextField.make('name')
  .label('Full Name')       // display label (defaults to title-cased name)
  .required()               // required in create/edit forms
  .readonly()               // visible but not editable; excluded from payloads
  .sortable()               // clickable column header → ?sort=name&dir=ASC
  .searchable()             // included in search → WHERE name LIKE '%foo%'
  .hideFrom('table' | 'create' | 'edit' | 'view')
  .hideFromTable()
  .hideFromCreate()
  .hideFromEdit()
```

---

## Layout Options

```ts
Panel.make('admin').layout('sidebar')   // vertical sidebar nav (default)
Panel.make('admin').layout('topbar')    // horizontal top nav bar
```

Both layouts are built with Tailwind CSS design tokens (`bg-primary`, `text-muted-foreground`, etc.) and adapt to your shadcn theme automatically.

---

## Custom Pages

Register custom pages alongside resources. They appear in the sidebar/topbar nav in the order defined — resources first, then pages.

```ts
// app/Panels/Admin/pages/DashboardPage.ts
import { Page } from '@boostkit/panels'

export class DashboardPage extends Page {
  static slug  = 'dashboard'     // URL slug — defaults to class name sans "Page", lowercased
  static label = 'Dashboard'    // nav label — defaults to class name sans "Page", title-cased
  static icon  = '📊'           // optional emoji/icon shown in nav
}
```

```ts
// app/Panels/Admin/AdminPanel.ts
export const adminPanel = Panel.make('admin')
  .resources([UserResource, TodoResource])
  .pages([DashboardPage, SettingsPage])
```

The `Page` class controls nav metadata only. The actual UI is a standard Vike page you create yourself after publishing:

```tsx
// pages/(panels)/admin/dashboard/+Page.tsx
import { AdminLayout } from '../_components/AdminLayout.js'
import { useData }     from 'vike-react/useData'
import type { PanelMeta } from '@boostkit/panels'

export default function DashboardPage() {
  const { panelMeta } = useData<{ panelMeta: PanelMeta }>()
  return (
    <AdminLayout panelMeta={panelMeta} currentSlug="dashboard">
      <h1>Dashboard</h1>
      {/* your content */}
    </AdminLayout>
  )
}
```

You'll need a `+data.ts` to fetch `panelMeta`. The simplest approach is to call the `/_meta` endpoint:

```ts
// pages/(panels)/admin/dashboard/+data.ts
export async function data({ pageContext }: { pageContext: any }) {
  const origin   = pageContext.urlParsed.origin ?? 'http://localhost:3000'
  const response = await fetch(`${origin}/admin/api/_meta`)
  const panelMeta = await response.json()
  return { panelMeta }
}
```

---

## Search

Mark fields `.searchable()` to add a search bar to the list page. Submitting runs a `LIKE` query across all searchable columns (OR logic).

```ts
// URL: /admin/api/users?search=alice
TextField.make('name').searchable()
EmailField.make('email').searchable()
```

---

## Sort

Mark fields `.sortable()` to make column headers clickable. Clicking toggles `ASC → DESC`.

```ts
// URL: /admin/api/users?sort=name&dir=ASC
TextField.make('name').sortable()
```

---

## Filters

`SelectFilter` renders a `<select>` dropdown in the toolbar:

```ts
import { SelectFilter } from '@boostkit/panels'

// URL: /admin/api/users?filter[role]=admin
SelectFilter.make('role')
  .label('Role')
  .column('role')     // column name — defaults to filter name
  .options([
    { label: 'Admin', value: 'admin' },
    { label: 'User',  value: 'user' },
  ])
```

Multiple filters compose with AND logic.

---

## Bulk Actions

```ts
import { Action } from '@boostkit/panels'

Action.make('markComplete')
  .label('Mark as Complete')
  .bulk()                               // shows in selection bar
  .destructive()                        // red button styling
  .confirm('Mark selected as done?')    // opens confirm dialog
  .handler(async (records) => {
    for (const r of records as Todo[]) {
      await Todo.query().update(r.id, { completed: true })
    }
  })
```

---

## Guard

```ts
Panel.make('admin').guard(async (ctx) => {
  return ctx.user?.role === 'admin'
})
```

`ctx`:

| Property | Type | Description |
|---|---|---|
| `user` | `PanelUser \| undefined` | Authenticated user (from `req.user`) |
| `headers` | `Record<string, string>` | Request headers |
| `path` | `string` | Request path |

Returning `false` responds with `401 Unauthorized`.

---

## Branding

```ts
Panel.make('admin').branding({
  title:   'My App Admin',
  logo:    '/images/logo.svg',   // shown in sidebar/topbar instead of title
  favicon: '/favicon.ico',
})
```

---

## Auto-generated API Routes

For each resource, the following routes are mounted at boot:

| Method | Path | Description |
|---|---|---|
| `GET` | `/{panel}/api/{resource}` | List — paginated, searchable, sortable, filterable |
| `GET` | `/{panel}/api/{resource}/:id` | Show one record |
| `POST` | `/{panel}/api/{resource}` | Create |
| `PUT` | `/{panel}/api/{resource}/:id` | Update |
| `DELETE` | `/{panel}/api/{resource}/:id` | Delete |
| `POST` | `/{panel}/api/{resource}/_action/:name` | Run bulk action |

List query params:

| Param | Example | Description |
|---|---|---|
| `page` | `?page=2` | Page number (default: 1) |
| `perPage` | `?perPage=25` | Records per page (default: 15) |
| `search` | `?search=alice` | Search across `.searchable()` fields |
| `sort` | `?sort=name` | Sort column (must be `.sortable()`) |
| `dir` | `?dir=DESC` | Sort direction — `ASC` or `DESC` (default: `ASC`) |
| `filter[field]` | `?filter[role]=admin` | Apply a registered filter |

A `GET /{panel}/api/_meta` endpoint returns the full panel structure (resources, fields, filters, actions, layout) — consumed by the published React pages.
