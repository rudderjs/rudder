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

All fields share a fluent base API:

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
| `PasswordField` | `password` | — |
| `NumberField` | `number` | `.min()`, `.max()`, `.step()` |
| `TextareaField` | `textarea` | `.rows(6)` |
| `SelectField` | `select` | `.options(['a','b'])` or `.options([{label,value}])`, `.multiple()` |
| `BooleanField` | `boolean` | `.trueLabel()`, `.falseLabel()` |
| `ToggleField` | `toggle` | Toggle switch variant of boolean |
| `DateField` | `date` / `datetime` | `.withTime()` → datetime input |
| `SlugField` | `slug` | `.from('title')` — auto-generates from source field on create |
| `TagsField` | `tags` | Multi-value comma-separated tag input |
| `ColorField` | `color` | Color picker |
| `HiddenField` | `hidden` | Hidden form value, not shown in UI |
| `JsonField` | `json` | JSON code editor |
| `FileField` | `file` / `image` | `.image()`, `.disk()`, `.directory()`, `.accept()`, `.maxSize()`, `.multiple()` |
| `RelationField` | `belongsTo` / `hasMany` | `.resource(UserResource)`, `.displayField('name')`, `.multiple()` |
| `RepeaterField` | `repeater` | Repeating group of fields |
| `BuilderField` | `builder` | Block-based content builder |

---

## Layout Grouping

Group related fields into visual sections or tabs. Both can be freely mixed with plain fields in `fields()`.

### Section

A titled card — optionally collapsible and multi-column:

```ts
import { Section, TextField, TextareaField, SelectField, FileField } from '@boostkit/panels'

fields() {
  return [
    Section.make('Content')
      .schema(
        TextField.make('title').required().searchable(),
        TextareaField.make('excerpt').rows(3),
        FileField.make('coverImage').image().disk('public').directory('articles'),
      ),

    Section.make('Publishing')
      .columns(2)              // 1 (default) | 2 | 3
      .schema(
        SelectField.make('status').options(['draft', 'published']).required(),
        DateField.make('publishedAt').withTime(),
        ToggleField.make('featured').label('Featured'),
        ColorField.make('accentColor').label('Accent Color'),
      ),

    Section.make('SEO')
      .description('Optional. Leave blank to use defaults.')
      .collapsible()
      .collapsed()             // starts collapsed
      .schema(
        TextField.make('metaTitle'),
        TextareaField.make('metaDescription').rows(2),
      ),
  ]
}
```

| Method | Description |
|--------|-------------|
| `Section.make(title)` | Create a section with the given title |
| `.description(text)` | Subtitle shown below the section header |
| `.collapsible()` | Allow the section to be expanded/collapsed |
| `.collapsed()` | Start in collapsed state (implies collapsible) |
| `.columns(n)` | Field grid columns: `1` (default), `2`, or `3` |
| `.schema(...fields)` | Fields inside this section |

### Tabs

Divide fields into tabs within a single card:

```ts
import { Tabs } from '@boostkit/panels'

fields() {
  return [
    Tabs.make()
      .tab('General',
        TextField.make('name').required(),
        EmailField.make('email').required(),
      )
      .tab('Preferences',
        SelectField.make('theme').options(['light', 'dark']),
        BooleanField.make('newsletter').label('Subscribe to newsletter'),
      )
      .tab('Security',
        PasswordField.make('password').hideFromEdit(),
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

`FileField` uploads files directly from the admin form. Files are uploaded to the panel's `/_upload` endpoint (auto-mounted per panel) and stored via `@boostkit/storage`.

```ts
import { FileField } from '@boostkit/panels'

FileField.make('coverImage')
  .label('Cover Image')
  .image()               // shows thumbnail preview; type becomes 'image'
  .accept('image/*')     // MIME type filter
  .maxSize(5)            // max file size in MB (default: 10)
  .disk('public')        // storage disk (default: 'local')
  .directory('articles') // subdirectory within disk root (default: 'uploads')
```

### Public Disk (Recommended for Images)

Use the `public` disk so uploaded images are served as static assets — no API route needed:

**1. Configure the `public` disk in `config/storage.ts`:**

```ts
public: {
  driver:  'local',
  root:    path.resolve(process.cwd(), 'storage/app/public'),
  baseUrl: Env.get('APP_URL', 'http://localhost:3000') + '/storage',
},
```

**2. Create the symlink once:**

```bash
pnpm artisan storage:link
# Linked: public/storage → storage/app/public
```

Vite serves `public/` as static assets. Files at `storage/app/public/articles/photo.jpg` are immediately accessible at `/storage/articles/photo.jpg`.

**3. Use `.disk('public')` on your FileField:**

```ts
FileField.make('coverImage').image().disk('public').directory('articles')
```

Add to `.gitignore`:
```
storage/app/
public/storage
```

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
        { label: 'Published', value: 'published' },
        { label: 'Draft',     value: 'draft' },
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
    Action.make('publish')
      .label('Publish')
      .icon('check')
      .bulk()
      .handler(async (records) => {
        for (const record of records as Article[]) {
          await Article.query().update(record.id, { status: 'published' })
        }
      }),

    Action.make('delete')
      .label('Delete')
      .icon('trash')
      .destructive()
      .confirm('Are you sure you want to delete the selected records?')
      .bulk()
      .handler(async (records) => {
        for (const record of records as Article[]) {
          await Article.query().delete(record.id)
        }
      }),
  ]
}
```

| Option | Description |
|--------|-------------|
| `.bulk()` | Action appears when rows are selected |
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
| `POST` | `/{panel}/api/_upload` | File upload (used by FileField) |

---

## Resource Configuration

```ts
export class PostResource extends Resource {
  static model          = Post          // ORM model class
  static label          = 'Blog Posts'  // plural label (default: derived from class name)
  static labelSingular  = 'Blog Post'   // singular label
  static slug           = 'posts'       // URL slug (default: kebab-case plural)
  static icon           = 'file-text'   // sidebar icon name
  static defaultSort    = 'createdAt'   // default sort column
  static defaultSortDir = 'DESC'        // 'ASC' | 'DESC'

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
