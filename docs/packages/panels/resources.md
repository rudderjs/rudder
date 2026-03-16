# Resources

Resources are the core building block of `@boostkit/panels`. Each resource maps to an ORM model and defines the fields, filters, and actions for that model's CRUD interface.

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
  static perPage         = 25               // records per page (default: 15)
  static perPageOptions  = [25, 50, 100]    // per-page dropdown choices (default: [10, 15, 25, 50, 100])
  static paginationType  = 'pagination'     // 'pagination' (numbered pages) or 'loadMore'
  static persistTableState = true           // persist filters, sort, search, page & selection in sessionStorage

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

## Feature Flags

Resources support four static feature flags. Collaborative mode is derived automatically from fields.

```ts
export class ArticleResource extends Resource {
  static live          = true   // table auto-refreshes on save
  static versioned     = true   // version history with JSON snapshots
  static draftable     = true   // draft/publish workflow
  static softDeletes   = true   // trash & restore
}
```

### Live Table (`static live = true`)

When any user creates, updates, or deletes a record, all viewers of that resource's table see the change instantly. Powered by `@boostkit/broadcast`. No Yjs required.

**Requirements**: `@boostkit/broadcast` registered in providers.

### Versioned (`static versioned = true`)

Each save/publish creates a JSON snapshot in the `PanelVersion` table. Users can view past versions and revert. The version history panel highlights the active version and lets users restore any snapshot — restoring populates the form without saving, so users can review before committing. **Does not require Yjs** — works with plain JSON.

**Requirements**: `PanelVersion` model in Prisma schema.

### Draftable (`static draftable = true`)

Records have a `draftStatus` field (`'draft'` | `'published'`). Create defaults to draft. Edit page shows "Save Draft" and "Publish" buttons. Published records show an "Unpublish" option.

**Requirements**: `draftStatus String @default("draft")` column on the model.

### Soft Deletes (`static softDeletes = true`)

Delete sets `deletedAt` instead of removing. List view adds a "View Trash" toggle. Trashed records can be restored or permanently deleted (with confirmation).

**Requirements**: `deletedAt DateTime?` column on the model.

### Collaborative Editing

No resource-level flag needed — just add `.collaborative()` to any field. A resource is automatically collaborative when any field has `.collaborative()`. The edit page shows connection status and presence avatars.

```ts
fields() {
  return [
    // Text-based fields — each gets its own Y.Doc + Lexical editor
    TextField.make('title').collaborative(),
    TextareaField.make('excerpt').collaborative(),
    RichContentField.make('body').collaborative(),

    // Value-based fields — shared Y.Doc, Y.Map (last-write-wins)
    ToggleField.make('featured').collaborative(),
    SelectField.make('status').collaborative(),
    DateField.make('publishedAt').collaborative(),
    ColorField.make('accentColor').collaborative(),

    // Non-collaborative fields work as normal
    SlugField.make('slug').from('title'),
  ]
}
```

**How it works:**

| Field type | Sync mechanism | Details |
|---|---|---|
| `text`, `textarea`, `email` | Own Y.Doc per field (Lexical PlainText) | Character-level CRDT, remote cursors |
| `richcontent`, `content` | Own Y.Doc per field (Lexical RichText) | Full rich-text collaboration with cursors |
| `boolean`, `toggle`, `select`, `date`, `color`, `tags`, etc. | Shared Y.Doc via Y.Map | Last-write-wins, instant sync |

Each text-based collaborative field gets its own WebSocket room (e.g., `panel:articles:{id}:text:title`) for complete isolation. Non-text collaborative fields share a single Y.Map in the form-level Y.Doc.

**Requirements**: `@boostkit/live` registered in providers.

### Composing Flags

| Combo | Behavior |
|-------|----------|
| `versioned` only | Save creates a JSON snapshot. Can rollback. |
| `draftable` only | Draft/publish workflow. No history. |
| `draftable + versioned` | Draft/publish + version history on each publish. |
| `.collaborative()` fields | Real-time co-editing. Save goes to DB. |
| `.collaborative()` + `versioned` | Co-edit + version snapshots with restore. |
| All flags | Full power: co-edit, draft/publish, version history, trash. |

### Required Prisma Models

```prisma
// For versioned resources
model PanelVersion {
  id        String   @id @default(cuid())
  docName   String
  snapshot  Bytes
  label     String?
  userId    String?
  createdAt DateTime @default(now())
  @@index([docName, createdAt])
}

// For globals
model PanelGlobal {
  slug      String   @id
  data      String   @default("{}")
  updatedAt DateTime @updatedAt
}
```

---

## Duplicate Record

Each table row has a **Duplicate** button in the row actions (between Edit and Delete). Clicking it:

1. Fetches the full record via `GET /{panel}/api/{resource}/{id}`
2. Builds a prefill URL from all editable, non-slug fields
3. Navigates to the create page with those values pre-filled

The field that auto-generates a slug (via `SlugField.from()`) gets `" (copy)"` appended, ensuring the new slug is unique:

| | Original | Duplicate |
|---|---|---|
| `title` | `"My Article"` | `"My Article (copy)"` |
| `slug` | `"my-article"` | `"my-article-copy"` (auto-generated) |

**Skipped fields**: `id`, readonly fields, `password`, `hidden`, `slug`.

No configuration required — the button is always visible per row.
