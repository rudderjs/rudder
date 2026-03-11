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
import { Resource, TextField, EmailField, SelectField, DateField, SelectFilter, Action } from '@boostkit/panels'
import { User } from '../../Models/User.js'

export class UserResource extends Resource {
  static model = User
  static label = 'Users'
  static labelSingular = 'User'
  static titleField = 'name'   // used as show page heading, breadcrumbs, and relation displays

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
| `PasswordField` | `<input type="password">` |
| `NumberField` | `<input type="number">` |
| `TextareaField` | `<textarea>` |
| `SelectField` | Dropdown (single or multi) |
| `BooleanField` | Checkbox |
| `ToggleField` | Toggle switch |
| `DateField` | Date / datetime picker |
| `SlugField` | Slug input with auto-generation from a source field |
| `TagsField` | Multi-value tag input |
| `ColorField` | Color picker |
| `HiddenField` | Hidden form value |
| `JsonField` | JSON code editor |
| `FileField` | File upload |
| `RelationField` | BelongsTo / belongsToMany relation select |
| `HasMany` | Reverse relation table on the show page |
| `RepeaterField` | Repeating group of fields |
| `BuilderField` | Block-based content builder |

All field types share a fluent base API:

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

## Layout Grouping

Group fields into visual sections or tabs using `Section` and `Tabs`. Both can be mixed freely with plain fields in `fields()`.

### Section

A titled card — optionally collapsible and multi-column:

```ts
import { Section, TextField, TextareaField, FileField } from '@boostkit/panels'

fields() {
  return [
    Section.make('Content')
      .schema(
        TextField.make('title').required(),
        TextareaField.make('excerpt').rows(3),
        FileField.make('coverImage').image().disk('public').directory('articles'),
      ),

    Section.make('SEO')
      .description('Search engine optimization settings')
      .collapsible()
      .collapsed()           // starts collapsed
      .schema(
        TextField.make('metaTitle'),
        TextareaField.make('metaDescription').rows(2),
      ),

    Section.make('Publishing')
      .columns(2)            // 1 (default) | 2 | 3
      .schema(
        SelectField.make('status').options(['draft', 'published']),
        DateField.make('publishedAt').withTime(),
      ),
  ]
}
```

| Method | Description |
|--------|-------------|
| `Section.make(title)` | Create a section with the given title |
| `.description(text)` | Subtitle shown below the title |
| `.collapsible()` | Allow expanding / collapsing |
| `.collapsed()` | Start collapsed (implies collapsible) |
| `.columns(n)` | Field grid: `1` (default), `2`, or `3` columns |
| `.schema(...fields)` | Fields in this section |

### Tabs

Divide fields into tabs within a single card:

```ts
import { Tabs, TextField, TextareaField } from '@boostkit/panels'

fields() {
  return [
    Tabs.make()
      .tab('General',
        TextField.make('name').required(),
        TextareaField.make('bio'),
      )
      .tab('Preferences',
        SelectField.make('theme').options(['light', 'dark']),
        BooleanField.make('newsletter'),
      ),
  ]
}
```

| Method | Description |
|--------|-------------|
| `Tabs.make()` | Create a tabs group |
| `.tab(label, ...fields)` | Add a tab with the given label and fields |

---

## File Uploads

Use `FileField` to upload files directly from the admin form. Files are uploaded to the panel's `/_upload` endpoint (auto-mounted) and stored via `@boostkit/storage`.

```ts
import { FileField } from '@boostkit/panels'

FileField.make('coverImage')
  .label('Cover Image')
  .image()               // shows thumbnail preview; sets type to 'image'
  .accept('image/*')     // MIME type filter
  .maxSize(5)            // max file size in MB (default: 10)
  .disk('public')        // storage disk (default: 'local')
  .directory('articles') // storage subdirectory (default: 'uploads')
```

**For public-facing files** (images, PDFs shown in the browser), use the `public` disk and set up the symlink once:

```bash
pnpm artisan storage:link
```

This links `public/storage → storage/app/public`. Vite serves it as static assets — no API route needed. See [`@boostkit/storage`](../storage) for full configuration.

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

The page class controls only nav metadata (slug, label, icon). The actual UI is a standard Vike page at `pages/(panels)/@panel/dashboard/+Page.tsx` — create it after publishing the panels pages.

The panel layout (`AdminLayout`) is applied automatically by the shared `+Layout.tsx` — your page just returns its content:

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

Use `resourceData()` in `+data.ts` to fetch the same data the default table uses:

```ts
// pages/(panels)/@panel/users/+data.ts
import { resourceData } from '@boostkit/panels'
import type { PageContextServer } from 'vike/types'

export type Data = Awaited<ReturnType<typeof resourceData>>

export async function data(pageContext: PageContextServer) {
  const { panel, resource } = pageContext.routeParams as { panel: string; resource: string }
  return resourceData({
    panel,                         // panel path segment, e.g. 'admin'
    resource,                      // resource slug, e.g. 'users'
    url: pageContext.urlOriginal,  // full URL — used to parse sort/search/filter/page
  })
}
```

**`ResourceDataResult`** fields: `panelMeta`, `resourceMeta`, `records`, `pagination`, `pathSegment`, `slug`.

The URL query params `resourceData()` honours: `?page`, `?perPage`, `?sort`, `?dir`, `?search`, `?filter[field]` — identical to the default table. See the [full reference](https://boostkitjs.dev/guide/panels#resourcedata) in the docs.

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

> **Note:** `CustomFieldRenderers.tsx` is a published file you own. Re-publishing with `--force` will overwrite it — back it up or commit it before upgrading `@boostkit/panels`.

---

## Filters

```ts
import { SelectFilter } from '@boostkit/panels'

// Simple — default column=value equality
SelectFilter.make('status')
  .label('Status')
  .column('status')     // column name (defaults to filter name)
  .options([
    { label: 'Draft',     value: 'draft' },
    { label: 'Published', value: 'published' },
  ])
```

### Custom Query

Use `.query(fn)` when the default equality check isn't enough. The callback receives the raw ORM query builder and the selected value:

```ts
SelectFilter.make('status')
  .options([...])
  .query((q, value) => {
    q.where('status', value)
    if (value === 'published') q.where('publishedAt', '!=', null)
  })

// Date range
SelectFilter.make('period')
  .label('Period')
  .options([
    { label: 'Last 7 days',  value: '7d' },
    { label: 'Last 30 days', value: '30d' },
  ])
  .query((q, value) => {
    const days = value === '7d' ? 7 : 30
    q.where('createdAt', '>=', new Date(Date.now() - days * 86400000))
  })
```

Without `.query()`, the filter applies `WHERE column = value` using the filter name (or `.column()`) as the column.

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

`ctx` contains `user`, `headers`, and `path`. Returning `false` redirects unauthenticated users to `/login?redirect=<encodedPath>` for UI requests, and responds with `401 Unauthorized` for API requests.

**Accessing custom user fields** — if your guard (or resource policy) references a custom field like `ctx.user?.role`, you must declare it in `user.additionalFields` in `config/auth.ts`. Without this declaration the field is `undefined` even if it exists in the database:

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

Override `policy()` per resource for fine-grained access:

```ts
async policy(action: PolicyAction, ctx: PanelContext): Promise<boolean> {
  if (action === 'delete') return ctx.user?.role === 'admin'
  return true
}
```

`PolicyAction`: `'viewAny' | 'view' | 'create' | 'update' | 'delete'`

---

## API Routes

For each resource, the following routes are automatically mounted:

| Method | Path | Description |
|---|---|---|
| `GET` | `/{panel}/api/_meta` | Panel + resource schema |
| `GET` | `/{panel}/api/{resource}` | List (paginated, searchable, sortable, filterable) |
| `GET` | `/{panel}/api/{resource}/:id` | Show |
| `POST` | `/{panel}/api/{resource}` | Create |
| `PUT` | `/{panel}/api/{resource}/:id` | Update |
| `DELETE` | `/{panel}/api/{resource}/:id` | Delete |
| `POST` | `/{panel}/api/{resource}/_action/:action` | Bulk action |
| `POST` | `/{panel}/api/_upload` | File upload (used by FileField) |
| `GET` | `/{panel}/api/{resource}/_options` | Relation select options — used by RelationField |
| `GET` | `/{panel}/api/{resource}/_schema` | Field definitions — used for inline create dialog |
| `GET` | `/{panel}/api/{resource}/_related` | HasMany records — `?fk=col&id=val[&through=true]` |

The `GET` list endpoint supports:
- `?page=1&perPage=15` — pagination
- `?search=foo` — search across `.searchable()` fields (LIKE)
- `?sort=name&dir=ASC` — sort by `.sortable()` field
- `?filter[field]=value` — apply filters
