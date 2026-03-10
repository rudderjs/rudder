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
  static model           = User
  static label           = 'Users'
  static labelSingular   = 'User'
  static defaultSort     = 'createdAt'       // default sort column
  static defaultSortDir  = 'DESC' as const   // applied when no ?sort in URL

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
| `PasswordField` | `password` | Masked input with optional confirm field |
| `SlugField` | `text` | URL slug, auto-generated from a source field |
| `TagsField` | chip input | Multi-value array of strings |
| `HiddenField` | `hidden` | Hidden form value, never shown in UI |
| `ToggleField` | switch | Boolean switch with on/off labels |
| `ColorField` | `color` | Native color picker with hex swatch in table |
| `JsonField` | textarea | JSON editor with inline validation |
| `RepeaterField` | repeater | Repeatable group of sub-fields (same schema) |
| `BuilderField` | block picker | Multiple block types each with own schema |
| `Block` | — | Block type definition for use with `BuilderField` |

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

## Custom Resource Views

To replace the default table for a specific resource, create a Vike page at the resource's static path. Vike's route priority makes static segments win over dynamic ones — your page is served instead of the built-in table.

```
pages/(panels)/@panel/users/+Page.tsx    ← custom index for 'users'
pages/(panels)/@panel/users/+data.ts
```

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
import { useData }     from 'vike-react/useData'
import { AdminLayout } from '../../_components/AdminLayout.js'
import type { Data }   from './+data.js'

export default function UsersGridPage() {
  const { panelMeta, resourceMeta, records } = useData<Data>()
  return (
    <AdminLayout panelMeta={panelMeta} currentSlug={resourceMeta.slug as string}>
      <div className="grid grid-cols-3 gap-4">
        {(records as any[]).map((r) => (
          <div key={r.id} className="rounded-lg border p-4">{r.name}</div>
        ))}
      </div>
    </AdminLayout>
  )
}
```

`resourceData()` applies the same sort / search / filter / pagination logic as the default table — search, sort, and filters all work out of the box.

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

Your custom component receives `{ field, value, onChange }` — the same props as built-in field renderers.

> **Note:** `CustomFieldRenderers.tsx` is a published file you own. Re-publishing with `--force` will overwrite it — back it up or commit it before upgrading `@boostkit/panels`.

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

## Actions

### Bulk actions

Appear in the multi-select bar when one or more rows are checked.

```ts
import { Action } from '@boostkit/panels'

Action.make('markComplete')
  .label('Mark as Complete')
  .bulk()                               // shows in selection bar (default: true)
  .destructive()                        // red button styling
  .confirm('Mark selected as done?')    // opens confirm dialog
  .handler(async (records) => {
    for (const r of records as Todo[]) {
      await Todo.query().update(r.id, { completed: true })
    }
  })
```

### Row actions

Appear as inline buttons on each table row.

```ts
Action.make('impersonate')
  .label('Login as user')
  .row()                                // appears per-row in the table
  .handler(async (records) => {
    const user = records[0] as User
    // ... impersonate logic
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
