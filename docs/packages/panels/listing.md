# Listing Records

Configuration and customization for the resource table view -- columns, search, sort, filters, pagination, actions, and more.

---

## Table Column Types

### Badge Mapping

Map field values to colored pills -- works on any field:

```ts
SelectField.make('status').badge({
  draft:     { color: 'yellow', label: 'Draft' },
  published: { color: 'green',  label: 'Published' },
})
```

Colors: `gray`, `red`, `orange`, `yellow`, `green`, `blue`, `purple`, `pink`.

### Progress Bar

```ts
NumberField.make('completion').progressBar({ max: 100, color: '#22c55e' })
```

### Inline Table Editing

Edit values directly in the table cell:

```ts
SelectField.make('status').inlineEditable()   // click -> dropdown
ToggleField.make('featured').inlineEditable() // click -> toggle
TextField.make('title').inlineEditable()       // click -> input
```

Sends partial `PUT` with only the changed field.

---

## Per-Resource Search

Mark fields `.searchable()` to add a search bar to the **resource list page**. The search input uses live debounced filtering -- typing triggers a search after 150ms with no submit button required. A lucide search icon is displayed inside the input, and a custom X button clears the query.

Submitting runs a `LIKE` query across all searchable columns (OR logic).

```ts
// URL: /admin/api/users?search=alice
TextField.make('name').searchable()
EmailField.make('email').searchable()
```

---

## Global Search

The panel header includes a keyboard-driven global search that searches **all resources** at once.

- **Open**: click the search button or press `Cmd+K` / `Ctrl+K` from anywhere in the panel
- **Results**: grouped by resource, up to 5 matches per resource
- **Keyboard nav**: `Up` / `Down` to move, `Enter` to navigate, `Escape` to close
- **Debounced**: 300 ms delay before querying

Only resources that have a model and at least one `.searchable()` field are included. The `static titleField` controls which field is displayed in the results.

```ts
export class UserResource extends Resource {
  static titleField = 'name'   // shown in global search results

  fields() {
    return [
      TextField.make('name').searchable(),   // included in global search
      EmailField.make('email').searchable(),  // included in global search
      DateField.make('createdAt'),           // not searchable — excluded
    ]
  }
}
```

The endpoint is `GET /{panel}/api/_search?q=query&limit=5` (max 20).

---

## Sort

Mark fields `.sortable()` to make column headers clickable. Clicking toggles `ASC -> DESC`.

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

## Tab Filters

Tab filters provide a pill-style tab bar above the table for quick, predefined query scopes. Define them via the `tabs()` method on your resource:

```ts
import { Tab } from '@boostkit/panels'

export class ArticleResource extends Resource {
  // ...

  tabs() {
    return [
      Tab.make('all').label('All'),
      Tab.make('published').label('Published').icon('circle-check')
        .query((q) => q.where('draftStatus', 'published')),
      Tab.make('draft').label('Drafts').icon('pencil-line')
        .query((q) => q.where('draftStatus', 'draft')),
    ]
  }
}
```

- **Pills style**: tabs render as horizontal pills in the toolbar
- **Persistence**: the active tab is persisted in `sessionStorage` so it survives page navigation
- **Hidden in trash view**: tabs are automatically hidden when viewing trashed records

The first tab (`'all'`) typically has no `.query()` -- it shows all records unfiltered. Tabs with a `.query()` apply the given filter to the list query. The `.icon()` method accepts any [lucide](https://lucide.dev/icons) icon name.

---

## Pagination

### Numbered pages (default)

```ts
export class UserResource extends Resource {
  static perPage = 25                       // default: 15
  static perPageOptions = [25, 50, 100]     // default: [10, 15, 25, 50, 100]
}
```

The table renders numbered page buttons and a per-page dropdown.

### Load more

```ts
export class CommentResource extends Resource {
  static paginationType = 'loadMore'
  static perPage = 10                       // batch size per "Load more" click
}
```

Replaces numbered pages with a "Load more" button. Records accumulate in the table. Shows "Showing N of Total". All data is SSR -- navigating to `?page=3` loads pages 1-3 server-side in a single query.

---

## Table State Persistence

Opt-in per resource -- saves filters, sort, search, page position, and selected rows to `sessionStorage`. State restores when the user navigates back. Sidebar links automatically point to the saved URL.

```ts
export class ArticleResource extends Resource {
  static persistTableState = true   // default: false
}
```

What gets persisted:

| State | Storage key |
|---|---|
| Filters, sort, search, page | `panels:{panel}:{slug}:tableState` |
| Selected row IDs | `panels:{panel}:{slug}:selected` |

- Cleared when the browser tab closes (sessionStorage)
- "Clear filters" button clears the saved state
- Bulk actions clear the saved selection

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

## Bulk Delete

When one or more rows are checked, a selection bar appears at the bottom of the table containing:

- A **"Delete N selected"** button -- opens a confirmation dialog, then sends `DELETE /{panel}/api/{resource}` with `{ ids: string[] }`
- Any custom bulk `Action` buttons defined on the resource

The selection bar is visible whenever at least one row is selected, regardless of whether any custom actions are defined.

---

## Empty State Customization

When a resource table has no records, an empty state is displayed. Customize it with static properties on the resource:

```ts
export class ArticleResource extends Resource {
  static emptyStateIcon = 'file-text'           // lucide icon (defaults to resource icon)
  static emptyStateHeading = 'No :label yet'    // :label placeholder replaced with resource label
  static emptyStateDescription = 'Write your first article.'
}
```

The `:label` placeholder in `emptyStateHeading` is automatically replaced with the resource's `label` value (e.g., "No Articles yet").

If not specified, defaults are:
- **Icon**: the resource's `static icon` value
- **Heading**: `"No :label yet"`
- **Description**: `"Get started by creating a new one."`

---

## Create Page Prefill

The create page reads `prefill[field]=value` query params and uses them as initial field values:

```
/admin/categories/create?prefill[parentId]=abc123
```

This pre-selects `parentId` in the create form. Useful for the "create related" flow from a HasMany table.
