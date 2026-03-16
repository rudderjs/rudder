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

Resources support several static feature flags. Collaborative mode is derived automatically from fields.

```ts
export class ArticleResource extends Resource {
  static live              = true               // table auto-refreshes on save
  static versioned         = true               // version history with JSON snapshots
  static draftable         = true               // draft/publish workflow
  static softDeletes       = true               // trash & restore
  static autosave          = true               // periodic server save (default 30s)
  static persistFormState  = true               // localStorage backup + restore banner
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

### Autosave (`static autosave = true`)

Periodically saves form changes to the server without requiring the user to click Save. Only applies to the edit page (create requires explicit submission).

```ts
export class ArticleResource extends Resource {
  static autosave = true                  // enable with default 30s interval
  // or
  static autosave = { interval: 10000 }  // custom interval (ms)
}
```

The edit toolbar shows a status indicator:
- **Unsaved changes** — form is dirty, waiting for next interval
- **Saving...** — autosave request in progress
- **Saved** — autosave succeeded (fades after 3s)

Autosave skips when: a manual save is in progress, the form is in version restore preview, or no changes have been made since the last save. Does not create version snapshots (only manual save does).

### Form State Persistence (`static persistFormState = true`)

Backs up form values to `localStorage` as the user types. On page reload or browser crash, a restore banner offers to recover the draft. Applies to both create and edit pages.

```ts
export class ArticleResource extends Resource {
  static persistFormState = true
}
```

Features:
- **Restore banner** — "You have unsaved changes from 5m ago. Restore / Discard"
- **beforeunload warning** — browser confirms before leaving with unsaved changes
- Drafts are cleared on successful save (manual or autosave)

The two flags are independent — use either or both:

| Config | Behavior |
|--------|----------|
| `autosave` only | Server saves every N seconds. No localStorage, no restore banner. |
| `persistFormState` only | localStorage backup + restore banner + beforeunload. Manual save only. |
| Both | localStorage catches crashes between autosave intervals. |

### Per-Field Persist (`.persist()`)

For granular control, add `.persist()` to individual fields. Values are silently saved and restored — no banner, no prompt.

```ts
fields() {
  return [
    // localStorage — silent save/restore per field
    TextField.make('title').persist(),

    // y-indexeddb — Yjs offline persistence (survives refresh)
    TextField.make('body').persist('indexeddb'),

    // y-websocket — Yjs real-time sync (like .collaborative())
    TextField.make('notes').persist('websocket'),

    // Both Yjs providers — real-time + offline
    TextField.make('content').persist(['websocket', 'indexeddb']),
  ]
}
```

| Mode | Mechanism |
|---|---|
| `.persist()` | localStorage — silent save/restore per field |
| `.persist('indexeddb')` | y-indexeddb — Y.Doc survives browser refresh |
| `.persist('websocket')` | y-websocket — real-time sync between editors |
| `.persist(['websocket', 'indexeddb'])` | Both — real-time + offline persistence |

`.persist()` is independent from `persistFormState`. Use `persistFormState` for full-form backup with a restore banner. Use `.persist()` for individual fields that should quietly survive page reloads.

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
| `autosave` only | Periodic server save, status indicator in toolbar. |
| `persistFormState` only | localStorage backup, restore banner, beforeunload. |
| `autosave + persistFormState` | Server autosave + localStorage crash safety net. |
| All flags | Full power: co-edit, draft/publish, version history, trash, autosave, persist. |

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
