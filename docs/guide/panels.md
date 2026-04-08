# Panels

`@rudderjs/panels` provides a multi-panel admin and user-facing dashboard system. Define resources with typed fields, filters, and actions — RudderJS auto-generates the CRUD API and a fully functional UI.

Inspired by Filament PHP, Laravel Nova, and Payload CMS.

## Installation

```bash
pnpm add @rudderjs/panels
```

## Quick Start

**1. Define a resource:**

```ts
// app/Panels/Admin/resources/UserResource.ts
import { Resource, TextField, EmailField, BooleanField, DateField } from '@rudderjs/panels'
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
import { Panel } from '@rudderjs/panels'
import { UserResource } from './resources/UserResource.js'

export const adminPanel = Panel.make('admin')
  .path('/admin')
  .branding({ title: 'My Admin' })
  .resources([UserResource])
```

**3. Register the panel:**

```ts
// bootstrap/providers.ts
import { panels } from '@rudderjs/panels'
import { adminPanel } from '../app/Panels/Admin/AdminPanel.js'

export default [
  // ...other providers...
  panels([adminPanel]),
]
```

**4. Publish the UI pages:**

```bash
pnpm rudder vendor:publish --tag=panels-pages
```

This copies the panel UI pages into your app under `pages/(panels)/`. Vike picks them up automatically — visit `/admin` in the browser.

---

## Panel Schema (Landing Page)

By default, visiting the panel root (e.g. `/admin`) redirects to the first resource. Define `.schema()` on your panel to render a custom landing page with stats, headings, and data tables instead.

```ts
import { Panel, Heading, Text, Stats, Stat, Table } from '@rudderjs/panels'

Panel.make('admin')
  .resources([UserResource, ArticleResource])
  .schema(async (ctx) => [
    Heading.make('Welcome back'),
    Text.make(`Logged in as ${ctx.user?.email ?? 'guest'}`),

    Stats.make([
      Stat.make('Users').value(await User.query().count()),
      Stat.make('Articles').value(await Article.query().count()),
      Stat.make('Published')
        .value(await Article.query().where('status', 'published').count())
        .trend('up'),
    ]),

    Table.make('Recent Articles')
      .fromResource(ArticleResource)
      .columns(['title', 'status', 'publishedAt'])
      .sortBy('createdAt', 'DESC')
      .limit(5),
  ])
```

The function receives `PanelContext` (`{ user, headers, path }`) and can be `async` — safe to run ORM queries inside. Use a static array for simple content with no dynamic data:

```ts
.schema([
  Heading.make('Admin Panel'),
  Text.make('Manage your application from the sidebar.'),
])
```

### Schema Elements

| Class | Description |
|---|---|
| `Heading.make(text)` | Section heading — `.level(1\|2\|3)` controls font size (default: `2`) |
| `Text.make(content)` | Paragraph of text |
| `Stats.make([...stats])` | A horizontal row of stat cards |
| `Stat.make(label)` | Single stat card — `.value(n)`, `.description(text)`, `.trend('up'\|'down'\|'neutral')` |
| `Table.make(title)` | Data table from a resource — `.resource(slug)`, `.columns([...])`, `.limit(n)`, `.sortBy(col, dir)` |

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
  .globals([SiteSettingsGlobal])          // single-record settings pages
  .notifications()                       // enable in-app notification bell
```

The `guard` receives a `PanelContext` (`{ user, headers, path }`) and returns `true` to allow or `false` to reject. Unauthenticated UI requests are redirected to `/login?redirect=<encodedPath>`; API requests receive `401 Unauthorized`.

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

## Notifications Widget

Enable an in-app notification bell in the panel header with `.notifications()`:

```ts
Panel.make('admin')
  .path('/admin')
  .resources([UserResource])
  .notifications()
```

This adds a bell icon to the top navigation bar that displays unread notifications for the current user. Notifications are sourced from `@rudderjs/notification` — any notification sent via the `database` channel appears in the panel.

Requires `@rudderjs/notification` to be registered in providers.

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

### FieldType Enum

Instead of magic strings, use the `FieldType` enum for type-safe field type references:

```ts
import { FieldType } from '@rudderjs/panels'

FieldType.Text       // 'text'
FieldType.Email      // 'email'
FieldType.Password   // 'password'
FieldType.Number     // 'number'
FieldType.Textarea   // 'textarea'
FieldType.Select     // 'select'
FieldType.Boolean    // 'boolean'
FieldType.Toggle     // 'toggle'
FieldType.Date       // 'date'
FieldType.Datetime   // 'datetime'
FieldType.Slug       // 'slug'
FieldType.Tags       // 'tags'
FieldType.Color      // 'color'
FieldType.Hidden     // 'hidden'
FieldType.Json       // 'json'
FieldType.File       // 'file'
FieldType.Image      // 'image'
FieldType.BelongsTo  // 'belongsTo'
FieldType.HasMany    // 'hasMany'
FieldType.Repeater   // 'repeater'
FieldType.Builder    // 'builder'
```

Useful when building dynamic field logic or custom components that branch on field type.

---

## Layout Grouping

Group related fields into visual sections or tabs. Both can be freely mixed with plain fields in `fields()`.

### Section

A titled card — optionally collapsible and multi-column:

```ts
import { Section, TextField, TextareaField, SelectField, FileField } from '@rudderjs/panels'

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
import { Tabs } from '@rudderjs/panels'

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

### Wizard (Multi-Step Forms)

Replace the standard create/edit form with a multi-step wizard. Each step has its own fields and validation — the user advances step by step with Next/Back buttons.

```ts
import { Wizard, Step, TextField, EmailField, SelectField, TextareaField } from '@rudderjs/panels'

export class UserResource extends Resource {
  form() {
    return Wizard.make()
      .steps([
        Step.make('Account')
          .description('Basic account information')
          .schema([
            TextField.make('name').required(),
            EmailField.make('email').required(),
          ]),

        Step.make('Profile')
          .description('Additional details')
          .schema([
            SelectField.make('role').options(['user', 'editor', 'admin']).required(),
            TextareaField.make('bio').rows(4),
          ]),

        Step.make('Review')
          .description('Confirm and submit')
          .schema([
            // summary fields or empty — user reviews before submitting
          ]),
      ])
  }
}
```

| Method | Description |
|--------|-------------|
| `Wizard.make()` | Create a wizard form |
| `.steps(Step[])` | Define the wizard steps in order |
| `Step.make(label)` | Create a step with the given label |
| `Step.description(text)` | Subtitle shown below the step label |
| `Step.schema(fields[])` | Fields for this step |

When `form()` returns a `Wizard`, the create and edit pages render the wizard UI instead of the default single-page form. Validation runs per-step — the user cannot advance until the current step is valid. The final step submits all collected data at once.

---

## File Uploads

`FileField` uploads files directly from the admin form. Files are uploaded to the panel's `/_upload` endpoint (auto-mounted per panel) and stored via `@rudderjs/storage`.

```ts
import { FileField } from '@rudderjs/panels'

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
pnpm rudder storage:link
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

Filters appear above the resource table as dropdowns. Each active filter appends `?filter[name]=value` to the URL.

```ts
import { SelectFilter, SearchFilter } from '@rudderjs/panels'

filters() {
  return [
    SelectFilter.make('status')
      .label('Status')
      .column('status')     // column name (defaults to filter name)
      .options([
        { label: 'Draft',     value: 'draft' },
        { label: 'Published', value: 'published' },
        { label: 'Archived',  value: 'archived' },
      ]),

    SearchFilter.make('search')
      .label('Search')
      .columns(['name', 'email']),
  ]
}
```

By default, `SelectFilter` applies `WHERE column = value` (simple equality). For anything more complex, use `.query()`.

### Custom Filter Query

`.query(fn)` gives you direct access to the ORM query builder so you can write any expression:

```ts
// Multi-condition filter
SelectFilter.make('status')
  .options([
    { label: 'Published', value: 'published' },
    { label: 'Draft',     value: 'draft' },
  ])
  .query((q, value) => {
    q.where('status', value)
    if (value === 'published') q.where('publishedAt', '!=', null)
  })

// Date range filter
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

// Boolean filter stored as 0/1 string
SelectFilter.make('featured')
  .label('Featured')
  .options([
    { label: 'Featured',     value: '1' },
    { label: 'Not featured', value: '0' },
  ])
  .query((q, value) => q.where('featured', value === '1'))
```

The callback receives:
- `q` — the ORM query builder (call `.where()`, `.orWhere()`, etc.)
- `value` — the selected filter value as a string

### Specialized Filter Types

Beyond `SelectFilter` and `SearchFilter`, there are four additional filter types for common patterns:

```ts
import { DateFilter, BooleanFilter, NumberFilter, QueryFilter } from '@rudderjs/panels'

filters() {
  return [
    DateFilter.make('createdAt')
      .label('Created Between'),
      // renders as a date range picker (from / to)

    BooleanFilter.make('featured')
      .label('Featured'),
      // renders as a ternary: All | Yes | No

    NumberFilter.make('price')
      .label('Price Range'),
      // renders as min / max number inputs

    QueryFilter.make('hasComments')
      .label('Has Comments')
      .query((q) => q.where('commentCount', '>', 0)),
      // renders as a simple toggle — applies the query when active
  ]
}
```

| Class | UI | Query |
|-------|-----|-------|
| `DateFilter` | Date range picker (from/to) | `WHERE column >= from AND column <= to` |
| `BooleanFilter` | Ternary: All / Yes / No | `WHERE column = true` or `WHERE column = false` |
| `NumberFilter` | Min/max number inputs | `WHERE column >= min AND column <= max` |
| `QueryFilter` | On/off toggle | Runs the `.query(fn)` callback when toggled on |

### Filter Indicator

Any filter can show a colored dot in the filter bar when active, making it obvious that filters are applied:

```ts
SelectFilter.make('status')
  .options([...])
  .indicator()          // shows a dot when this filter has a value
```

---

## Actions

Actions run on selected records (bulk or single):

```ts
import { Action } from '@rudderjs/panels'

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

### Action Forms

Actions can collect input from the user before executing. Call `.form()` with an array of fields to show a modal dialog:

```ts
Action.make('change-status')
  .label('Change Status')
  .icon('refresh')
  .bulk()
  .form([
    SelectField.make('status')
      .label('New Status')
      .options(['draft', 'published', 'archived'])
      .required(),
    TextareaField.make('reason')
      .label('Reason for change')
      .rows(3),
  ])
  .handler(async (records, formData) => {
    for (const record of records as Article[]) {
      await Article.query().update(record.id, {
        status: formData.status,
        statusReason: formData.reason,
      })
    }
  }),
```

The handler receives `(records, formData)` where `formData` is a plain object with the form field values. Without `.form()`, the handler receives only `(records)`.

### Action Groups

Group related actions into a dropdown menu to reduce toolbar clutter:

```ts
import { Action, ActionGroup } from '@rudderjs/panels'

actions() {
  return [
    Action.make('publish').label('Publish').icon('check').bulk()
      .handler(async (records) => { /* ... */ }),

    ActionGroup.make('more')
      .label('More Actions')
      .actions([
        Action.make('archive').label('Archive').icon('archive')
          .handler(async (records) => { /* ... */ }),
        Action.make('export').label('Export CSV').icon('download')
          .handler(async (records) => { /* ... */ }),
        Action.make('duplicate').label('Duplicate').icon('copy')
          .handler(async (records) => { /* ... */ }),
      ]),
  ]
}
```

Top-level actions render as individual buttons. Grouped actions render inside a single dropdown button.

### Header Actions

Add global actions above the table (not tied to record selection) with `.headerActions()`:

```ts
import { Table, Action } from '@rudderjs/panels'

// On a schema Table element
Table.make('Articles')
  .fromResource(ArticleResource)
  .headerActions([
    Action.make('export-all').label('Export All').icon('download')
      .handler(async () => { /* export logic */ }),
    Action.make('import').label('Import').icon('upload')
      .handler(async () => { /* import logic */ }),
  ])
```

Header actions also work on the resource table via the `table()` method:

```ts
export class ArticleResource extends Resource {
  table() {
    return { headerActions: [
      Action.make('export-all').label('Export All').icon('download')
        .handler(async () => { /* ... */ }),
    ]}
  }
}
```

---

## Data Import

`Import.make()` adds a file import button to the resource table. Users upload a CSV/XLSX file and records are created in chunks with validation and optional transformation.

```ts
import { Import, TextField, EmailField } from '@rudderjs/panels'

export class UserResource extends Resource {
  // ...

  table() {
    return {
      importable: Import.make()
        .columns([
          TextField.make('name').required(),
          EmailField.make('email').required(),
          TextField.make('role'),
        ])
        .chunkSize(100)           // process N rows at a time (default: 500)
        .validate((row) => {
          if (!row.email?.includes('@')) return 'Invalid email'
          return true
        })
        .transform((row) => ({
          ...row,
          role: row.role || 'user',
          createdAt: new Date(),
        })),
    }
  }
}
```

| Method | Description |
|--------|-------------|
| `Import.make()` | Create an import configuration |
| `.columns(fields[])` | Define expected columns using field classes (used for mapping + validation) |
| `.chunkSize(n)` | Number of rows to process per batch (default: `500`) |
| `.validate(fn)` | Per-row validation — return `true` or an error message string |
| `.transform(fn)` | Transform each row before insert — receives raw row, returns modified row |

The import UI shows a column mapping step, a preview, validation errors, and progress.

---

## Globals

Single-record settings pages — same field system as Resources but no list/create/delete.

```ts
import { Global, TextField, ToggleField, Section } from '@rudderjs/panels'

export class SiteSettingsGlobal extends Global {
  static slug  = 'site-settings'
  static label = 'Site Settings'
  static icon  = '⚙️'

  fields() {
    return [
      Section.make('General').schema(
        TextField.make('siteName').required(),
        TextField.make('tagline'),
      ),
      Section.make('Maintenance').schema(
        ToggleField.make('maintenanceMode'),
      ),
    ]
  }
}
```

Register on the panel: `.globals([SiteSettingsGlobal])`. API: `GET/PUT /{panel}/api/_globals/{slug}`.

Requires a `PanelGlobal` table: `slug String @id`, `data String @default("{}")`, `updatedAt DateTime @updatedAt`.

---

## Feature Flags

Resources support four static flags. Collaborative mode is derived automatically from fields.

```ts
export class ArticleResource extends Resource {
  static live          = true   // table auto-refreshes on save
  static versioned     = true   // version history with JSON snapshots
  static draftable     = true   // draft/publish workflow
  static softDeletes   = true   // trash & restore
}
```

| Flag | What it does | Requires |
|------|-------------|----------|
| `live` | Table auto-refreshes when anyone saves | `@rudderjs/broadcast` |
| `versioned` | JSON snapshots on each save, version history with restore | `PanelVersion` table |
| `draftable` | Draft/publish workflow with Save Draft + Publish buttons | `draftStatus` column |
| `softDeletes` | Trash, restore, force-delete | `deletedAt` column |

### Soft Deletes

When `softDeletes = true`, delete sets `deletedAt` instead of removing the record. The list view adds a "View Trash" toggle to see soft-deleted records. Trashed records can be restored or permanently deleted.

Requires `deletedAt DateTime?` on the model.

### Draft/Publish

When `draftable = true`, create defaults to `draftStatus = 'draft'`. The edit page shows "Save Draft" and "Publish" buttons. Published records show an "Unpublish" option.

Requires `draftStatus String @default("draft")` on the model.

### Collaborative Editing

No resource-level flag needed — just add `.collaborative()` to any field:

```ts
fields() {
  return [
    TextField.make('title').collaborative(),           // character-level CRDT + cursors
    RichContentField.make('body').collaborative(),     // rich-text collaboration
    ToggleField.make('featured').collaborative(),      // instant sync (last-write-wins)
    SelectField.make('status').collaborative(),        // instant sync
    SlugField.make('slug').from('title'),              // not collaborative
  ]
}
```

Text-based fields get their own Y.Doc + Lexical editor with live cursors. Value-based fields (toggles, selects, dates, etc.) sync via Y.Map (last-write-wins). The edit page shows connection status and presence avatars automatically.

Requires `@rudderjs/live` registered in providers.

---

## Table Column Types

Fields render visually in table cells based on their type:

| Type | Rendering |
|------|-----------|
| `image` | Thumbnail preview |
| `boolean` / `toggle` | Yes/No badge |
| `date` | Formatted date |
| `color` | Swatch + hex code |
| `tags` | Badge pills |
| `select` | Label from options (not raw value) |
| `belongsTo` | Linked name |
| `belongsToMany` | Badge pills with links |

### Badge Mapping

Map field values to colored pills — works on any field type:

```ts
SelectField.make('status').badge({
  draft:     { color: 'yellow', label: 'Draft' },
  published: { color: 'green',  label: 'Published' },
  archived:  { color: 'gray',   label: 'Archived' },
})
```

Colors: `gray`, `red`, `orange`, `yellow`, `green`, `blue`, `purple`, `pink`.

### Progress Bar

Render a number field as a visual progress bar:

```ts
NumberField.make('completion').progressBar({ max: 100, color: '#22c55e' })
```

---

## Inline Table Editing

Edit field values directly in the table cell — no edit page needed:

```ts
SelectField.make('status').inlineEditable()   // click → dropdown
ToggleField.make('featured').inlineEditable() // click → toggle switch
TextField.make('title').inlineEditable()       // click → text input
NumberField.make('priority').inlineEditable()  // click → number input
```

Sends `PUT /{panel}/api/{resource}/:id` with only the changed field (partial update). Validation only runs on submitted fields.

---

## Authorization

Override `policy()` in your resource to control access per-action:

```ts
async policy(action: PolicyAction, ctx: PanelContext): Promise<boolean> {
  if (action === 'delete') return ctx.user?.role === 'admin'
  return true
}
```

`PolicyAction`: `'viewAny' | 'view' | 'create' | 'update' | 'delete' | 'restore' | 'forceDelete'`

The API responds with 403 when `policy()` returns `false`.

---

## Auto-Generated API Routes

For each resource, `@rudderjs/panels` mounts:

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
| `GET` | `/{panel}/api/{resource}/_options` | Relation select options — used by RelationField |
| `GET` | `/{panel}/api/{resource}/_schema` | Field definitions — used for inline create dialog |
| `GET` | `/{panel}/api/{resource}/_related` | HasMany records — `?fk=col&id=val[&through=true]` |
| `POST` | `/{panel}/api/{resource}/:id/_restore` | Restore soft-deleted record |
| `DELETE` | `/{panel}/api/{resource}/:id/_force` | Permanently delete |
| `GET` | `/{panel}/api/{resource}/:id/_versions` | List version snapshots |
| `POST` | `/{panel}/api/{resource}/:id/_versions` | Create version snapshot |
| `GET` | `/{panel}/api/_globals/{slug}` | Read global settings |
| `PUT` | `/{panel}/api/_globals/{slug}` | Update global settings |

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
  static live           = false         // auto-refresh table on save
  static versioned      = false         // version history with JSON snapshots
  static draftable      = false         // draft/publish workflow
  static softDeletes    = false         // trash & restore
  // collaborative mode is derived from fields — add .collaborative() to any field

  fields() { return [...] }
  filters() { return [...] }   // optional
  actions() { return [...] }   // optional
  relations() { return [...] } // optional — see Relation Managers below
}
```

---

## Relation Managers

Relation managers display and manage related records inline on the detail/edit page. Define a `relations()` method on your resource to add inline tables for hasMany relationships.

```ts
import { RelationManager, TextField, TextareaField, DateField } from '@rudderjs/panels'

export class PostResource extends Resource {
  static model = Post

  fields() {
    return [
      TextField.make('title').required(),
      TextareaField.make('body'),
    ]
  }

  relations() {
    return [
      RelationManager.make('comments')
        .label('Comments')
        .foreignKey('postId')       // column on the related model (default: inferred)
        .columns([
          TextField.make('author').sortable(),
          TextField.make('body'),
          DateField.make('createdAt').label('Date').sortable(),
        ])
        .form([
          TextField.make('author').required(),
          TextareaField.make('body').required(),
        ])
        .creatable()                // show "Add" button
        .editable()                 // allow inline editing
        .deletable()                // show delete button per row
        .defaultSort('createdAt', 'DESC'),
    ]
  }
}
```

| Method | Description |
|--------|-------------|
| `RelationManager.make(relation)` | Create a manager for the named relation |
| `.label(text)` | Display label (default: title-cased relation name) |
| `.foreignKey(column)` | Foreign key column on the related model |
| `.columns(fields[])` | Columns to show in the relation table |
| `.form(fields[])` | Fields for the create/edit modal |
| `.creatable()` | Show an "Add" button to create related records |
| `.editable()` | Allow editing related records |
| `.deletable()` | Show a delete button on each row |
| `.defaultSort(column, dir?)` | Default sort for the relation table |

Relation managers render as tabbed tables below the main form on the edit page. Each manager handles its own pagination and sorting independently.

---

## Custom Resource Views

To replace the default table for a specific resource, create a Vike page at the resource's static path. Vike's route priority makes static segments win over dynamic ones — your page is served instead of the built-in table.

The panel layout (`AdminLayout`) is applied automatically — your page just returns its content.

```
pages/(panels)/@panel/articles/+Page.tsx    ← custom view for 'articles'
pages/(panels)/@panel/articles/+data.ts
```

### `resourceData(ctx)`

Use `resourceData()` in your `+data.ts` to fetch the same data the default table uses — pagination, sort, search, and filters all work out of the box.

```ts
// pages/(panels)/@panel/articles/+data.ts
import { resourceData } from '@rudderjs/panels'
import type { PageContextServer } from 'vike/types'

export type Data = Awaited<ReturnType<typeof resourceData>>

export async function data(pageContext: PageContextServer) {
  const { panel, resource } = pageContext.routeParams as { panel: string; resource: string }
  return resourceData({
    panel,               // panel path segment, e.g. 'admin'
    resource,            // resource slug, e.g. 'articles'
    url: pageContext.urlOriginal,  // full URL — used to parse sort/search/filter/page
  })
}
```

**`ResourceDataContext`**

| Field | Type | Description |
|-------|------|-------------|
| `panel` | `string` | Panel path segment (e.g. `'admin'` for a panel at `/admin`) |
| `resource` | `string` | Resource slug (e.g. `'articles'`) |
| `url` | `string` | Full request URL including query string |

**`ResourceDataResult`**

| Field | Type | Description |
|-------|------|-------------|
| `panelMeta` | `PanelMeta` | Panel name, branding, nav items |
| `resourceMeta` | `ResourceMeta` | Field schema, filters, actions, labels |
| `records` | `unknown[]` | Current page of records |
| `pagination` | `{ total, currentPage, lastPage, perPage } \| null` | Pagination info; `null` if no model |
| `pathSegment` | `string` | Panel path segment (same as `panel` input) |
| `slug` | `string` | Resource slug (same as `resource` input) |

The URL query params `resourceData()` reads:

| Param | Default | Description |
|-------|---------|-------------|
| `?page=` | `1` | Page number |
| `?perPage=` | `15` | Records per page (max 100) |
| `?sort=` | `Resource.defaultSort` | Column to sort by (must be `.sortable()`) |
| `?dir=` | `Resource.defaultSortDir \| 'ASC'` | Sort direction: `ASC` or `DESC` |
| `?search=` | — | Search term applied across `.searchable()` fields |
| `?filter[field]=` | — | Value for a named filter |

### Example: card grid instead of table

```tsx
// pages/(panels)/@panel/articles/+Page.tsx
'use client'

import { useData }   from 'vike-react/useData'
import { useConfig } from 'vike-react/useConfig'
import type { Data } from './+data.js'

export default function ArticlesGridPage() {
  const config = useConfig()
  const { panelMeta, resourceMeta, records, pagination, pathSegment, slug } = useData<Data>()
  const panelName = panelMeta.branding?.title ?? panelMeta.name
  config({ title: `${resourceMeta.label} — ${panelName}` })

  return (
    <>
      <div className="grid grid-cols-3 gap-4">
        {(records as { id: string; title: string; coverImage: string | null }[]).map((article) => (
          <a key={article.id} href={`/${pathSegment}/${slug}/${article.id}`}
             className="rounded-xl border bg-card p-4 hover:shadow-md transition-shadow">
            {article.coverImage && (
              <img src={article.coverImage} alt={article.title}
                   className="w-full h-40 object-cover rounded-md mb-3" />
            )}
            <p className="font-semibold text-sm">{article.title}</p>
          </a>
        ))}
      </div>
      {pagination && (
        <p className="text-sm text-muted-foreground mt-4">
          Page {pagination.currentPage} of {pagination.lastPage} — {pagination.total} total
        </p>
      )}
    </>
  )
}
```

---

## Customizing the UI

The published pages at `pages/(panels)/` are yours to edit. The UI is built with:

- **[Base UI](https://base-ui.com/)** — headless, accessible components
- **Tailwind CSS** — utility-first styling
- **Vike** — SSR file-based routing

All panel data is driven by the `/_meta` API endpoint — adding a new resource or field requires no UI changes.

---

## AI Features

Panels has built-in AI capabilities powered by `@rudderjs/ai`. Requires the AI package to be installed and configured.

### AI Agents

Define agents on resources to automate field editing:

```ts
import { PanelAgent } from '@rudderjs/panels'

agents() {
  return [
    PanelAgent.make('seo')
      .label('Improve SEO')
      .icon('Search')
      .instructions('Improve meta title and description for SEO.')
      .fields(['metaTitle', 'metaDescription']),
  ]
}
```

Agents appear as a dropdown in the form toolbar and can also be invoked from the chat sidebar.

### AI Chat Sidebar

A collapsible right sidebar provides unified AI chat:

- Free-form questions about your data
- Agent runs with streaming tool calls
- Resource-aware — knows the current record and fields
- Conversation persistence with auto-titles
- Model selection dropdown

### Selected Text Editing

Select text in any collaborative field → click **✦** → ask AI to edit it:

```
Select "Introduction to Bitcoin" in title → click ✦ → type "shorten this"
→ AI calls edit_text on the title field → title updates in real-time
```

Works with TextField, TextareaField, and RichContentField.

### Quick Actions (`.ai()`)

Add one-click AI actions to any field:

```ts
TextField.make('title').ai(['rewrite', 'shorten', 'expand', 'fix-grammar'])
RichContentField.make('content').ai(['rewrite', 'expand', 'shorten', 'translate', 'simplify'])
TextareaField.make('excerpt').ai()  // default set of actions
```

A **✦** button appears next to the field label with a dropdown of predefined actions.

Available actions: `rewrite`, `expand`, `shorten`, `fix-grammar`, `translate`, `summarize`, `make-formal`, `simplify`.

### Setup

```ts
// config/ai.ts
export default {
  default: 'anthropic/claude-sonnet-4-5',
  providers: {
    anthropic: { driver: 'anthropic', apiKey: process.env.ANTHROPIC_API_KEY! },
  },
  models: [
    { id: 'anthropic/claude-sonnet-4-5', label: 'Claude Sonnet 4.5', default: true },
    { id: 'anthropic/claude-opus-4-5', label: 'Claude Opus 4.5' },
  ],
}

// bootstrap/providers.ts
import { ai } from '@rudderjs/ai'
export default [ai(configs.ai), ...]
```
