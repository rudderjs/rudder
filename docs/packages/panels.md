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
  static titleField      = 'name'            // show page heading, breadcrumbs, and relation displays
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
| `FileField` | file input | Upload a file via `@boostkit/storage` |
| `FileField.image()` | image upload | Upload an image — shows preview thumbnail |
| `RelationField` | select / chip multi-select | BelongsTo / belongsToMany relation |
| `HasMany` | — | Reverse relation table rendered on the show page |

## Form Layout Groupings

`Section` and `Tabs` group fields visually in create/edit forms. They are not fields — they don't appear in the table or the show view.

### Section

```ts
import { Section } from '@boostkit/panels'

Section.make('Personal Info')
  .description('Basic contact details')   // optional subtitle
  .collapsible()                          // allow user to collapse
  .collapsed()                            // start collapsed
  .columns(2)                             // 1 | 2 | 3 column grid
  .schema(
    TextField.make('firstName'),
    TextField.make('lastName'),
    EmailField.make('email'),
  )
```

### Tabs

```ts
import { Tabs } from '@boostkit/panels'

Tabs.make()
  .tab('General',
    TextField.make('title').required(),
    SlugField.make('slug').from('title'),
  )
  .tab('SEO',
    TextField.make('metaTitle'),
    TextareaField.make('metaDescription'),
  )
  .tab('Media',
    FileField.make('coverImage').image().disk('s3').directory('covers'),
  )
```

### Usage in a Resource

```ts
fields() {
  return [
    Section.make('Basic Info').schema(
      TextField.make('name').required(),
      EmailField.make('email').required().searchable(),
    ),
    Tabs.make()
      .tab('Settings', SelectField.make('role').options(['user', 'admin']))
      .tab('Danger Zone', BooleanField.make('suspended')),
  ]
}
```

---

## File Upload

`FileField` connects to `@boostkit/storage` via a panel-mounted upload endpoint (`POST /{panel}/api/_upload`).

```ts
import { FileField } from '@boostkit/panels'

FileField.make('avatar')
  .image()                        // show preview; changes type to 'image'
  .accept('image/*')             // MIME type filter
  .maxSize(5)                    // max file size in MB (default: 10)
  .disk('s3')                    // storage disk (default: 'local')
  .directory('avatars')          // upload path prefix (default: 'uploads')

FileField.make('resume')
  .accept('application/pdf')
  .maxSize(20)

FileField.make('gallery')
  .image()
  .multiple()                    // allow multiple files — value is string[]
```

`@boostkit/storage` must be installed and configured for uploads to work.

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

The `Page` class controls nav metadata only. The actual UI is a standard Vike page you create yourself after publishing.

The panel layout (`AdminLayout`) is applied automatically — your page just returns its content:

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

Returning `false` redirects unauthenticated users to `/login?redirect=<encodedPath>` for UI requests, and responds with `401 Unauthorized` for API requests.

**Accessing custom user fields** — if your guard references a custom field like `ctx.user?.role`, you must declare it in `user.additionalFields` in `config/auth.ts`. Without this declaration the field is `undefined` even if it exists in the database:

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
| `Stat.make(label)` | Single stat — `.value(n)`, `.description(text)`, `.trend('up'\|'down'\|'neutral')` |
| `Table.make(title)` | Data table — `.resource(slug)`, `.columns([...])`, `.limit(n)`, `.sortBy(col, dir)` |

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
| `POST` | `/{panel}/api/_upload` | File upload (used by FileField) |
| `GET` | `/{panel}/api/{resource}/_options` | Relation select options — used by RelationField |
| `GET` | `/{panel}/api/{resource}/_schema` | Field definitions — used for inline create dialog |
| `GET` | `/{panel}/api/{resource}/_related` | HasMany records — `?fk=col&id=val[&through=true]` |

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
