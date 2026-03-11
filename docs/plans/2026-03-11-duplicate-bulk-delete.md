# Duplicate Record & Bulk Delete Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a "Duplicate" row action that clones a record into the create form pre-filled, and a built-in "Delete selected" button in the bulk selection bar.

**Architecture:** Duplicate is pure client-side — clicking fetches the full record via the existing show endpoint, builds `?prefill[field]=value` query params, and navigates to the create page (which already handles prefill). Bulk delete adds one new API endpoint (`DELETE /{panel}/api/{resource}`) that accepts `{ ids }` and deletes them all, plus a built-in button in the selection bar that is always shown when rows are selected (no custom action needed).

**Tech Stack:** TypeScript, React, Vike client router, node:test

---

## Background — how this codebase works

**Key files:**
- `packages/panels/src/PanelServiceProvider.ts` — all API routes; `mountResource()` method mounts CRUD per resource; `flattenFields()` is a module-level helper
- `packages/panels/src/i18n/en.ts` — all UI strings; `ar.ts` mirrors it as `PanelI18n`; adding a key to `en` automatically expands the type
- `packages/panels/pages/@panel/@resource/+Page.tsx` — the resource table UI; selection state lives here; bulk action bar already exists at line 226; row actions area at line 333
- `playground/pages/(panels)/` — the running copy; **every change to `packages/panels/pages/` must be manually `cp`'d here**

**Prefill pattern (already implemented in create page):**
```
/admin/articles/create?prefill[title]=Hello&prefill[status]=draft&prefill[tagIds]=id1,id2
```
- Regular fields: `String(value)`
- `belongsToMany`: comma-separated IDs (create page splits on `,`)
- `belongsTo` FK: raw FK value (e.g. `parentId=abc123`)

**Existing selection bar (line 226–254 of `+Page.tsx`):**
```tsx
{selected.length > 0 && bulkActions.length > 0 && (   ← only shows custom actions
  <div ...>
    <span>{t(i18n.selected, { n: selected.length })}</span>
    {bulkActions.map(...)}
    <button onClick={() => setSelected([])}>Clear</button>
  </div>
)}
```
Bulk delete needs to show this bar even when `bulkActions.length === 0`, and add a built-in Delete button alongside any custom bulk actions.

**Existing route pattern in `mountResource()`:**
```ts
router.delete(`${base}/:id`, async (req, res) => { ... }, mw)
```
Add `router.delete(base, ...)` (no `:id`) for bulk delete — different path, no conflict.

**Build + test commands:**
```bash
pnpm build                           # from repo root
cd packages/panels && pnpm test      # node:test suite (currently 219 pass)
cd playground && pnpm typecheck      # tsc --noEmit
```

---

## Task 1: Add i18n keys

**Files:**
- Modify: `packages/panels/src/i18n/en.ts`
- Modify: `packages/panels/src/i18n/ar.ts`

**Step 1: Add to `en.ts`** — inside the `// Confirm / delete` section, after `deleteError`:

```ts
  // Duplicate
  duplicate:           'Duplicate',

  // Bulk delete
  deleteSelected:      'Delete :n selected',
  bulkDeleteConfirm:   'This will permanently delete :n records. This action cannot be undone.',
  bulkDeletedToast:    ':n records deleted.',
```

**Step 2: Add to `ar.ts`** — matching keys (typed as `PanelI18n` so TypeScript will error if any key is missing):

```ts
  // Duplicate
  duplicate:           'تكرار',

  // Bulk delete
  deleteSelected:      'حذف :n محدد',
  bulkDeleteConfirm:   'سيؤدي هذا إلى حذف :n سجلات نهائيًا. لا يمكن التراجع عن هذا الإجراء.',
  bulkDeletedToast:    'تم حذف :n سجلات.',
```

**Step 3: Build**

```bash
cd packages/panels && pnpm build
```
Expected: success. If `ar.ts` is missing a key, TypeScript will error here — fix it.

**Step 4: Commit**

```bash
git add packages/panels/src/i18n/en.ts packages/panels/src/i18n/ar.ts
git commit -m "feat(panels): add duplicate and bulk-delete i18n keys"
```

---

## Task 2: Add bulk delete API endpoint

**Files:**
- Modify: `packages/panels/src/PanelServiceProvider.ts`

The endpoint goes in `mountResource()`, after the existing `DELETE /{resource}/:id` route (around line 336–348).

**Step 1: Add the route**

In `mountResource()`, after the single-record delete route, add:

```ts
// ── DELETE /panel/api/resource — bulk delete ──────────────
router.delete(base, async (req, res) => {
  const resource = new ResourceClass()
  const ctx      = this.buildContext(req)
  if (!await resource.policy('delete', ctx)) return res.status(403).json({ message: 'Forbidden.' })
  if (!Model) return res.status(500).json({ message: `Resource "${slug}" has no model defined.` })

  const { ids } = req.body as { ids?: string[] }
  if (!ids?.length) return res.status(422).json({ message: 'No records selected.' })

  let deleted = 0
  for (const id of ids) {
    const exists = await Model.find(id)
    if (exists) {
      await Model.query().delete(id)
      deleted++
    }
  }

  return res.json({ message: `${deleted} records deleted.`, deleted })
}, mw)
```

**Step 2: Build**

```bash
cd packages/panels && pnpm build
```
Expected: success.

**Step 3: Commit**

```bash
git add packages/panels/src/PanelServiceProvider.ts
git commit -m "feat(panels): add bulk delete API endpoint"
```

---

## Task 3: Add tests for bulk delete endpoint logic

**Files:**
- Modify: `packages/panels/src/index.test.ts`

Append at the very end of the file (after the existing `search — searchable field detection` suite):

```ts
// ─── Bulk delete — i18n keys ────────────────────────────────

describe('bulk delete i18n keys', () => {
  it('en has deleteSelected key with :n placeholder', () => {
    const i18n = getPanelI18n('en')
    assert.ok(i18n.deleteSelected.includes(':n'))
  })

  it('en has bulkDeleteConfirm key with :n placeholder', () => {
    const i18n = getPanelI18n('en')
    assert.ok(i18n.bulkDeleteConfirm.includes(':n'))
  })

  it('en has bulkDeletedToast key with :n placeholder', () => {
    const i18n = getPanelI18n('en')
    assert.ok(i18n.bulkDeletedToast.includes(':n'))
  })

  it('ar has deleteSelected key (non-empty)', () => {
    const i18n = getPanelI18n('ar')
    assert.ok(i18n.deleteSelected.length > 0)
  })
})

// ─── Duplicate — i18n keys ───────────────────────────────────

describe('duplicate i18n keys', () => {
  it('en has duplicate key', () => {
    const i18n = getPanelI18n('en')
    assert.equal(typeof i18n.duplicate, 'string')
    assert.ok(i18n.duplicate.length > 0)
  })

  it('ar has duplicate key (non-empty)', () => {
    const i18n = getPanelI18n('ar')
    assert.ok(i18n.duplicate.length > 0)
  })
})
```

**Step 1: Run tests**

```bash
cd packages/panels && pnpm test
```
Expected: 231 pass, 0 fail (219 + 6 new).

**Step 2: Commit**

```bash
git add packages/panels/src/index.test.ts
git commit -m "test(panels): add bulk delete and duplicate i18n key tests"
```

---

## Task 4: Add bulk delete UI to the table page

**Files:**
- Modify: `packages/panels/pages/@panel/@resource/+Page.tsx`

**What to change:**

The selection bar currently only renders when `bulkActions.length > 0`. We need it to also render for bulk delete (always available), and add a "Delete selected" button inside it.

**Step 1: Add `bulkDeletePending` state**

Add to the state declarations at the top of `ResourceListPage()`:

```tsx
const [bulkDeletePending, setBulkDeletePending] = useState(false)
const [bulkDeleteConfirmOpen, setBulkDeleteConfirmOpen] = useState(false)
```

**Step 2: Add `handleBulkDelete` function**

After the existing `executeAction` function, add:

```tsx
async function handleBulkDelete() {
  setBulkDeletePending(true)
  try {
    const res = await fetch(`/${pathSegment}/api/${slug}`, {
      method:  'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ ids: selected }),
    })
    if (res.ok) {
      toast.success(t(i18n.bulkDeletedToast, { n: selected.length }))
      setSelected([])
      window.location.reload()
    } else {
      toast.error(i18n.deleteError)
    }
  } catch {
    toast.error(i18n.deleteError)
  } finally {
    setBulkDeletePending(false)
    setBulkDeleteConfirmOpen(false)
  }
}
```

**Step 3: Replace the bulk action bar**

Find the existing bulk action bar block (line 226–254):

```tsx
{selected.length > 0 && bulkActions.length > 0 && (
```

Replace the entire block with:

```tsx
{selected.length > 0 && (
  <div className="flex items-center gap-3 mb-4 px-4 py-2.5 bg-primary/5 border border-primary/20 rounded-lg">
    <span className="text-sm font-medium">{t(i18n.selected, { n: selected.length })}</span>
    <div className="flex gap-2">
      {bulkActions.map((action) => (
        <button
          key={action.name}
          onClick={() => runAction(action)}
          disabled={actionPending || bulkDeletePending}
          className={[
            'px-3 py-1 text-sm rounded-md font-medium transition-colors disabled:opacity-50',
            action.destructive
              ? 'bg-destructive/10 text-destructive hover:bg-destructive/20'
              : 'bg-primary/10 text-primary hover:bg-primary/20',
          ].join(' ')}
        >
          {action.label}
        </button>
      ))}
      <button
        onClick={() => setBulkDeleteConfirmOpen(true)}
        disabled={actionPending || bulkDeletePending}
        className="px-3 py-1 text-sm rounded-md font-medium transition-colors disabled:opacity-50 bg-destructive/10 text-destructive hover:bg-destructive/20"
      >
        {bulkDeletePending ? i18n.loading : t(i18n.deleteSelected, { n: selected.length })}
      </button>
    </div>
    <button
      onClick={() => setSelected([])}
      className="ms-auto text-sm text-muted-foreground hover:text-foreground transition-colors"
    >
      {i18n.clearSelection}
    </button>
  </div>
)}
```

**Step 4: Add the bulk delete confirm dialog**

Inside the `return (...)`, after the existing `{confirm && <ConfirmDialog ... />}` block, add:

```tsx
{bulkDeleteConfirmOpen && (
  <ConfirmDialog
    open
    onClose={() => setBulkDeleteConfirmOpen(false)}
    onConfirm={handleBulkDelete}
    title={t(i18n.deleteSelected, { n: selected.length })}
    message={t(i18n.bulkDeleteConfirm, { n: selected.length })}
    danger
    confirmLabel={i18n.confirm}
    cancelLabel={i18n.cancel}
  />
)}
```

**Step 5: Build**

```bash
cd packages/panels && pnpm build
```
Expected: success.

**Step 6: Commit**

```bash
git add packages/panels/pages/@panel/@resource/+Page.tsx
git commit -m "feat(panels): add bulk delete UI to resource table"
```

---

## Task 5: Add duplicate row action to the table

**Files:**
- Modify: `packages/panels/pages/@panel/@resource/+Page.tsx`

The duplicate button fetches the full record, builds a prefill URL, and navigates to the create page. It lives alongside the Edit and Delete buttons in each row's action cell.

**Step 1: Add `DuplicateRowButton` component**

At the bottom of `+Page.tsx`, after the `MiniCheckIcon` function, add:

```tsx
function DuplicateRowButton({ slug, id, pathSegment, schema, i18n }: {
  slug:        string
  id:          string
  pathSegment: string
  schema:      FieldMeta[]
  i18n:        PanelI18n
}) {
  const [loading, setLoading] = useState(false)

  async function handleDuplicate() {
    setLoading(true)
    try {
      const res  = await fetch(`/${pathSegment}/api/${slug}/${id}`)
      if (!res.ok) { toast.error(i18n.deleteError); return }
      const body = await res.json() as { data: Record<string, unknown> }
      const record = body.data

      const params = new URLSearchParams()

      // Build prefill from all create-visible, non-readonly, non-id fields
      for (const field of schema) {
        if (field.hidden.includes('create')) continue
        if (field.readonly) continue
        if (field.name === 'id') continue
        if (field.type === 'password' || field.type === 'hidden') continue

        const val = record[field.name]
        if (val === null || val === undefined) continue

        if (field.type === 'belongsToMany') {
          // Array of relation objects — extract IDs
          const items = Array.isArray(val) ? (val as Array<{ id?: string }>) : []
          const ids   = items.map(r => r.id ?? String(r)).filter(Boolean)
          if (ids.length > 0) params.set(`prefill[${field.name}]`, ids.join(','))
        } else if (field.type === 'boolean' || field.type === 'toggle') {
          params.set(`prefill[${field.name}]`, val ? 'true' : 'false')
        } else if (typeof val === 'object') {
          // JSON / repeater / builder — encode as JSON string
          params.set(`prefill[${field.name}]`, JSON.stringify(val))
        } else {
          params.set(`prefill[${field.name}]`, String(val))
        }
      }

      const back = window.location.pathname + window.location.search
      params.set('back', back)

      void navigate(`/${pathSegment}/${slug}/create?${params.toString()}`)
    } catch {
      toast.error(i18n.deleteError)
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      type="button"
      onClick={handleDuplicate}
      disabled={loading}
      className="text-xs px-2.5 py-1 rounded border border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors disabled:opacity-50"
    >
      {loading ? i18n.loading : i18n.duplicate}
    </button>
  )
}
```

**Step 2: Wire `DuplicateRowButton` into the row actions**

Find the row actions area (around line 333–367). The current structure is:

```tsx
<div className="flex items-center justify-end gap-2">
  {rowActions.map(...)}
  <button ...>{i18n.edit}</button>
  <DeleteRowButton ... />
</div>
```

Add `<DuplicateRowButton>` between the edit button and the delete button:

```tsx
<div className="flex items-center justify-end gap-2">
  {rowActions.map((action) => (
    // ...existing...
  ))}
  <button
    type="button"
    onClick={() => {
      const back = window.location.pathname + window.location.search
      void navigate(`/${pathSegment}/${slug}/${id}/edit?back=${encodeURIComponent(back)}`)
    }}
    className="text-xs px-2.5 py-1 rounded border border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
  >
    {i18n.edit}
  </button>
  <DuplicateRowButton
    slug={slug}
    id={id}
    pathSegment={pathSegment}
    schema={allFields}
    i18n={i18n}
  />
  <DeleteRowButton slug={slug} id={id} pathSegment={pathSegment} labelSingular={resourceMeta.labelSingular} i18n={i18n} />
</div>
```

**Step 3: Build**

```bash
cd packages/panels && pnpm build
```
Expected: success.

**Step 4: Commit**

```bash
git add packages/panels/pages/@panel/@resource/+Page.tsx
git commit -m "feat(panels): add Duplicate row action to resource table"
```

---

## Task 6: Copy to playground and verify

**Files to copy:**

```bash
cp packages/panels/pages/@panel/@resource/+Page.tsx \
   "playground/pages/(panels)/@panel/@resource/+Page.tsx"
```

**Step 1: Typecheck playground**

```bash
cd playground && pnpm typecheck
```
Expected: no errors.

**Step 2: Manual test — bulk delete**

Start `cd playground && pnpm dev`, navigate to `/admin/articles`:

- [ ] Check 2+ rows → selection bar appears with "Delete 2 selected" button alongside any custom bulk actions
- [ ] Click "Delete X selected" → ConfirmDialog opens with count in message
- [ ] Cancel → dialog closes, selection preserved
- [ ] Confirm → records deleted, toast shows "2 records deleted.", table reloads

**Step 3: Manual test — duplicate**

- [ ] Click "Duplicate" on any row → brief loading state, navigates to create page
- [ ] Create form is pre-filled with the original record's values
- [ ] Slug field (if present) is pre-filled and auto-generates a new slug from the title
- [ ] BelongsToMany selections (categories etc.) are pre-selected
- [ ] Submitting creates a new record — original is unchanged
- [ ] Cancel → returns to the list (back= param was set correctly)

**Step 4: Commit**

```bash
git add "playground/pages/(panels)/@panel/@resource/+Page.tsx"
git commit -m "feat(panels): sync duplicate and bulk delete to playground"
```

---

## Done

Summary of changes:
- `DELETE /{panel}/api/{resource}` — new bulk delete endpoint, accepts `{ ids: string[] }`
- Selection bar now always shows when rows are selected (not just when custom bulk actions exist)
- "Delete N selected" button in selection bar → confirm dialog → bulk delete → toast
- "Duplicate" button per row → fetches full record → navigates to create page pre-filled
- 6 new i18n keys in `en` and `ar`; 6 new tests (231 total)
