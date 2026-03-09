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

---

## Defining Resources

```ts
import { Resource, TextField, EmailField, SelectField, BooleanField, DateField, SelectFilter, Action } from '@boostkit/panels'
import { User } from '../../Models/User.js'

export class UserResource extends Resource {
  static model = User
  static label = 'Users'
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
| `NumberField` | `<input type="number">` |
| `TextareaField` | `<textarea>` |
| `SelectField` | Dropdown |
| `BooleanField` | Checkbox |
| `DateField` | Date picker |

All field types support the same fluent methods:

```ts
TextField.make('name')
  .label('Full Name')   // display label (defaults to title-cased name)
  .required()           // required in create/edit forms
  .readonly()           // show in form, not editable; excluded from payloads
  .sortable()           // allow sorting by this column in the table
  .searchable()         // include in global search (LIKE query)
  .hideFrom('table' | 'create' | 'edit' | 'view')
  .hideFromTable()
  .hideFromCreate()
  .hideFromEdit()
```

---

## Layout Options

```ts
Panel.make('admin').layout('sidebar')   // vertical sidebar (default)
Panel.make('admin').layout('topbar')    // horizontal top navigation
```

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

The page class controls only nav metadata (slug, label, icon). The actual UI is a standard Vike page at `pages/(panels)/@panel/dashboard/+Page.tsx` — create it after publishing the panels pages:

```tsx
// pages/(panels)/admin/dashboard/+Page.tsx
import { AdminLayout } from '../_components/AdminLayout.js'
import { useData }     from 'vike-react/useData'

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

---

## Filters

```ts
import { SelectFilter } from '@boostkit/panels'

// URL: /admin/api/users?filter[role]=admin
SelectFilter.make('role')
  .label('Role')
  .column('role')       // column name (defaults to filter name)
  .options([
    { label: 'Admin', value: 'admin' },
    { label: 'User',  value: 'user' },
  ])
```

---

## Search & Sort

The list page sends `?search=foo` and `?sort=name&dir=ASC` query params automatically when:
- Field is marked `.searchable()` — search input appears in toolbar
- Field is marked `.sortable()` — clicking column header sorts it

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

## Guard (Authorization)

```ts
Panel.make('admin').guard(async (ctx) => {
  return ctx.user?.role === 'admin'
})
```

`ctx` contains `user`, `headers`, and `path`. Returning `false` responds with `401 Unauthorized`.

---

## API Routes

For each resource, the following routes are automatically mounted:

| Method | Path | Description |
|---|---|---|
| `GET` | `/{panel}/api/{resource}` | List (paginated, searchable, sortable, filterable) |
| `GET` | `/{panel}/api/{resource}/:id` | Show |
| `POST` | `/{panel}/api/{resource}` | Create |
| `PUT` | `/{panel}/api/{resource}/:id` | Update |
| `DELETE` | `/{panel}/api/{resource}/:id` | Delete |
| `POST` | `/{panel}/api/{resource}/_action/:action` | Bulk action |

The `GET` list endpoint supports:
- `?page=1&perPage=15` — pagination
- `?search=foo` — search across `.searchable()` fields (LIKE)
- `?sort=name&dir=ASC` — sort by `.sortable()` field
- `?filter[field]=value` — apply filters
