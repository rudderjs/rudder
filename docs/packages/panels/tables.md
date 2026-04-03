# Tables

`Table` is a standalone schema element for `@rudderjs/panels`. Use it on panel landing pages (`Panel.schema()`), resource show pages (`Resource.widgets()`), or anywhere a schema element is accepted. It is distinct from the Resource CRUD list — `Table` is for display-only or lightweight editing scenarios where you want full control over the data source and columns.

```ts
import { Table, Column } from '@rudderjs/panels'
```

---

## Overview

`Table.make(title)` creates a configurable data table. The title appears as the card heading and is also used to auto-generate an API endpoint ID (slugified).

```ts
Table.make('Recent Articles')
  .fromModel(Article)
  .columns([
    Column.make('title').label('Title').sortable().searchable(),
    Column.make('createdAt').label('Published').date(),
  ])
  .sortBy('createdAt', 'DESC')
  .limit(5)
```

---

## Data Sources

Three mutually exclusive methods set where the table gets its rows.

### `.fromResource(Class)` — Resource-linked

Inherits the Resource's model, default sort order, and field label definitions. The table header "View all" link auto-points to the resource index.

```ts
import { ArticleResource } from './resources/ArticleResource.js'

// Column names resolved from Resource field labels
Table.make('Recent Articles')
  .fromResource(ArticleResource)
  .columns(['title', 'status', 'createdAt'])
  .sortBy('createdAt', 'DESC')
  .limit(5)

// Or with explicit Column instances (overrides Resource labels)
Table.make('Recent Articles')
  .fromResource(ArticleResource)
  .columns([
    Column.make('title').label('Title').sortable().searchable(),
    Column.make('createdAt').label('Published').date(),
  ])
  .limit(5)
```

### `.fromModel(Class)` — Model-backed

Query any ORM model directly. No Resource needed. Pair with `Column.make()` instances.

```ts
Table.make('All Users')
  .fromModel(User)
  .columns([
    Column.make('name').label('Name').sortable().searchable(),
    Column.make('email').label('Email').sortable().searchable(),
    Column.make('role').label('Role').badge(),
    Column.make('createdAt').label('Joined').date(),
  ])
  .sortBy('createdAt', 'DESC')
  .paginated('pages', 25)
```

### `.fromArray(data)` — Static or async

Pass a static array or an async function. No model or resource needed.

```ts
// Static array
Table.make('Browser Market Share')
  .fromArray([
    { browser: 'Chrome', share: 65, trend: '+2.1%' },
    { browser: 'Safari', share: 18, trend: '-0.5%' },
    { browser: 'Firefox', share: 10, trend: '-1.2%' },
  ])
  .columns([
    Column.make('browser').label('Browser').sortable().searchable(),
    Column.make('share').label('Share (%)').numeric().sortable(),
    Column.make('trend').label('Trend'),
  ])
  .searchable()

// Async function — receives PanelContext, runs server-side (SSR + API)
Table.make('Top Customers')
  .fromArray(async (ctx) => {
    const res = await fetch('https://api.example.com/customers')
    return res.json()
  })
  .columns([
    Column.make('name').label('Name').sortable().searchable(),
    Column.make('total').label('Total').numeric(),
  ])
  .lazy()
  .poll(60000)
```

`DataSource<T>` is the type for the `.fromArray()` argument:

```ts
type DataSource<T> = T[] | ((ctx: PanelContext) => T[] | Promise<T[]>)
```

---

## Columns

`Column` is a display-only building block for tables. It is distinct from `Field` — columns do not handle form input, validation, or persistence on their own.

```ts
import { Column } from '@rudderjs/panels'
```

### `Column.make(name)`

The `name` must match a property key in the record object. The label auto-derives from the name (camelCase split) unless overridden.

```ts
Column.make('title')                    // label: "Title"
Column.make('createdAt')                // label: "Created At"
Column.make('draftStatus').label('Status')  // explicit label
```

### Display types

| Method | Effect |
|--------|--------|
| `.label(text)` | Override the column header text |
| `.sortable()` | Enables sort on click |
| `.searchable()` | Includes this column in table search |
| `.date(format?)` | Render as a formatted date. Format: `'medium'` (default) or `'datetime'` |
| `.numeric()` | Right-align, treat as number |
| `.boolean()` | Render as Yes / No |
| `.badge()` | Render as a pill badge |
| `.image()` | Render as a small thumbnail |
| `.href(pattern)` | Wrap cell in a link; use `:fieldName` as a placeholder |

```ts
Column.make('title').label('Article Title').sortable().searchable()
Column.make('status').label('Status').badge()
Column.make('publishedAt').label('Published').date('datetime')
Column.make('price').label('Price').numeric()
Column.make('active').label('Active').boolean()
Column.make('avatar').label('Photo').image()
Column.make('name').label('Name').href('/admin/resources/users/:id')
```

### `.href()` link patterns

Use `:fieldName` placeholders — they are replaced with the value of that field from the row record.

```ts
// Link to /articles/my-article-slug
Column.make('title').href('/articles/:slug')

// Link to /admin/resources/users/42
Column.make('name').href('/admin/resources/users/:id')
```

---

## Column Transforms

Both `.compute()` and `.display()` run **server-side** (during SSR and on every API fetch). They never execute in the browser.

### `.compute(fn)` — Derive a value

Receives the full row record, returns a computed value. The computed value replaces the column's raw value before rendering.

```ts
Column.make('wordCount').label('Words')
  .compute((record) => {
    const text = String(record['title'] ?? '')
    return text.trim() ? text.trim().split(/\s+/).length : 0
  })
```

### `.display(fn)` — Format for output

Receives the raw value (or computed value if `.compute()` was also chained), returns a display string.

```ts
Column.make('price').label('Price')
  .display((v) => `$${((v as number) / 100).toFixed(2)}`)
```

### Chaining both

```ts
Column.make('wordCount').label('Words')
  .compute((record) => record['body']?.split(/\s+/).length ?? 0)
  .display((v) => `${v} ${Number(v) === 1 ? 'word' : 'words'}`)

Column.make('status').label('Status')
  .compute((record) => String(record['draftStatus'] ?? 'unknown'))
  .display((v) => String(v).toUpperCase())
  .badge()
```

---

## Pagination

Use `.paginated(mode, perPage)` to enable pagination. Without it, the table renders all rows up to `.limit()`.

```ts
// Numbered pages (default mode, 15 rows per page)
Table.make('All Articles')
  .fromModel(Article)
  .columns([...])
  .paginated()

// Custom per-page count
Table.make('All Articles')
  .fromModel(Article)
  .columns([...])
  .paginated('pages', 25)

// "Load more" — appends rows incrementally
Table.make('Activity Log')
  .fromModel(Activity)
  .columns([
    Column.make('action').label('Action'),
    Column.make('createdAt').label('Time').date('datetime'),
  ])
  .paginated('loadMore', 10)
```

### `.limit(n)`

When pagination is not enabled, `.limit()` caps the number of rows shown (default: 5). Useful for "recent" or "top N" summary tables.

```ts
Table.make('Recent 5 Articles')
  .fromModel(Article)
  .columns([Column.make('title'), Column.make('createdAt').date()])
  .sortBy('createdAt', 'DESC')
  .limit(5)
```

---

## Search

`.searchable()` on `Table` shows a search input above the table. It searches across all columns that have `.searchable()` set (or all columns if none are explicitly marked).

```ts
// Search all columns
Table.make('Articles')
  .fromModel(Article)
  .columns([
    Column.make('title').sortable(),
    Column.make('slug'),
  ])
  .searchable()

// Restrict search to specific columns
Table.make('Articles')
  .fromModel(Article)
  .columns([
    Column.make('title').sortable().searchable(),
    Column.make('slug').searchable(),
    Column.make('createdAt').date(),
  ])
  .searchable(['title', 'slug'])
```

`.searchable()` on `Column` includes that column in the per-column search set when `.searchable()` is also called on the `Table`.

---

## Sort

### `.sortBy(col, dir)` — Default sort

Sets the initial sort when the table first renders. The `dir` argument is `'ASC'` or `'DESC'` (default: `'DESC'`).

```ts
Table.make('Articles')
  .fromModel(Article)
  .columns([...])
  .sortBy('createdAt', 'DESC')
```

### `Column.sortable()` — Interactive sort

Marks a column as clickable for client-initiated sort. The user can click the column header to toggle ascending/descending order.

```ts
Column.make('title').label('Title').sortable()
Column.make('createdAt').label('Date').date().sortable()
```

---

## Filters

`.filters([...])` attaches dropdown filter controls to the table header. Two filter types are available: `SelectFilter` and `SearchFilter`.

```ts
import { SelectFilter, SearchFilter } from '@rudderjs/panels'
```

### `SelectFilter`

A dropdown with predefined options. Filters by column equality.

```ts
Table.make('Articles')
  .fromModel(Article)
  .columns([...])
  .filters([
    SelectFilter.make('draftStatus')
      .label('Status')
      .options([
        { label: 'Published', value: 'published' },
        { label: 'Draft', value: 'draft' },
        { label: 'Archived', value: 'archived' },
      ]),
  ])
```

Options can also be a plain `string[]` — each string becomes both label and value:

```ts
SelectFilter.make('category').options(['Tech', 'Design', 'Business'])
```

### `SearchFilter`

A text input that searches across specified columns with OR logic.

```ts
Table.make('Users')
  .fromModel(User)
  .columns([...])
  .filters([
    SearchFilter.make('q')
      .label('Search')
      .columns('name', 'email', 'company'),
  ])
```

### Custom query callback

Use `.query(fn)` on any filter to override the default `column = value` behavior:

```ts
SelectFilter.make('status')
  .options([...])
  .query((q, value) => q.where('status', value).where('deletedAt', null))
```

### Multiple filters

```ts
Table.make('Users')
  .fromModel(User)
  .columns([...])
  .filters([
    SelectFilter.make('role').label('Role').options(['admin', 'user', 'guest']),
    SelectFilter.make('active').label('Active').options([
      { label: 'Yes', value: true },
      { label: 'No', value: false },
    ]),
  ])
```

---

## Actions

`.actions([...])` attaches action buttons to the table. Actions can operate on selected rows (bulk) or appear as per-row buttons.

```ts
import { Action } from '@rudderjs/panels'
```

### Bulk actions

Bulk actions appear in a toolbar when one or more rows are selected. `.bulk()` is the default.

```ts
Table.make('Articles')
  .fromModel(Article)
  .columns([...])
  .actions([
    Action.make('publish').label('Publish').bulk(),
    Action.make('archive').label('Archive').bulk(),
    Action.make('delete')
      .label('Delete')
      .destructive()
      .confirm('Delete selected articles? This cannot be undone.')
      .bulk(),
  ])
```

### Row actions

`.row()` renders the action as a button on each individual row.

```ts
Action.make('view').label('View').row()
Action.make('delete').label('Delete').destructive().confirm('Delete this record?').row()
```

Combine both to show an action in the bulk toolbar and as a row button:

```ts
Action.make('delete').label('Delete').destructive().confirm('Delete?').bulk().row()
```

### `.handler(fn)`

The handler receives an array of selected records. Register it on the action to run server-side logic.

```ts
Action.make('publish').label('Publish').bulk()
  .handler(async (records) => {
    for (const record of records) {
      await Article.query().update(record.id, { status: 'published', publishedAt: new Date() })
    }
  })

Action.make('delete').label('Delete').destructive().confirm('Delete selected?').bulk()
  .handler(async (records) => {
    for (const record of records) {
      await Article.query().delete(record.id)
    }
  })
```

### `.confirm(message)` and `.destructive()`

`.confirm()` shows a confirmation dialog before executing. `.destructive()` renders the button in red.

```ts
Action.make('delete')
  .label('Delete')
  .destructive()
  .confirm('This will permanently delete the selected records.')
  .bulk()
  .handler(async (records) => { ... })
```

### `.icon(name)`

Attach a Lucide icon to the action button.

```ts
Action.make('export').label('Export CSV').icon('download').bulk()
```

---

## Inline Editing

Mark a column with `.editable()` to let users click cells and edit values directly in the table. For model-backed tables, saves are handled automatically via `Model.update()`. For custom data sources, define a save handler.

### Edit modes

Three modes control how the editor appears:

| Mode | UI | Best for |
|------|----|----------|
| `'inline'` | Edit in-cell | Short text, numbers, selects, toggles |
| `'popover'` | Dropdown panel | Textarea, tags, slugs |
| `'modal'` | Full dialog | Complex fields, large content |

Auto-mode (no argument) picks the mode based on field type:
- **inline**: text, email, number, select, toggle, boolean, color, date
- **popover**: textarea, tags, json, slug
- **modal**: everything else

```ts
// Auto mode — infers from column/field type
Column.make('title').editable()

// Forced mode
Column.make('title').editable('inline')
Column.make('notes').editable('popover')
Column.make('body').editable('modal')
```

### Custom edit field

Pass a `Field` instance to control the editor input type.

```ts
import { SelectField, ToggleField, TextareaField, ColorField, TagsField } from '@rudderjs/panels'

Column.make('status').badge().editable(
  SelectField.make('status').options([
    { label: 'Draft', value: 'draft' },
    { label: 'Published', value: 'published' },
  ])
)

Column.make('featured').editable(ToggleField.make('featured'))
Column.make('accentColor').editable(ColorField.make('accentColor'))
Column.make('excerpt').editable(TextareaField.make('excerpt'), 'popover')
Column.make('tags').editable(TagsField.make('tags'), 'popover')
```

### Save handlers

When a cell edit is saved, the handler is resolved in priority order:

1. **Column-level** `.onSave(fn)` — highest priority, handles this column only
2. **Table-level** `.onSave(fn)` — fallback, handles all columns without their own handler
3. **Default** — for model-backed tables, calls `Model.update(id, { field: value })` automatically

```ts
// Column-level — receives (record, value, ctx)
Column.make('status').editable()
  .onSave(async (record, value, ctx) => {
    await Article.query().update(record.id as string, { status: value })
  })

// Table-level — receives (record, field, value, ctx)
Table.make('Articles')
  .fromModel(Article)
  .columns([
    Column.make('title').editable(),
    Column.make('status').editable(),
  ])
  .onSave(async (record, field, value, ctx) => {
    await Article.query().update(record.id as string, { [field]: value })
  })
```

Note: `Column.onSave` receives `(record, value, ctx)` — no `field` argument. `Table.onSave` receives `(record, field, value, ctx)` — the field name is included because it handles multiple columns.

### Static data with `.onSave()`

For `.fromArray()` tables, no auto-save is available — always provide a `Table.onSave()`:

```ts
Table.make('Team Members')
  .fromArray([
    { id: 1, name: 'Alice', role: 'admin', active: true },
    { id: 2, name: 'Bob',   role: 'user',  active: false },
  ])
  .columns([
    Column.make('name').label('Name').editable(),
    Column.make('role').label('Role').editable(
      SelectField.make('role').options(['admin', 'user'])
    ),
    Column.make('active').label('Active').boolean().editable(),
  ])
  .onSave(async (record, field, value) => {
    // persist to your data store
    console.log('[save]', record['id'], field, value)
  })
```

---

## Scoped Queries

`.scope(fn)` applies a custom filter to the query builder before sort and limit are applied. Works with both `.fromResource()` and `.fromModel()`.

```ts
// Only show published articles
Table.make('Published Articles')
  .fromModel(Article)
  .scope(q => q.where('draftStatus', 'published'))
  .columns([
    Column.make('title').sortable(),
    Column.make('createdAt').label('Published').date(),
  ])
  .limit(5)

// Scope with multiple conditions
Table.make("This Week's Orders")
  .fromModel(Order)
  .scope(q => q.where('status', 'completed').where('createdAt', '>=', weekAgo))
  .columns([...])
  .sortBy('createdAt', 'DESC')
```

---

## State Persistence

`.remember(mode)` persists table navigation state (current page, sort column, sort direction, search query, active filters) across page navigations and browser refreshes.

```ts
// localStorage — no URL change, survives refresh, not shareable
Table.make('Articles').fromModel(Article).columns([...]).remember('localStorage')

// URL query params — shareable link, SSR-compatible
Table.make('Articles').fromModel(Article).columns([...]).remember('url')

// Server session — SSR-compatible, clean URL, not shareable
Table.make('Articles').fromModel(Article).columns([...]).remember('session')

// No persistence (default)
Table.make('Articles').fromModel(Article).columns([...]).remember(false)
```

Calling `.remember()` with no argument defaults to `'localStorage'`.

| Mode | URL changes | SSR state | Survives refresh | Shareable |
|------|------------|-----------|------------------|-----------|
| `false` | No | No | No | No |
| `'localStorage'` | No | No | Yes | No |
| `'url'` | Yes | Yes | Yes | Yes |
| `'session'` | No | Yes | Yes | No |

The `'url'` mode uses the table's ID as a key prefix in query parameters. Use `.id('my-table')` to set a stable, human-readable ID when multiple tables on the same page use URL state.

---

## Real-Time Updates

### `.lazy()`

Defers data loading to client-side. The table renders a skeleton on initial SSR and fetches data via the panel API after mount. Use this to avoid blocking SSR with slow queries or external API calls.

```ts
Table.make('External Users')
  .fromArray(async () => {
    const res = await fetch('https://api.example.com/users')
    return res.json()
  })
  .columns([...])
  .lazy()
```

### `.poll(ms)`

Re-fetches table data every N milliseconds. The first render uses SSR data (or shows a skeleton if `.lazy()` is also set).

```ts
Table.make('Live Orders')
  .fromModel(Order)
  .columns([...])
  .poll(5000)  // refresh every 5 seconds
```

### `.live()`

Pushes updates to the client via WebSocket when server data changes. The table refreshes automatically across all open browser tabs — no polling needed. Requires `@rudderjs/broadcast` to be registered.

```ts
Table.make('Live Articles')
  .fromModel(Article)
  .columns([
    Column.make('title').sortable().searchable(),
    Column.make('draftStatus').badge(),
    Column.make('createdAt').date(),
  ])
  .paginated('pages', 10)
  .searchable()
  .live()
```

Combine `.live()` with `.lazy()` for deferred initial load + real-time updates:

```ts
Table.make('Live Orders')
  .fromModel(Order)
  .columns([...])
  .lazy()
  .live()
```

---

## Drag Reorder

`.reorderable(positionField?)` enables drag-to-reorder rows. After dropping, the new order is saved to the `positionField` column (default: `'position'`) via a PATCH to the panel API.

```ts
Table.make('Categories')
  .fromModel(Category)
  .columns([
    Column.make('name').label('Category Name'),
    Column.make('position').label('Order').numeric(),
  ])
  .sortBy('position', 'ASC')
  .reorderable()                   // saves to 'position' field
  .reorderable('sortOrder')        // saves to custom field name
```

Requirements:
- The model's database table must have a numeric position column.
- The table should be sorted by that column ascending (`.sortBy('position', 'ASC')`) so the visual order matches stored order.
- No `.paginated()` — reorder works best on a single loaded set of rows.

---

## Styling

### `.description(text)`

Renders a subtitle below the table title.

```ts
Table.make('Browser Market Share')
  .fromArray([...])
  .description('Estimated global browser usage — updated monthly')
  .columns([...])
```

### `.emptyMessage(text)`

Custom message shown when the table has no records.

```ts
Table.make('Published Articles')
  .fromModel(Article)
  .scope(q => q.where('status', 'published'))
  .emptyMessage('No published articles yet. Publish your first article to see it here.')
  .columns([...])
```

### `.href(url)`

Overrides the auto-generated "View all" link in the table header.

```ts
Table.make('Recent Articles')
  .fromResource(ArticleResource)
  .href('/admin/articles?filter=recent')
  .columns([...])
  .limit(5)
```

### `.id(id)`

Explicit stable ID for the table's API endpoint. Auto-generated from the title if not set (title lowercased, non-alphanumeric replaced with `-`). Set this manually when the title contains dynamic content, or when multiple tables need distinct URL state keys.

```ts
Table.make('Articles')
  .id('homepage-articles')
  .fromModel(Article)
  .columns([...])
  .remember('url')
```

---

## API Reference

### `Table`

| Method | Description |
|--------|-------------|
| `Table.make(title)` | Create a table with the given title |
| `.fromResource(Class)` | Use a Resource class as data source |
| `.fromModel(Class)` | Use an ORM Model class directly |
| `.fromArray(data)` | Static array or async function returning rows |
| `.columns([...])` | `string[]` of field names or `Column[]` instances |
| `.sortBy(col, dir?)` | Default sort column and direction (`'ASC'` \| `'DESC'`) |
| `.limit(n)` | Max rows without pagination (default: 5) |
| `.paginated(mode?, perPage?)` | Enable pagination: `'pages'` or `'loadMore'` (default: `'pages'`, 15/page) |
| `.searchable(cols?)` | Show search input, optionally restrict to specific column names |
| `.scope(fn)` | Custom query callback applied before sort/limit |
| `.filters([...])` | Attach `SelectFilter` / `SearchFilter` filter dropdowns |
| `.actions([...])` | Attach bulk/row `Action` handlers |
| `.reorderable(field?)` | Enable drag-to-reorder, saves to `field` (default: `'position'`) |
| `.onSave(fn)` | Table-level save handler for inline editing |
| `.lazy()` | Defer data loading to client-side |
| `.poll(ms)` | Re-fetch every N milliseconds |
| `.live()` | Push updates via WebSocket (requires `@rudderjs/broadcast`) |
| `.remember(mode?)` | Persist state: `'localStorage'` \| `'url'` \| `'session'` \| `false` |
| `.description(text)` | Subtitle below the table title |
| `.emptyMessage(text)` | Custom no-records message |
| `.href(url)` | Override the "View all" header link |
| `.id(id)` | Explicit API endpoint ID |

### `Column`

| Method | Description |
|--------|-------------|
| `Column.make(name)` | Create a column bound to the named record field |
| `.label(text)` | Column header label (default: camelCase split) |
| `.sortable()` | Enable sort on column header click |
| `.searchable()` | Include in table search |
| `.date(format?)` | Render as date — `'medium'` or `'datetime'` |
| `.numeric()` | Right-align, treat as number |
| `.boolean()` | Render as Yes / No |
| `.badge()` | Render as pill badge |
| `.image()` | Render as thumbnail |
| `.href(pattern)` | Clickable link — use `:fieldName` placeholders |
| `.compute(fn)` | Derive value from the full record (server-side) |
| `.display(fn)` | Format value for display (server-side) |
| `.editable(modeOrField?, mode?)` | Enable inline editing |
| `.onSave(fn)` | Column-level save handler for inline editing |

### `SelectFilter`

| Method | Description |
|--------|-------------|
| `SelectFilter.make(name)` | Create a select filter on the named column |
| `.label(text)` | Dropdown label |
| `.options(opts)` | `string[]` or `{ label, value }[]` |
| `.column(col)` | Override the filtered column (default: filter name) |
| `.query(fn)` | Custom ORM query callback |

### `SearchFilter`

| Method | Description |
|--------|-------------|
| `SearchFilter.make(name?)` | Create a search-across-columns filter (default name: `'search'`) |
| `.label(text)` | Input label |
| `.columns(...cols)` | Columns to search across (OR logic) |
| `.query(fn)` | Custom ORM query callback |

### `Action`

| Method | Description |
|--------|-------------|
| `Action.make(name)` | Create an action |
| `.label(text)` | Button label |
| `.icon(name)` | Lucide icon name |
| `.bulk(value?)` | Show in bulk toolbar when rows are selected (default: `true`) |
| `.row(value?)` | Show as a per-row button |
| `.destructive(value?)` | Red styling |
| `.confirm(message?)` | Show confirmation dialog before executing |
| `.handler(fn)` | Async function — receives `records[]` |

---

## Complete Example

A fully-featured table combining search, filters, pagination, actions, inline editing, scoped queries, and URL state persistence.

```ts
import {
  Table, Column,
  SelectFilter,
  Action,
  SelectField, ToggleField, TextareaField,
} from '@rudderjs/panels'
import { Article } from 'App/Models/Article.js'

Table.make('Articles')
  .id('articles-table')
  .fromModel(Article)
  .description('Manage all articles. State is saved to the URL for easy sharing.')
  .emptyMessage('No articles match the current filters.')
  .columns([
    Column.make('title').label('Title').sortable().searchable()
      .editable(),
    Column.make('draftStatus').label('Status').badge().sortable()
      .editable(
        SelectField.make('draftStatus').options([
          { label: 'Draft', value: 'draft' },
          { label: 'Published', value: 'published' },
          { label: 'Archived', value: 'archived' },
        ])
      ),
    Column.make('featured').label('Featured').boolean()
      .editable(ToggleField.make('featured')),
    Column.make('excerpt').label('Excerpt')
      .editable(TextareaField.make('excerpt'), 'popover'),
    Column.make('wordCount').label('Words')
      .compute((r) => String(r['body'] ?? '').split(/\s+/).filter(Boolean).length)
      .display((v) => `${v} words`)
      .numeric(),
    Column.make('createdAt').label('Created').date('datetime').sortable(),
  ])
  .scope(q => q.where('deletedAt', null))
  .sortBy('createdAt', 'DESC')
  .paginated('pages', 20)
  .searchable()
  .filters([
    SelectFilter.make('draftStatus').label('Status').options([
      { label: 'Published', value: 'published' },
      { label: 'Draft', value: 'draft' },
      { label: 'Archived', value: 'archived' },
    ]),
    SelectFilter.make('featured').label('Featured').options([
      { label: 'Yes', value: true },
      { label: 'No', value: false },
    ]),
  ])
  .actions([
    Action.make('publish').label('Publish').icon('send').bulk()
      .handler(async (records) => {
        for (const r of records) {
          await Article.query().update(r.id, { draftStatus: 'published', publishedAt: new Date() })
        }
      }),
    Action.make('archive').label('Archive').bulk()
      .handler(async (records) => {
        for (const r of records) {
          await Article.query().update(r.id, { draftStatus: 'archived' })
        }
      }),
    Action.make('delete').label('Delete').destructive()
      .confirm('Permanently delete the selected articles?')
      .bulk()
      .handler(async (records) => {
        for (const r of records) {
          await Article.query().delete(r.id)
        }
      }),
  ])
  .remember('url')
  .live()
```
