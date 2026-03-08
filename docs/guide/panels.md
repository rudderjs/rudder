# Panels

`@boostkit/panels` provides a multi-panel admin and user-facing dashboard system. Define resources with typed fields, filters, and actions — BoostKit auto-generates the CRUD API and a fully functional UI.

Inspired by Filament PHP, Laravel Nova, and Payload CMS.

## Installation

```bash
pnpm add @boostkit/panels
```

## Quick Start

**1. Define a resource:**

```ts
// app/Panels/Admin/resources/UserResource.ts
import { Resource, TextField, EmailField, BooleanField, DateField } from '@boostkit/panels'
import { User } from '../../Models/User.js'

export class UserResource extends Resource {
  static model = User
  static label = 'Users'
  static icon  = 'users'

  fields() {
    return [
      TextField.make('name').label('Name').required().searchable().sortable(),
      EmailField.make('email').label('Email').required().searchable(),
      BooleanField.make('active').label('Active'),
      DateField.make('createdAt').label('Created').readonly().hideFromCreate().hideFromEdit(),
    ]
  }
}
```

**2. Create a panel:**

```ts
// app/Panels/Admin/AdminPanel.ts
import { Panel } from '@boostkit/panels'
import { UserResource } from './resources/UserResource.js'

export const adminPanel = Panel.make('admin')
  .path('/admin')
  .branding({ title: 'My Admin' })
  .resources([UserResource])
```

**3. Register the panel:**

```ts
// bootstrap/providers.ts
import { panels } from '@boostkit/panels'
import { adminPanel } from '../app/Panels/Admin/AdminPanel.js'

export default [
  // ...other providers...
  panels([adminPanel]),
]
```

**4. Publish the UI pages:**

```bash
pnpm artisan vendor:publish --tag=panels-pages
```

This copies the panel UI pages into your app under `pages/(panels)/`. Vike picks them up automatically — visit `/admin` in the browser.

---

## Multiple Panels

Register as many panels as you need — each gets its own path, guard, branding, and resources:

```ts
panels([adminPanel, customerPanel, partnerPortal])
```

The published UI pages are generic — one publish serves all panels. Visiting `/admin` loads the admin panel; `/customer` loads the customer panel.

---

## Panel Options

```ts
Panel.make('admin')
  .path('/admin')                     // URL prefix (default: /<name>)
  .branding({
    title:   'My Admin',
    logo:    '/logo.png',
    favicon: '/favicon.ico',
    colors:  { primary: '#4f46e5' },
  })
  .guard(async (ctx) => {             // runs before every request
    return ctx.user?.role === 'admin'
  })
  .resources([UserResource, PostResource])
```

The `guard` receives a `PanelContext` (`{ user, headers, path }`) and returns `true` to allow or `false` to reject with 401.

---

## Fields

All fields share a fluent API:

```ts
TextField.make('name')
  .label('Full Name')   // default: title-cased field name
  .required()           // validation + form asterisk
  .readonly()           // shown in forms but not editable
  .sortable()           // enables column sorting in table
  .searchable()         // included in table search
  .hideFromTable()      // hide from list view
  .hideFromCreate()     // hide from create form
  .hideFromEdit()       // hide from edit form
```

### Available Field Types

| Class | Type | Extra options |
|-------|------|---------------|
| `TextField` | `text` | `.minLength()`, `.maxLength()`, `.placeholder()` |
| `EmailField` | `email` | — |
| `NumberField` | `number` | `.min()`, `.max()`, `.step()` |
| `SelectField` | `select` | `.options(['a','b'])` or `.options([{label,value}])`, `.multiple()` |
| `BooleanField` | `boolean` | `.trueLabel()`, `.falseLabel()` |
| `DateField` | `date` / `datetime` | `.withTime()` → datetime input |
| `TextareaField` | `textarea` | `.rows(6)` |
| `RelationField` | `belongsTo` / `hasMany` | `.resource(UserResource)`, `.displayField('name')`, `.multiple()` |

---

## Filters

Filters appear above the resource table:

```ts
import { SelectFilter, SearchFilter } from '@boostkit/panels'

filters() {
  return [
    SelectFilter.make('status')
      .label('Status')
      .column('status')
      .options([
        { label: 'Active',   value: 'active' },
        { label: 'Inactive', value: 'inactive' },
      ]),

    SearchFilter.make('search')
      .label('Search')
      .columns(['name', 'email']),
  ]
}
```

---

## Actions

Actions run on selected records (bulk or single):

```ts
import { Action } from '@boostkit/panels'

actions() {
  return [
    Action.make('activate')
      .label('Activate')
      .icon('check')
      .bulk()
      .handler(async (records) => {
        for (const record of records as User[]) {
          await User.query().update(record.id, { active: true })
        }
      }),

    Action.make('delete')
      .label('Delete')
      .icon('trash')
      .destructive()
      .confirm('Are you sure you want to delete the selected records?')
      .bulk()
      .handler(async (records) => {
        for (const record of records as User[]) {
          await User.query().delete(record.id)
        }
      }),
  ]
}
```

| Option | Description |
|--------|-------------|
| `.bulk()` | Action appears when rows are selected (default: `true`) |
| `.destructive()` | Renders with red styling |
| `.confirm(message?)` | Shows a confirmation dialog before running |
| `.icon(name)` | Icon string passed to the UI |

---

## Authorization

Override `policy()` in your resource to control access per-action:

```ts
async policy(action: PolicyAction, ctx: PanelContext): Promise<boolean> {
  if (action === 'delete') return ctx.user?.role === 'admin'
  return true
}
```

`PolicyAction`: `'viewAny' | 'view' | 'create' | 'update' | 'delete'`

The API responds with 403 when `policy()` returns `false`.

---

## Auto-Generated API Routes

For each resource, `@boostkit/panels` mounts:

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/{panel}/api/_meta` | Panel + resource schema |
| `GET` | `/{panel}/api/{resource}` | Paginated list |
| `GET` | `/{panel}/api/{resource}/:id` | Single record |
| `POST` | `/{panel}/api/{resource}` | Create |
| `PUT` | `/{panel}/api/{resource}/:id` | Update |
| `DELETE` | `/{panel}/api/{resource}/:id` | Delete |
| `POST` | `/{panel}/api/{resource}/_action/:action` | Run bulk action |

---

## Resource Configuration

```ts
export class PostResource extends Resource {
  static model        = Post          // ORM model class
  static label        = 'Blog Posts'  // plural label (default: derived from class name)
  static labelSingular = 'Blog Post'  // singular label
  static slug         = 'posts'       // URL slug (default: kebab-case plural)
  static icon         = 'file-text'   // sidebar icon name

  fields() { return [...] }
  filters() { return [...] }   // optional
  actions() { return [...] }   // optional
}
```

---

## Customizing the UI

The published pages at `pages/(panels)/` are yours to edit. The UI is built with:

- **[Base UI](https://base-ui.com/)** — headless, accessible components
- **Tailwind CSS** — utility-first styling
- **Vike** — SSR file-based routing

All panel data is driven by the `/_meta` API endpoint — adding a new resource or field requires no UI changes.
