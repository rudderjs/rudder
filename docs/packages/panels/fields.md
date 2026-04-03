# Fields

Fields define how each column on a model is rendered in forms, tables, and the show view.

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
| `Block` | -- | Block type definition for use with `BuilderField` |
| `RichContentField` | rich-text editor | Lexical rich-text with slash commands, blocks, and collaboration |
| `FileField` | file input | Upload a file via `@rudderjs/storage` |
| `FileField.image()` | image upload | Upload an image -- shows preview thumbnail |
| `RelationField` | select / chip multi-select | BelongsTo / belongsToMany relation |
| `HasMany` | -- | Reverse relation table rendered on the show page |

---

## Shared Fluent Methods

```ts
TextField.make('name')
  .label('Full Name')       // display label (defaults to title-cased name)
  .required()               // required in create/edit forms
  .readonly()               // visible but not editable; excluded from payloads
  .sortable()               // clickable column header -> ?sort=name&dir=ASC
  .searchable()             // included in search -> WHERE name LIKE '%foo%'
  .default('value')         // default value for create forms (static or function)
  .from('title')            // declare dependency fields for reactive derivation
  .derive(fn)               // compute value from dependencies (client-side)
  .debounce(300)            // debounce time for derive recomputation (default: 200ms)
  .inlineEditable()         // allow editing directly in table cells
  .collaborative()          // shorthand for .persist('websocket') — real-time Yjs sync
  .persist()                // survive page reload (localStorage, url, session, or websocket)
  .hideFrom('table' | 'create' | 'edit' | 'view')
  .hideFromTable()
  .hideFromCreate()
  .hideFromEdit()
```

---

## Reactive Derived Fields (`.from().derive()`)

Declare field dependencies with `.from()` and compute the value reactively with `.derive()`. When any dependency field changes in the form, the derived field updates automatically (debounced).

```ts
// Auto-generate slug from title
TextField.make('slug').from('title')
  .derive(({ title }) => (title as string).toLowerCase().replace(/[^a-z0-9]+/g, '-'))

// Compute total from price and quantity
NumberField.make('total').from('price', 'quantity')
  .derive(({ price, quantity }) => (price as number) * (quantity as number))
  .readonly()

// Preview combining multiple fields
TextField.make('preview').from('title', 'status')
  .derive(({ title, status }) => `${title} [${status}]`)
  .readonly()
```

| Method | Description |
|--------|-------------|
| `.from(...fields)` | Declare dependency fields — triggers recomputation when they change |
| `.derive(fn)` | Compute this field's value from dependency values. Runs client-side on every change |
| `.debounce(ms)` | Debounce time before recomputing (default: 200ms) |

The derived field remains editable by default — the user can override the computed value. Add `.readonly()` to make it purely computed.

---

## Inline Table Editing (`.inlineEditable()`)

Allow editing a field's value directly in the resource table cell. Click to edit, blur or Enter to save.

```ts
SelectField.make('status').inlineEditable()   // click -> dropdown
ToggleField.make('featured').inlineEditable() // click -> toggle
TextField.make('title').inlineEditable()       // click -> input
```

Sends a partial `PUT` with only the changed field. Supported on text, number, email, select, toggle, boolean, color, and date field types.

---

## Default Values

Set initial values for create forms using `.default()`. Accepts a static value or a function.

```ts
TextField.make('status').default('draft')
SelectField.make('role').default('user')
DateField.make('startDate').default(() => new Date().toISOString())
```

| Method | Description |
|--------|-------------|
| `.default(value)` | Static default value for create forms |
| `.default(fn)` | Function default -- resolved server-side, receives context |

**Priority**: `.data(fn)` on Form > field `.persist()` restored value > `.default()`. On the edit page, the existing record value always takes precedence.

---

## Field Persistence (`.persist()`)

Control how individual field values survive page reloads, share across tabs, or sync in real-time. All modes use a single `.persist()` method.

```ts
TextField.make('q').persist('url')              // URL query param — shareable, SSR'd
TextField.make('draft').persist('session')       // server session — SSR'd, clean URL
TextField.make('note').persist('localStorage')   // browser storage (default when no arg)
TextField.make('note').persist()                 // same as 'localStorage'
TextField.make('content').persist('websocket')   // Yjs real-time collaboration
TextField.make('content').persist(['websocket', 'indexeddb'])  // Yjs + offline
```

| Mode | Mechanism | SSR | Shareable | Survives refresh |
|------|-----------|-----|-----------|------------------|
| `'localStorage'` | Browser localStorage | No | No | Yes |
| `'url'` | URL query param | Yes | Yes | Yes |
| `'session'` | Server session | Yes | No | Yes |
| `'indexeddb'` | y-indexeddb (Yjs offline) | No | No | Yes |
| `'websocket'` | y-websocket (Yjs real-time) | No | Synced | While connected |
| `['websocket', 'indexeddb']` | Both Yjs providers | No | Synced | Yes |

`.persist()` is independent from `draftRecovery`. Use `draftRecovery` for full-form backup with a restore banner. Use `.persist()` for individual fields that should quietly survive page reloads or sync across editors.

---

## Collaborative Fields in Forms

Standalone `Form.make()` elements support collaborative editing via `.persist('websocket')`. Each collaborative field opens a WebSocket connection for real-time sync across browser tabs and users.

```ts
Form.make('collab-notes')
  .fields([
    TextField.make('title').persist('websocket'),
    TextareaField.make('notes').persist('websocket'),
    ToggleField.make('published').persist('websocket'),
  ])
```

- Text fields get per-field Y.Doc with character-level CRDT sync
- Non-text fields (toggle, select, date, etc.) sync via a shared Y.Map (last-write-wins)
- The form shows connection status and presence count when collaborative fields are present
- Works in both standalone forms and resource create/edit forms

---

## Form Layout Groupings

`Section` and `Tabs` group fields visually in create/edit forms. They are not fields -- they don't appear in the table or the show view.

### Section

```ts
import { Section } from '@rudderjs/panels'

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
import { Tabs } from '@rudderjs/panels'

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

`FileField` connects to `@rudderjs/storage` via a panel-mounted upload endpoint (`POST /{panel}/api/_upload`).

```ts
import { FileField } from '@rudderjs/panels'

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

`@rudderjs/storage` must be installed and configured for uploads to work.

---

## Relations

Use `RelationField` to render belongs-to and belongs-to-many dropdowns in create/edit forms.

```ts
import { RelationField } from '@rudderjs/panels'

// BelongsTo — FK lives on this model (e.g. parentId -> parent)
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

**`.creatable()`** -- when set on a `belongsToMany` field, the multi-select dropdown shows a "Create X" option when the typed value has no exact match. Selecting it opens a dialog that renders the related resource's full create form. The new record is created via POST and automatically added to the selection.

**UI for `belongsTo`**: native `<select>` with options fetched from the related resource.

**UI for `belongsToMany`**: searchable chip multi-select. Keyboard: `Up/Down` navigate, `Enter` select, `Escape` close, `Backspace` removes last chip.

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
import { HasMany } from '@rudderjs/panels'

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

`HasMany` fields are automatically hidden from the table, create, and edit views -- they only render on the **show page** as a paginated table below the record details.

The table includes a **"+ New"** button that links to the related resource's create page with the FK pre-filled via `?prefill[{foreignKey}]={currentId}`.

---

## Custom Field Types

Use `.component(key)` on any field to hand off form rendering to a custom React component.

```ts
// In your Resource
NumberField.make('priority').label('Priority').component('rating')
```

Register the component in `pages/(panels)/_components/CustomFieldRenderers.tsx` (a published file -- edit it directly):

```tsx
import type { FieldMeta } from '@rudderjs/panels'
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

Your custom component receives `{ field, value, onChange }` -- the same props as built-in field renderers.

> **Note:** `CustomFieldRenderers.tsx` is a published file you own. Re-publishing with `--force` will overwrite it -- back it up or commit it before upgrading `@rudderjs/panels`.

---

## Conditional Fields

Show, hide, or disable form fields based on another field's current value.
Conditions are evaluated live in create and edit forms -- no page reload.

```ts
// Show only when status = "published"
DateField.make('publishedAt').showWhen('status', 'published')

// Show when one of multiple values
TextareaField.make('archiveReason').showWhen('status', ['archived', 'rejected'])

// Hide when featured is false
TextField.make('featuredLabel').hideWhen('featured', false)

// Show when views exceeds a threshold (operator overload)
TextField.make('trendingBadge').showWhen('views', '>', 1000)

// Show when a field has any value (non-empty)
TextField.make('subtitle').showWhen('hasSubtitle', 'truthy')

// Disable (show but readonly) when verified
EmailField.make('email').disabledWhen('verified', true)
```

| Method | Description |
|--------|-------------|
| `.showWhen(field, value)` | Show when `field === value` |
| `.showWhen(field, op, value)` | Show when `field {op} value` -- ops: `=` `!=` `>` `>=` `<` `<=` |
| `.showWhen(field, [values])` | Show when `field` is one of `[values]` |
| `.showWhen(field, 'truthy')` | Show when field is non-empty / non-null / non-zero |
| `.showWhen(field, 'falsy')` | Show when field is empty / null / zero / false |
| `.hideWhen(...)` | Inverse of showWhen -- same overloads |
| `.disabledWhen(...)` | Show but make readonly -- same overloads |

Multiple conditions can be stacked -- all must pass.
Conditions only apply to **create and edit forms**. Use `.hideFromTable()` / `.hideFrom('view')` for table/show visibility.

---

## Field-Level Access Control

Restrict individual fields based on the current user -- independent of the resource-level `policy()`.
Inspired by PayloadCMS's `access: { read, update }`.

```ts
// Only admins can see internal notes
TextField.make('internalNotes')
  .readableBy((ctx) => ctx.user?.role === 'admin')

// Non-admins see the field but can't edit it
EmailField.make('email')
  .editableBy((ctx) => ctx.user?.role === 'admin')
```

| Method | Behavior when `fn` returns `false` |
|--------|-------------------------------------|
| `.readableBy(ctx => bool)` | Field stripped from list + show responses |
| `.editableBy(ctx => bool)` | Field marked `readonly: true` in the form |

`ctx` is `PanelContext` (`{ user, headers, path }`).

---

## Per-Field Validation

Add async validators directly on a field -- runs server-side alongside Zod validation.
Inspired by PayloadCMS's `validate: async (value, { data }) => string | true`.

```ts
// Unique slug check (cross-field — receives full form data)
SlugField.make('slug')
  .validate(async (value, data) => {
    const q = Article.query().where('slug', value as string)
    if (data['id']) q.where('id', '!=', data['id'] as string)
    return await q.first() ? 'Slug already in use' : true
  })

// Cross-field date validation
TextField.make('endDate')
  .validate((value, data) => {
    if ((value as string) < (data['startDate'] as string))
      return 'End date must be after start date'
    return true
  })
```

- Return `true` -- passes
- Return a string -- shown as a field-level validation error (same UI as Zod errors)
- `data` is the full request body -- use it to compare with other fields

---

## Display Transformers + Computed Fields

### `.display(fn)` -- format a raw value for the table and show page

Runs server-side before the response is sent. The pre-formatted value replaces the raw one.
Inspired by FilamentPHP's `->formatStateUsing(fn)` and PayloadCMS's `hooks.afterRead`.

```ts
// Format cents as currency
NumberField.make('price')
  .display((v) => `$${((v as number) / 100).toFixed(2)}`)

// Custom date format
DateField.make('createdAt')
  .display((v) => v
    ? new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(new Date(v as string))
    : '--'
  )

// Use the full record for context
TextField.make('status')
  .display((v, record) => {
    const r = record as { status: string; publishedAt?: string }
    return r.publishedAt ? `${v} on ${r.publishedAt}` : String(v)
  })
```

### `ComputedField` -- virtual column with no database backing

Always readonly; hidden from create and edit forms.

```ts
import { ComputedField } from '@rudderjs/panels'

// Word count from excerpt
ComputedField.make('wordCount')
  .label('Words')
  .compute((r) => (r as Article).excerpt?.split(/\s+/).length ?? 0)
  .display((v) => `${v} words`)

// Full name from parts
ComputedField.make('fullName')
  .label('Full Name')
  .compute((r) => `${(r as User).firstName} ${(r as User).lastName}`)

// Chain .compute() with .display() to both derive and format
ComputedField.make('revenue')
  .compute((r) => (r as any).orders?.reduce((s: number, o: any) => s + o.total, 0) ?? 0)
  .display((v) => `$${((v as number) / 100).toFixed(2)}`)
```
