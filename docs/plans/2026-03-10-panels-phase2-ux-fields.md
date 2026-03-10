# Panels Phase 2 — UX Polish & New Fields

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform `@boostkit/panels` from a functional admin scaffold into a polished, production-ready admin framework by adding essential UX (toasts, empty states, show page, breadcrumbs, row actions) and 9 new field types (Password, Slug, Tags, Hidden, Toggle, Color, JSON, Repeater, Builder).

**Architecture:** All UI changes live in `packages/panels/pages/` (published files). All server-side changes live in `packages/panels/src/`. After every UI change, run `pnpm artisan vendor:publish --tag=panels-pages --force` from the playground to sync. New field types follow the existing `Field` → `FieldMeta` → `FieldInput.tsx` pipeline exactly. Tests use `node:test` + `node:assert/strict`.

**Tech Stack:** React, Tailwind CSS (design tokens only — no hardcoded colors), `@base-ui-components/react` (Checkbox, Select, Dialog, Switch), `sonner` (toasts), `vike/client/router` (`navigate()`), TypeScript strict + NodeNext

**shadcn philosophy:** The panels pages use the same primitive layer that shadcn is built on (`@base-ui-components/react`). For toasts we use `sonner` — exactly what shadcn's toast docs recommend. `ToggleField` uses `@base-ui-components/react/switch`. All styling uses shadcn CSS design tokens so the panels automatically inherit the user's shadcn theme.

---

## Key conventions — read before starting

- **Colors**: always use CSS design tokens (`bg-primary`, `text-muted-foreground`, `bg-destructive`, `border-input`, `bg-card`, `bg-background`, `bg-accent`, `text-accent-foreground`) — never `slate-900`, `indigo-600`, etc.
- **Navigation**: use `navigate(url)` from `vike/client/router` for query param changes — never `window.location.href`
- **Full page reload**: use `window.location.reload()` only when intentionally refreshing after a mutation (delete, action)
- **Field extra data**: all field-specific config lives in `this._extra` — serialized automatically by `toMeta()`
- **Published pages**: after editing any file in `packages/panels/pages/`, run `pnpm artisan vendor:publish --tag=panels-pages --force` from playground root

---

## Task 1: Toast notification system (sonner)

Currently zero feedback after create/edit/delete/actions. We use **sonner** — the toast library recommended by shadcn, zero-config, beautiful defaults.

**Files:**
- Modify: `packages/panels/pages/_components/AdminLayout.tsx` (add `<Toaster />`)
- Modify: `packages/panels/pages/@panel/@resource/+Page.tsx` (call `toast.success/error`)
- Modify: `packages/panels/pages/@panel/@resource/create/+Page.tsx`
- Modify: `packages/panels/pages/@panel/@resource/@id/edit/+Page.tsx`

---

**Step 1: Install sonner in the playground**

```bash
cd /Users/sleman/Projects/boostkit/playground
pnpm add sonner
```

**Step 2: Add `<Toaster />` to `AdminLayout.tsx`**

`sonner` works by rendering a single `<Toaster />` once at the layout level. All `toast.*()` calls anywhere in the tree will display there.

In `packages/panels/pages/_components/AdminLayout.tsx`, add import:
```tsx
import { Toaster } from 'sonner'
```

Inside both `SidebarLayout` and `TopbarLayout`, add `<Toaster richColors position="bottom-right" />` as the last child before the closing root `<div>`:

```tsx
  {/* Toasts */}
  <Toaster richColors position="bottom-right" />
```

**Step 3: Wire toasts into the list page**

In `packages/panels/pages/@panel/@resource/+Page.tsx`, add import at the top:
```tsx
import { toast } from 'sonner'
```

Find the delete handler. Before the `window.location.reload()` call, add:
```tsx
toast.success(`${resourceMeta.labelSingular} deleted.`)
```

If the delete fetch fails, add:
```tsx
toast.error('Failed to delete. Please try again.')
```

Find the action handler. After a successful action response:
```tsx
toast.success('Action completed successfully.')
```

On action error:
```tsx
toast.error('Action failed. Please try again.')
```

**Step 4: Wire toasts into the create page**

In `packages/panels/pages/@panel/@resource/create/+Page.tsx`:

```tsx
import { toast } from 'sonner'
```

After a successful POST, before `navigate(...)`:
```tsx
toast.success(`${resourceMeta.labelSingular} created successfully.`)
```

On error (non-422):
```tsx
toast.error('Something went wrong. Please try again.')
```

**Step 5: Wire toasts into the edit page**

Same pattern:
```tsx
import { toast } from 'sonner'
// on success:
toast.success('Changes saved.')
// on error:
toast.error('Failed to save. Please try again.')
```

**Step 6: Publish and test**

```bash
cd /Users/sleman/Projects/boostkit/playground
pnpm artisan vendor:publish --tag=panels-pages --force
```

Open `http://localhost:3000/admin/todos`, create a record — a shadcn-styled toast should appear bottom-right with a green success style.

**Step 7: Commit**

```bash
git add packages/panels/pages/
git commit -m "feat(panels): add sonner toast notifications for create/edit/delete/actions"
```

---

## Task 2: Empty state + no-results state

A blank table with no message is confusing. Two states:
- **Empty**: no records exist at all → "No {resources} yet" with a Create button
- **No results**: search/filter returned nothing → "No results for your search"

**Files:**
- Modify: `packages/panels/pages/@panel/@resource/+Page.tsx`

---

**Step 1: Add empty state to the list page**

In `packages/panels/pages/@panel/@resource/+Page.tsx`, find where the `<tbody>` rows are rendered. After the rows map, add a conditional that spans the full table width when `records.length === 0`:

```tsx
{records.length === 0 && (
  <tr>
    <td
      colSpan={visibleFields.length + 2}
      className="py-16 text-center"
    >
      {hasActiveFilters
        ? (
          <div className="flex flex-col items-center gap-2">
            <span className="text-2xl">🔍</span>
            <p className="text-sm font-medium">No results</p>
            <p className="text-sm text-muted-foreground">Try adjusting your search or filters.</p>
          </div>
        )
        : (
          <div className="flex flex-col items-center gap-3">
            <span className="text-3xl">📭</span>
            <p className="text-sm font-medium">No {resourceMeta.label} yet</p>
            <a
              href={`/${pathSegment}/${slug}/create`}
              className="text-sm text-primary hover:underline"
            >
              Create your first {resourceMeta.labelSingular}
            </a>
          </div>
        )
      }
    </td>
  </tr>
)}
```

`hasActiveFilters` needs to be derived — add near the top of the component:
```tsx
const params       = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '')
const hasActiveFilters = params.has('search') || [...params.keys()].some((k) => k.startsWith('filter['))
```

**Step 2: Publish and test**

```bash
pnpm artisan vendor:publish --tag=panels-pages --force
```

Clear all todos in the playground, open `/admin/todos` — empty state should appear.

**Step 3: Commit**

```bash
git add packages/panels/pages/@panel/@resource/+Page.tsx
git commit -m "feat(panels): add empty state and no-results state to resource list"
```

---

## Task 3: Breadcrumbs on create / edit pages

**Files:**
- Create: `packages/panels/pages/_components/Breadcrumbs.tsx`
- Modify: `packages/panels/pages/@panel/@resource/create/+Page.tsx`
- Modify: `packages/panels/pages/@panel/@resource/@id/edit/+Page.tsx`

---

**Step 1: Create `packages/panels/pages/_components/Breadcrumbs.tsx`**

```tsx
interface Crumb {
  label: string
  href?: string
}

interface Props {
  crumbs: Crumb[]
}

export function Breadcrumbs({ crumbs }: Props) {
  return (
    <nav className="flex items-center gap-1.5 text-sm text-muted-foreground mb-6">
      {crumbs.map((crumb, i) => (
        <span key={i} className="flex items-center gap-1.5">
          {i > 0 && <span>/</span>}
          {crumb.href
            ? <a href={crumb.href} className="hover:text-foreground transition-colors">{crumb.label}</a>
            : <span className="text-foreground font-medium">{crumb.label}</span>
          }
        </span>
      ))}
    </nav>
  )
}
```

**Step 2: Add to create page**

In `packages/panels/pages/@panel/@resource/create/+Page.tsx`:

Add import:
```tsx
import { Breadcrumbs } from '../../../_components/Breadcrumbs.js'
```

Insert before the form `<h1>` or title element:
```tsx
<Breadcrumbs crumbs={[
  { label: panelMeta.branding?.title ?? panelMeta.name, href: `/${pathSegment}/${slug}` },
  { label: resourceMeta.label, href: `/${pathSegment}/${slug}` },
  { label: `New ${resourceMeta.labelSingular}` },
]} />
```

**Step 3: Add to edit page**

Same pattern:
```tsx
<Breadcrumbs crumbs={[
  { label: panelMeta.branding?.title ?? panelMeta.name, href: `/${pathSegment}/${slug}` },
  { label: resourceMeta.label, href: `/${pathSegment}/${slug}` },
  { label: `Edit ${resourceMeta.labelSingular}` },
]} />
```

**Step 4: Publish and commit**

```bash
pnpm artisan vendor:publish --tag=panels-pages --force
git add packages/panels/pages/_components/Breadcrumbs.tsx packages/panels/pages/@panel/
git commit -m "feat(panels): add breadcrumb navigation to create and edit pages"
```

---

## Task 4: Show page (view-only record detail)

A read-only view of a single record. Linked from each table row.

**Files:**
- Create: `packages/panels/pages/@panel/@resource/@id/+Page.tsx`
- Create: `packages/panels/pages/@panel/@resource/@id/+data.ts`
- Modify: `packages/panels/pages/@panel/@resource/+Page.tsx` (link row to show page)

---

**Step 1: Create `packages/panels/pages/@panel/@resource/@id/+data.ts`**

```ts
import { PanelRegistry } from '@boostkit/panels'
import type { PageContextServer } from 'vike/types'

export type Data = Awaited<ReturnType<typeof data>>

export async function data(pageContext: PageContextServer) {
  const { panel: pathSegment, resource: slug, id } = pageContext.routeParams as {
    panel:    string
    resource: string
    id:       string
  }

  const panel = PanelRegistry.all().find((p) => p.getPath() === `/${pathSegment}`)
  if (!panel) throw new Error(`Panel "/${pathSegment}" not found.`)

  const ResourceClass = panel.getResources().find((R) => R.getSlug() === slug)
  if (!ResourceClass) throw new Error(`Resource "${slug}" not found.`)

  const resource     = new ResourceClass()
  const resourceMeta = resource.toMeta()
  const panelMeta    = panel.toMeta()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Model  = ResourceClass.model as any
  const record = Model ? await Model.query().find(id) : null

  return { panelMeta, resourceMeta, record, pathSegment, slug, id }
}
```

**Step 2: Create `packages/panels/pages/@panel/@resource/@id/+Page.tsx`**

```tsx
import { useData }      from 'vike-react/useData'
import { AdminLayout }  from '../../../_components/AdminLayout.js'
import { Breadcrumbs }  from '../../../_components/Breadcrumbs.js'
import type { Data }    from './+data.js'

export default function ShowPage() {
  const { panelMeta, resourceMeta, record, pathSegment, slug, id } = useData<Data>()

  const viewFields = resourceMeta.fields.filter(
    (f) => !f.hidden.includes('view') && f.type !== 'password',
  )

  function renderValue(field: typeof viewFields[number], value: unknown): string {
    if (value === null || value === undefined) return '—'
    if (field.type === 'boolean')  return value ? 'Yes' : 'No'
    if (field.type === 'date')     return new Date(String(value)).toLocaleDateString()
    if (field.type === 'datetime') return new Date(String(value)).toLocaleString()
    if (field.type === 'color')    return String(value)
    if (Array.isArray(value))      return value.join(', ')
    if (typeof value === 'object') return JSON.stringify(value, null, 2)
    return String(value)
  }

  return (
    <AdminLayout panelMeta={panelMeta} currentSlug={slug}>
      <div className="max-w-2xl">
        <Breadcrumbs crumbs={[
          { label: panelMeta.branding?.title ?? panelMeta.name, href: `/${pathSegment}/${slug}` },
          { label: resourceMeta.label, href: `/${pathSegment}/${slug}` },
          { label: resourceMeta.labelSingular },
        ]} />

        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-semibold">{resourceMeta.labelSingular}</h1>
          <a
            href={`/${pathSegment}/${slug}/${id}/edit`}
            className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity"
          >
            Edit
          </a>
        </div>

        <div className="rounded-lg border bg-card overflow-hidden">
          <dl className="divide-y">
            {viewFields.map((field) => {
              const value = record ? (record as Record<string, unknown>)[field.name] : undefined
              return (
                <div key={field.name} className="grid grid-cols-3 gap-4 px-6 py-4">
                  <dt className="text-sm font-medium text-muted-foreground">{field.label}</dt>
                  <dd className="col-span-2 text-sm">
                    {field.type === 'color' && value
                      ? (
                        <span className="flex items-center gap-2">
                          <span
                            className="inline-block h-4 w-4 rounded-full border"
                            style={{ backgroundColor: String(value) }}
                          />
                          {String(value)}
                        </span>
                      )
                      : renderValue(field, value)
                    }
                  </dd>
                </div>
              )
            })}
          </dl>
        </div>

        <div className="mt-4">
          <a
            href={`/${pathSegment}/${slug}`}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            ← Back to {resourceMeta.label}
          </a>
        </div>
      </div>
    </AdminLayout>
  )
}
```

**Step 3: Link table rows to the show page**

In `packages/panels/pages/@panel/@resource/+Page.tsx`, find where each row is rendered. The first cell (or the record ID/name cell) should be a link to the show page:

Find the record name/first-field cell and wrap its content with a link:
```tsx
<a
  href={`/${pathSegment}/${slug}/${(record as any).id}`}
  className="font-medium hover:text-primary transition-colors"
>
  {cellValue}
</a>
```

**Step 4: Publish and test**

```bash
pnpm artisan vendor:publish --tag=panels-pages --force
```

Open `/admin/users`, click a record — should navigate to `/admin/users/1` with the view page.

**Step 5: Commit**

```bash
git add packages/panels/pages/@panel/@resource/@id/+Page.tsx packages/panels/pages/@panel/@resource/@id/+data.ts packages/panels/pages/@panel/@resource/+Page.tsx
git commit -m "feat(panels): add show page for view-only record detail"
```

---

## Task 5: Default sort + per-page selector on Resource

**Files:**
- Modify: `packages/panels/src/Resource.ts`
- Modify: `packages/panels/src/resourceData.ts`
- Modify: `packages/panels/src/index.test.ts`
- Modify: `packages/panels/pages/@panel/@resource/+Page.tsx` (per-page UI)

---

**Step 1: Add tests**

In `packages/panels/src/index.test.ts`, inside `describe('Resource', ...)`, add:

```ts
  it('defaultSort defaults to undefined', () => {
    class R extends Resource { fields() { return [] } }
    assert.equal(R.defaultSort, undefined)
  })

  it('defaultSort and defaultSortDir appear in meta', () => {
    class R extends Resource {
      static defaultSort    = 'createdAt'
      static defaultSortDir = 'DESC' as const
      fields() { return [] }
    }
    const meta = new R().toMeta()
    assert.equal(meta.defaultSort, 'createdAt')
    assert.equal(meta.defaultSortDir, 'DESC')
  })
```

**Step 2: Run to confirm they fail**

```bash
cd packages/panels && pnpm test 2>&1 | grep -E 'defaultSort|FAIL' | head -10
```

**Step 3: Update `packages/panels/src/Resource.ts`**

Add static properties after `static icon`:
```ts
  /** Default sort column (e.g. 'createdAt'). Applied when no ?sort param in URL. */
  static defaultSort?:    string
  /** Default sort direction. Applies with defaultSort. */
  static defaultSortDir?: 'ASC' | 'DESC'
```

Add to `ResourceMeta` interface:
```ts
export interface ResourceMeta {
  // ...existing fields...
  defaultSort?:    string
  defaultSortDir?: 'ASC' | 'DESC'
}
```

Add to `toMeta()` return:
```ts
  toMeta(): ResourceMeta {
    const Cls = this.constructor as typeof Resource
    return {
      // ...existing fields...
      defaultSort:    Cls.defaultSort,
      defaultSortDir: Cls.defaultSortDir,
    }
  }
```

**Step 4: Update `packages/panels/src/resourceData.ts`**

After resolving `ResourceClass`, update the sort logic to fall back to resource defaults:

```ts
  const sortDefault    = ResourceClass.defaultSort
  const sortDirDefault = ResourceClass.defaultSortDir ?? 'ASC'

  const sort = params.get('sort') ?? sortDefault
  const dir  = (params.get('dir') ?? sortDirDefault).toUpperCase() as 'ASC' | 'DESC'
```

**Step 5: Run tests**

```bash
cd packages/panels && pnpm test 2>&1 | tail -10
```

Expected: all tests pass.

**Step 6: Add per-page selector to the list page UI**

In `packages/panels/pages/@panel/@resource/+Page.tsx`, find the pagination controls section. Add a per-page selector beside pagination:

```tsx
{/* Per-page selector */}
<select
  value={pagination?.perPage ?? 15}
  onChange={(e) => {
    const url = new URL(window.location.href)
    url.searchParams.set('perPage', e.target.value)
    url.searchParams.delete('page')
    void navigate(url.pathname + url.search)
  }}
  className="text-sm border border-input rounded-md px-2 py-1 bg-background"
>
  {[10, 15, 25, 50, 100].map((n) => (
    <option key={n} value={n}>{n} / page</option>
  ))}
</select>
```

Also update the `resourceData` call in `+data.ts` to read `perPage` from URL params (currently hardcoded to 15):

In `playground/pages/(panels)/@panel/@resource/+data.ts`, the playground delegates to `resourceData()`. Update `resourceData.ts` to read `perPage`:

```ts
  const perPage = Math.min(Number(params.get('perPage') ?? 15), 100)
  // then use perPage in q.paginate(page, perPage)
```

**Step 7: Build + publish**

```bash
cd packages/panels && pnpm build
cd ../../playground && pnpm artisan vendor:publish --tag=panels-pages --force
```

**Step 8: Commit**

```bash
git add packages/panels/src/ playground/pages/
git commit -m "feat(panels): add defaultSort, defaultSortDir on Resource + per-page selector"
```

---

## Task 6: Row actions (per-record custom actions)

Currently `Action.bulk()` shows in the bulk bar. Add `.row()` for per-record actions displayed in the table row.

**Files:**
- Modify: `packages/panels/src/Action.ts`
- Modify: `packages/panels/src/index.test.ts`
- Modify: `packages/panels/pages/@panel/@resource/+Page.tsx`

---

**Step 1: Add tests**

In `packages/panels/src/index.test.ts`, inside `describe('Action', ...)`:

```ts
  it('row() marks action as row action', () => {
    const a = Action.make('impersonate').row()
    assert.equal(a.toMeta().row, true)
  })

  it('row defaults to false', () => {
    assert.equal(Action.make('x').toMeta().row, false)
  })

  it('bulk defaults to true', () => {
    assert.equal(Action.make('x').toMeta().bulk, true)
  })
```

**Step 2: Run to confirm failure**

```bash
cd packages/panels && pnpm test 2>&1 | grep 'row\|FAIL' | head -10
```

**Step 3: Update `packages/panels/src/Action.ts`**

Add `row` to `ActionMeta`:
```ts
export interface ActionMeta {
  // ...existing...
  row:  boolean
  bulk: boolean
}
```

Add `_row` property and `.row()` method to `Action`:
```ts
  private _row  = false
  private _bulk = true

  /** Show this action as a button on each table row. */
  row(value = true): this {
    this._row = value
    return this
  }
```

Update `toMeta()`:
```ts
  toMeta(): ActionMeta {
    return {
      // ...existing...
      row:  this._row,
      bulk: this._bulk,
    }
  }
```

**Step 4: Run tests**

```bash
cd packages/panels && pnpm test 2>&1 | tail -10
```

**Step 5: Add row actions dropdown to the list UI**

In `packages/panels/pages/@panel/@resource/+Page.tsx`:

Derive row actions near the top of the component:
```tsx
const rowActions = resourceMeta.actions.filter((a) => a.row)
```

In the table row, find the actions cell (currently has Edit + Delete buttons). Add row actions before the Edit button:

```tsx
{rowActions.map((action) => (
  <button
    key={action.name}
    onClick={() => {
      if (action.confirm) {
        setPendingAction({ action, ids: [(record as any).id] })
      } else {
        void runAction(action.name, [(record as any).id])
      }
    }}
    className={[
      'px-2 py-1 rounded text-xs font-medium transition-colors',
      action.destructive
        ? 'text-destructive hover:bg-destructive/10'
        : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
    ].join(' ')}
  >
    {action.icon && <span className="mr-1">{action.icon}</span>}
    {action.label}
  </button>
))}
```

**Step 6: Build + publish + commit**

```bash
cd packages/panels && pnpm build
cd ../../playground && pnpm artisan vendor:publish --tag=panels-pages --force
git add packages/panels/src/Action.ts packages/panels/src/index.test.ts packages/panels/pages/@panel/@resource/+Page.tsx
git commit -m "feat(panels): add row actions for per-record custom operations"
```

---

## Task 7: PasswordField

**Files:**
- Create: `packages/panels/src/fields/PasswordField.ts`
- Modify: `packages/panels/src/index.ts`
- Modify: `packages/panels/src/index.test.ts`
- Modify: `packages/panels/pages/_components/FieldInput.tsx`

---

**Step 1: Add tests**

In `packages/panels/src/index.test.ts`, inside `describe('Fields', ...)` or at the end of the field tests:

```ts
  describe('PasswordField', () => {
    it('type is password', () => {
      assert.equal(PasswordField.make('password').toMeta().type, 'password')
    })

    it('confirm() sets confirm flag', () => {
      assert.equal(PasswordField.make('password').confirm().toMeta().extra['confirm'], true)
    })

    it('confirm defaults to false', () => {
      assert.equal(PasswordField.make('password').toMeta().extra['confirm'], false)
    })

    it('is hidden from table by default', () => {
      assert.ok(PasswordField.make('password').toMeta().hidden.includes('table'))
    })
  })
```

**Step 2: Create `packages/panels/src/fields/PasswordField.ts`**

```ts
import { Field } from '../Field.js'

export class PasswordField extends Field {
  constructor(name: string) {
    super(name)
    this._extra['confirm'] = false
    this.hideFromTable()   // passwords never shown in table
  }

  static make(name: string): PasswordField {
    return new PasswordField(name)
  }

  /** Show a "confirm password" input below the main input. */
  confirm(value = true): this {
    this._extra['confirm'] = value
    return this
  }

  getType(): string { return 'password' }
}
```

**Step 3: Export from `packages/panels/src/index.ts`**

Add:
```ts
export { PasswordField } from './fields/PasswordField.js'
```

**Step 4: Run tests**

```bash
cd packages/panels && pnpm test 2>&1 | tail -10
```

**Step 5: Add rendering in `FieldInput.tsx`**

In `packages/panels/pages/_components/FieldInput.tsx`, add a `PasswordField` case before the custom renderer check:

```tsx
  // ── Password ─────────────────────────────────────────────
  if (field.type === 'password') {
    return (
      <div className="flex flex-col gap-2">
        <input
          type="password"
          name={field.name}
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          required={field.required}
          placeholder="••••••••"
          autoComplete="new-password"
          className={inputCls}
        />
        {field.extra?.confirm && (
          <input
            type="password"
            name={`${field.name}_confirmation`}
            placeholder="Confirm password"
            autoComplete="new-password"
            className={inputCls}
          />
        )}
      </div>
    )
  }
```

**Step 6: Build + publish + commit**

```bash
cd packages/panels && pnpm build
cd ../../playground && pnpm artisan vendor:publish --tag=panels-pages --force
git add packages/panels/src/fields/PasswordField.ts packages/panels/src/index.ts packages/panels/src/index.test.ts packages/panels/pages/_components/FieldInput.tsx
git commit -m "feat(panels): add PasswordField with optional confirm input"
```

---

## Task 8: SlugField

Auto-generates a URL slug from another field's value. User can override manually.

**Files:**
- Create: `packages/panels/src/fields/SlugField.ts`
- Modify: `packages/panels/src/index.ts`
- Modify: `packages/panels/src/index.test.ts`
- Modify: `packages/panels/pages/_components/FieldInput.tsx`

---

**Step 1: Add tests**

```ts
  describe('SlugField', () => {
    it('type is slug', () => {
      assert.equal(SlugField.make('slug').toMeta().type, 'slug')
    })

    it('from() sets source field', () => {
      assert.equal(SlugField.make('slug').from('title').toMeta().extra['from'], 'title')
    })

    it('from defaults to undefined', () => {
      assert.equal(SlugField.make('slug').toMeta().extra['from'], undefined)
    })
  })
```

**Step 2: Create `packages/panels/src/fields/SlugField.ts`**

```ts
import { Field } from '../Field.js'

export class SlugField extends Field {
  static make(name: string): SlugField {
    return new SlugField(name)
  }

  /**
   * The field name to generate the slug from.
   * @example SlugField.make('slug').from('title')
   */
  from(fieldName: string): this {
    this._extra['from'] = fieldName
    return this
  }

  getType(): string { return 'slug' }
}
```

**Step 3: Export from index**

```ts
export { SlugField } from './fields/SlugField.js'
```

**Step 4: Run tests**

```bash
cd packages/panels && pnpm test 2>&1 | tail -10
```

**Step 5: Add rendering in `FieldInput.tsx`**

The slug field needs to watch the source field. Since `FieldInput` doesn't have access to other fields, we handle the auto-generation at the form level by adding a `useEffect` hook **in the create/edit pages** that watches the source field.

For now, render slug as a text input with a visual indicator in `FieldInput.tsx`:

```tsx
  // ── Slug ─────────────────────────────────────────────────
  if (field.type === 'slug') {
    return (
      <div className="flex items-center rounded-md border border-input bg-muted overflow-hidden focus-within:ring-2 focus-within:ring-ring focus-within:border-transparent">
        <span className="px-3 text-sm text-muted-foreground select-none border-r border-input bg-muted">/</span>
        <input
          type="text"
          name={field.name}
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          required={field.required}
          readOnly={field.readonly}
          placeholder="my-slug"
          className="flex-1 px-3 py-2 text-sm bg-background focus:outline-none"
        />
      </div>
    )
  }
```

Then, in `create/+Page.tsx` and `edit/+Page.tsx`, add a `useEffect` that auto-generates the slug whenever the source field changes. Find the `useEffect` imports and add:

```tsx
// Auto-generate slug from source field
useEffect(() => {
  const slugFields = resourceMeta.fields.filter((f) => f.type === 'slug' && f.extra?.from)
  for (const slugField of slugFields) {
    const sourceField = String(slugField.extra?.from ?? '')
    const sourceValue = String(form[sourceField] ?? '')
    if (!form[slugField.name] || form[slugField.name] === generateSlug(String(form[slugField.name]))) {
      setForm((prev) => ({ ...prev, [slugField.name]: generateSlug(sourceValue) }))
    }
  }
}, [Object.values(form).join(',')])

function generateSlug(str: string): string {
  return str
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
```

**Step 6: Build + publish + commit**

```bash
cd packages/panels && pnpm build
cd ../../playground && pnpm artisan vendor:publish --tag=panels-pages --force
git add packages/panels/src/fields/SlugField.ts packages/panels/src/index.ts packages/panels/src/index.test.ts packages/panels/pages/
git commit -m "feat(panels): add SlugField with auto-generation from source field"
```

---

## Task 9: TagsField

Multi-value text input. Value is an array of strings.

**Files:**
- Create: `packages/panels/src/fields/TagsField.ts`
- Modify: `packages/panels/src/index.ts`
- Modify: `packages/panels/src/index.test.ts`
- Modify: `packages/panels/pages/_components/FieldInput.tsx`

---

**Step 1: Add tests**

```ts
  describe('TagsField', () => {
    it('type is tags', () => {
      assert.equal(TagsField.make('tags').toMeta().type, 'tags')
    })

    it('placeholder() sets placeholder', () => {
      assert.equal(TagsField.make('tags').placeholder('Add a tag').toMeta().extra['placeholder'], 'Add a tag')
    })
  })
```

**Step 2: Create `packages/panels/src/fields/TagsField.ts`**

```ts
import { Field } from '../Field.js'

export class TagsField extends Field {
  static make(name: string): TagsField {
    return new TagsField(name)
  }

  placeholder(text: string): this {
    this._extra['placeholder'] = text
    return this
  }

  getType(): string { return 'tags' }
}
```

**Step 3: Export from index**

```ts
export { TagsField } from './fields/TagsField.js'
```

**Step 4: Run tests**

```bash
cd packages/panels && pnpm test 2>&1 | tail -10
```

**Step 5: Add rendering in `FieldInput.tsx`**

```tsx
  // ── Tags ─────────────────────────────────────────────────
  if (field.type === 'tags') {
    const tags = Array.isArray(value) ? (value as string[]) : []

    function addTag(input: HTMLInputElement) {
      const tag = input.value.trim().replace(/,+$/, '')
      if (!tag || tags.includes(tag)) { input.value = ''; return }
      onChange([...tags, tag])
      input.value = ''
    }

    return (
      <div className="flex flex-wrap gap-1.5 p-2 rounded-md border border-input bg-background min-h-[42px] focus-within:ring-2 focus-within:ring-ring">
        {tags.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-medium"
          >
            {tag}
            <button
              type="button"
              onClick={() => onChange(tags.filter((t) => t !== tag))}
              className="hover:text-destructive leading-none"
            >
              ×
            </button>
          </span>
        ))}
        <input
          type="text"
          placeholder={(field.extra?.placeholder as string) ?? 'Add tag…'}
          className="flex-1 min-w-[80px] text-sm outline-none bg-transparent"
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault()
              addTag(e.currentTarget)
            }
            if (e.key === 'Backspace' && !e.currentTarget.value && tags.length > 0) {
              onChange(tags.slice(0, -1))
            }
          }}
          onBlur={(e) => addTag(e.currentTarget)}
        />
      </div>
    )
  }
```

**Step 6: Build + publish + commit**

```bash
cd packages/panels && pnpm build
cd ../../playground && pnpm artisan vendor:publish --tag=panels-pages --force
git add packages/panels/src/fields/TagsField.ts packages/panels/src/index.ts packages/panels/src/index.test.ts packages/panels/pages/_components/FieldInput.tsx
git commit -m "feat(panels): add TagsField with chip-style multi-value input"
```

---

## Task 10: HiddenField

A field that submits a value but is never shown to the user.

**Files:**
- Create: `packages/panels/src/fields/HiddenField.ts`
- Modify: `packages/panels/src/index.ts`
- Modify: `packages/panels/src/index.test.ts`
- Modify: `packages/panels/pages/_components/FieldInput.tsx`

---

**Step 1: Add tests**

```ts
  describe('HiddenField', () => {
    it('type is hidden', () => {
      assert.equal(HiddenField.make('userId').toMeta().type, 'hidden')
    })

    it('default() sets default value', () => {
      assert.equal(HiddenField.make('status').default('draft').toMeta().extra['default'], 'draft')
    })

    it('is hidden from table, create (visible), and edit by default', () => {
      const meta = HiddenField.make('x').toMeta()
      assert.ok(meta.hidden.includes('table'))
    })
  })
```

**Step 2: Create `packages/panels/src/fields/HiddenField.ts`**

```ts
import { Field } from '../Field.js'

export class HiddenField extends Field {
  constructor(name: string) {
    super(name)
    this.hideFromTable()
  }

  static make(name: string): HiddenField {
    return new HiddenField(name)
  }

  /** Static default value sent with every create/edit form. */
  default(value: string | number | boolean): this {
    this._extra['default'] = value
    return this
  }

  getType(): string { return 'hidden' }
}
```

**Step 3: Export from index**

```ts
export { HiddenField } from './fields/HiddenField.js'
```

**Step 4: Run tests**

```bash
cd packages/panels && pnpm test 2>&1 | tail -10
```

**Step 5: Add rendering in `FieldInput.tsx`**

```tsx
  // ── Hidden ───────────────────────────────────────────────
  if (field.type === 'hidden') {
    return (
      <input
        type="hidden"
        name={field.name}
        value={String((value ?? field.extra?.default) ?? '')}
      />
    )
  }
```

Also, in `create/+Page.tsx` and `edit/+Page.tsx`, initialize hidden fields with their default value. In the `useState` initialization that builds the initial form state, add:

```tsx
// Initialize hidden fields with their defaults
const hiddenFields = resourceMeta.fields.filter((f) => f.type === 'hidden')
for (const hf of hiddenFields) {
  if (initial[hf.name] === undefined && hf.extra?.default !== undefined) {
    initial[hf.name] = hf.extra.default
  }
}
```

**Step 6: Build + publish + commit**

```bash
cd packages/panels && pnpm build
cd ../../playground && pnpm artisan vendor:publish --tag=panels-pages --force
git add packages/panels/src/fields/HiddenField.ts packages/panels/src/index.ts packages/panels/src/index.test.ts packages/panels/pages/
git commit -m "feat(panels): add HiddenField for hidden form values with defaults"
```

---

## Task 11: ToggleField

A toggle switch — better UX than a checkbox for boolean values.

**Files:**
- Create: `packages/panels/src/fields/ToggleField.ts`
- Modify: `packages/panels/src/index.ts`
- Modify: `packages/panels/src/index.test.ts`
- Modify: `packages/panels/pages/_components/FieldInput.tsx`

---

**Step 1: Add tests**

```ts
  describe('ToggleField', () => {
    it('type is toggle', () => {
      assert.equal(ToggleField.make('active').toMeta().type, 'toggle')
    })

    it('onLabel/offLabel defaults', () => {
      const meta = ToggleField.make('active').toMeta()
      assert.equal(meta.extra['onLabel'],  'On')
      assert.equal(meta.extra['offLabel'], 'Off')
    })

    it('custom labels', () => {
      const meta = ToggleField.make('published')
        .onLabel('Published').offLabel('Draft').toMeta()
      assert.equal(meta.extra['onLabel'],  'Published')
      assert.equal(meta.extra['offLabel'], 'Draft')
    })
  })
```

**Step 2: Create `packages/panels/src/fields/ToggleField.ts`**

```ts
import { Field } from '../Field.js'

export class ToggleField extends Field {
  constructor(name: string) {
    super(name)
    this._extra['onLabel']  = 'On'
    this._extra['offLabel'] = 'Off'
  }

  static make(name: string): ToggleField {
    return new ToggleField(name)
  }

  onLabel(label: string): this  { this._extra['onLabel']  = label; return this }
  offLabel(label: string): this { this._extra['offLabel'] = label; return this }

  getType(): string { return 'toggle' }
}
```

**Step 3: Export from index**

```ts
export { ToggleField } from './fields/ToggleField.js'
```

**Step 4: Run tests**

```bash
cd packages/panels && pnpm test 2>&1 | tail -10
```

**Step 5: Add rendering in `FieldInput.tsx`**

Use `@base-ui-components/react/switch` — the same primitive shadcn's Switch component is built on. Already installed since `@base-ui-components/react` is a dependency of the panels package.

Add to the imports at the top of `FieldInput.tsx`:
```tsx
import { Switch } from '@base-ui-components/react/switch'
```

Then add the Toggle case:

```tsx
  // ── Toggle (Switch) ──────────────────────────────────────
  if (field.type === 'toggle') {
    const checked  = !!value
    const onLabel  = (field.extra?.onLabel  as string) ?? 'On'
    const offLabel = (field.extra?.offLabel as string) ?? 'Off'
    return (
      <div className="flex items-center gap-3">
        <Switch.Root
          checked={checked}
          onCheckedChange={(c) => onChange(c)}
          className={[
            'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent',
            'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
            checked ? 'bg-primary' : 'bg-muted',
          ].join(' ')}
        >
          <Switch.Thumb
            className={[
              'pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm ring-0 transition-transform',
              checked ? 'translate-x-5' : 'translate-x-0',
            ].join(' ')}
          />
        </Switch.Root>
        <span className="text-sm text-muted-foreground">
          {checked ? onLabel : offLabel}
        </span>
      </div>
    )
  }
```

**Step 6: Build + publish + commit**

```bash
cd packages/panels && pnpm build
cd ../../playground && pnpm artisan vendor:publish --tag=panels-pages --force
git add packages/panels/src/fields/ToggleField.ts packages/panels/src/index.ts packages/panels/src/index.test.ts packages/panels/pages/_components/FieldInput.tsx
git commit -m "feat(panels): add ToggleField with switch UI"
```

---

## Task 12: ColorField

Color picker using the native `<input type="color">`. Shows a color swatch in the table.

**Files:**
- Create: `packages/panels/src/fields/ColorField.ts`
- Modify: `packages/panels/src/index.ts`
- Modify: `packages/panels/src/index.test.ts`
- Modify: `packages/panels/pages/_components/FieldInput.tsx`
- Modify: `packages/panels/pages/@panel/@resource/+Page.tsx` (swatch in table)

---

**Step 1: Add tests**

```ts
  describe('ColorField', () => {
    it('type is color', () => {
      assert.equal(ColorField.make('brandColor').toMeta().type, 'color')
    })
  })
```

**Step 2: Create `packages/panels/src/fields/ColorField.ts`**

```ts
import { Field } from '../Field.js'

export class ColorField extends Field {
  static make(name: string): ColorField {
    return new ColorField(name)
  }

  getType(): string { return 'color' }
}
```

**Step 3: Export from index**

```ts
export { ColorField } from './fields/ColorField.js'
```

**Step 4: Run tests**

```bash
cd packages/panels && pnpm test 2>&1 | tail -10
```

**Step 5: Add rendering in `FieldInput.tsx`**

```tsx
  // ── Color ────────────────────────────────────────────────
  if (field.type === 'color') {
    return (
      <div className="flex items-center gap-3">
        <input
          type="color"
          name={field.name}
          value={(value as string) ?? '#000000'}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-14 cursor-pointer rounded border border-input bg-background p-0.5"
        />
        <span className="text-sm text-muted-foreground font-mono">
          {(value as string) ?? '#000000'}
        </span>
      </div>
    )
  }
```

**Step 6: Add swatch in table**

In `packages/panels/pages/@panel/@resource/+Page.tsx`, find where table cell values are rendered. Add a color swatch case:

```tsx
{field.type === 'color' && cellValue
  ? (
    <span className="flex items-center gap-2">
      <span
        className="inline-block h-4 w-4 rounded-full border"
        style={{ backgroundColor: String(cellValue) }}
      />
      <span className="font-mono text-xs">{String(cellValue)}</span>
    </span>
  )
  : String(cellValue ?? '—')
}
```

**Step 7: Build + publish + commit**

```bash
cd packages/panels && pnpm build
cd ../../playground && pnpm artisan vendor:publish --tag=panels-pages --force
git add packages/panels/src/fields/ColorField.ts packages/panels/src/index.ts packages/panels/src/index.test.ts packages/panels/pages/
git commit -m "feat(panels): add ColorField with native color picker and table swatch"
```

---

## Task 13: JsonField

JSON editor with validation. Shows a compact preview in the table.

**Files:**
- Create: `packages/panels/src/fields/JsonField.ts`
- Modify: `packages/panels/src/index.ts`
- Modify: `packages/panels/src/index.test.ts`
- Modify: `packages/panels/pages/_components/FieldInput.tsx`

---

**Step 1: Add tests**

```ts
  describe('JsonField', () => {
    it('type is json', () => {
      assert.equal(JsonField.make('metadata').toMeta().type, 'json')
    })

    it('rows() sets row count', () => {
      assert.equal(JsonField.make('metadata').rows(10).toMeta().extra['rows'], 10)
    })
  })
```

**Step 2: Create `packages/panels/src/fields/JsonField.ts`**

```ts
import { Field } from '../Field.js'

export class JsonField extends Field {
  constructor(name: string) {
    super(name)
    this._extra['rows'] = 6
  }

  static make(name: string): JsonField {
    return new JsonField(name)
  }

  rows(n: number): this {
    this._extra['rows'] = n
    return this
  }

  getType(): string { return 'json' }
}
```

**Step 3: Export from index**

```ts
export { JsonField } from './fields/JsonField.js'
```

**Step 4: Run tests**

```bash
cd packages/panels && pnpm test 2>&1 | tail -10
```

Expected: all tests pass.

**Step 5: Add rendering in `FieldInput.tsx`**

```tsx
  // ── JSON ─────────────────────────────────────────────────
  if (field.type === 'json') {
    const [jsonError, setJsonError] = useState<string | null>(null)
    const rawValue = typeof value === 'string'
      ? value
      : JSON.stringify(value ?? {}, null, 2)

    return (
      <div className="flex flex-col gap-1">
        <textarea
          name={field.name}
          defaultValue={rawValue}
          rows={(field.extra?.rows as number) ?? 6}
          spellCheck={false}
          className={[inputCls, 'font-mono text-xs', jsonError ? 'border-destructive' : ''].join(' ')}
          onChange={(e) => {
            try {
              JSON.parse(e.target.value)
              setJsonError(null)
              onChange(e.target.value)
            } catch {
              setJsonError('Invalid JSON')
            }
          }}
        />
        {jsonError && <p className="text-xs text-destructive">{jsonError}</p>}
      </div>
    )
  }
```

Note: `useState` must be imported at the top of `FieldInput.tsx` — add it if not already there:
```tsx
import { useState } from 'react'
```

**Step 6: Build + publish + commit**

```bash
cd packages/panels && pnpm build
cd ../../playground && pnpm artisan vendor:publish --tag=panels-pages --force
git add packages/panels/src/fields/JsonField.ts packages/panels/src/index.ts packages/panels/src/index.test.ts packages/panels/pages/_components/FieldInput.tsx
git commit -m "feat(panels): add JsonField with inline validation"
```

---

## Task 14: RepeaterField

A repeatable group of sub-fields — each item is a set of fields defined by a schema. PayloadCMS calls this "Blocks", Filament calls it "Repeater". Stores as a JSON array.

```ts
RepeaterField.make('features').schema([
  TextField.make('title').required(),
  TextareaField.make('description'),
  BooleanField.make('highlighted'),
])
```

**Files:**
- Create: `packages/panels/src/fields/RepeaterField.ts`
- Modify: `packages/panels/src/index.ts`
- Modify: `packages/panels/src/index.test.ts`
- Modify: `packages/panels/pages/_components/FieldInput.tsx`

---

**Step 1: Add tests**

```ts
  describe('RepeaterField', () => {
    it('type is repeater', () => {
      assert.equal(RepeaterField.make('items').toMeta().type, 'repeater')
    })

    it('schema() stores field metas in extra', () => {
      const f = RepeaterField.make('features').schema([
        TextField.make('title'),
        BooleanField.make('active'),
      ])
      const meta = f.toMeta()
      const schema = meta.extra['schema'] as Array<{ type: string; name: string }>
      assert.equal(schema.length, 2)
      assert.equal(schema[0]?.type, 'text')
      assert.equal(schema[1]?.type, 'boolean')
    })

    it('addLabel() sets the add button label', () => {
      const f = RepeaterField.make('items').addLabel('Add Feature')
      assert.equal(f.toMeta().extra['addLabel'], 'Add Feature')
    })

    it('addLabel defaults to "Add item"', () => {
      assert.equal(RepeaterField.make('items').toMeta().extra['addLabel'], 'Add item')
    })

    it('maxItems() sets max', () => {
      assert.equal(RepeaterField.make('items').maxItems(5).toMeta().extra['maxItems'], 5)
    })
  })
```

**Step 2: Run to confirm they fail**

```bash
cd packages/panels && pnpm test 2>&1 | grep -E 'RepeaterField|FAIL' | head -10
```

**Step 3: Create `packages/panels/src/fields/RepeaterField.ts`**

```ts
import { Field } from '../Field.js'

export class RepeaterField extends Field {
  constructor(name: string) {
    super(name)
    this._extra['schema']   = []
    this._extra['addLabel'] = 'Add item'
  }

  static make(name: string): RepeaterField {
    return new RepeaterField(name)
  }

  /**
   * Define the fields for each repeater item.
   * @example
   * RepeaterField.make('features').schema([
   *   TextField.make('title').required(),
   *   TextareaField.make('description'),
   * ])
   */
  schema(fields: Field[]): this {
    this._extra['schema'] = fields.map((f) => f.toMeta())
    return this
  }

  /** Label for the "add item" button. Defaults to "Add item". */
  addLabel(label: string): this {
    this._extra['addLabel'] = label
    return this
  }

  /** Maximum number of items allowed. */
  maxItems(n: number): this {
    this._extra['maxItems'] = n
    return this
  }

  getType(): string { return 'repeater' }
}
```

**Step 4: Export from `packages/panels/src/index.ts`**

```ts
export { RepeaterField } from './fields/RepeaterField.js'
```

**Step 5: Run tests**

```bash
cd packages/panels && pnpm test 2>&1 | tail -10
```

Expected: all tests pass.

**Step 6: Add rendering in `FieldInput.tsx`**

The repeater renders a list of item cards, each containing a nested set of `FieldInput` components — one per field in the schema.

Import `FieldMeta` at the top of `FieldInput.tsx` if not already (it's imported from `@boostkit/panels`).

Add the case before the custom renderer fallback:

```tsx
  // ── Repeater ─────────────────────────────────────────────
  if (field.type === 'repeater') {
    const schema   = (field.extra?.schema ?? []) as FieldMeta[]
    const addLabel = (field.extra?.addLabel as string) ?? 'Add item'
    const maxItems = field.extra?.maxItems as number | undefined
    const items    = Array.isArray(value) ? (value as Record<string, unknown>[]) : []

    function updateItem(index: number, fieldName: string, fieldValue: unknown) {
      const next = items.map((item, i) =>
        i === index ? { ...item, [fieldName]: fieldValue } : item,
      )
      onChange(next)
    }

    function addItem() {
      if (maxItems !== undefined && items.length >= maxItems) return
      const empty: Record<string, unknown> = {}
      for (const f of schema) empty[f.name] = undefined
      onChange([...items, empty])
    }

    function removeItem(index: number) {
      onChange(items.filter((_, i) => i !== index))
    }

    return (
      <div className="flex flex-col gap-3">
        {items.map((item, index) => (
          <div key={index} className="rounded-lg border border-input bg-card p-4 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Item {index + 1}
              </span>
              <button
                type="button"
                onClick={() => removeItem(index)}
                className="text-xs text-destructive hover:underline"
              >
                Remove
              </button>
            </div>

            {schema.map((subField) => (
              <div key={subField.name} className="flex flex-col gap-1.5">
                <label className="text-sm font-medium">
                  {subField.label}
                  {subField.required && <span className="text-destructive ml-0.5">*</span>}
                </label>
                <FieldInput
                  field={subField}
                  value={item[subField.name]}
                  onChange={(v) => updateItem(index, subField.name, v)}
                />
              </div>
            ))}
          </div>
        ))}

        {(maxItems === undefined || items.length < maxItems) && (
          <button
            type="button"
            onClick={addItem}
            className="flex items-center gap-2 px-4 py-2 rounded-md border border-dashed border-input text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors w-full justify-center"
          >
            <span className="text-base leading-none">+</span>
            {addLabel}
          </button>
        )}
      </div>
    )
  }
```

Note: `FieldInput` calls itself recursively for sub-fields. This is intentional — sub-fields can be any supported type, including nested repeaters.

**Step 7: Build + publish + commit**

```bash
cd packages/panels && pnpm build
cd ../../playground && pnpm artisan vendor:publish --tag=panels-pages --force
git add packages/panels/src/fields/RepeaterField.ts packages/panels/src/index.ts packages/panels/src/index.test.ts packages/panels/pages/_components/FieldInput.tsx
git commit -m "feat(panels): add RepeaterField with nested schema and recursive rendering"
```

---

## Task 15: BuilderField + Block

Unlike `RepeaterField` (all items same schema), `BuilderField` lets developers define multiple **block types** — each with its own schema. The user picks a block type when adding an item. Stored as a JSON array where each item has a `_type` key identifying its block.

```ts
BuilderField.make('content').blocks([
  Block.make('hero').label('Hero Section').icon('🦸').schema([
    TextField.make('heading').required(),
    TextareaField.make('subheading'),
    TextField.make('ctaText').label('CTA Button Text'),
  ]),
  Block.make('richText').label('Text Block').icon('📝').schema([
    TextareaField.make('content').required(),
  ]),
  Block.make('image').label('Image').icon('🖼️').schema([
    TextField.make('url').required(),
    TextField.make('alt').label('Alt text'),
  ]),
])
// Stored as: [{ _type: 'hero', heading: '...', subheading: '...' }, { _type: 'image', url: '...' }]
```

**Files:**
- Create: `packages/panels/src/Block.ts`
- Create: `packages/panels/src/fields/BuilderField.ts`
- Modify: `packages/panels/src/index.ts`
- Modify: `packages/panels/src/index.test.ts`
- Modify: `packages/panels/pages/_components/FieldInput.tsx`

---

**Step 1: Add tests**

In `packages/panels/src/index.test.ts`, add after the RepeaterField describe block:

```ts
describe('Block', () => {
  it('make() sets name', () => {
    assert.equal(Block.make('hero').toMeta().name, 'hero')
  })

  it('label() sets label, defaults to name', () => {
    assert.equal(Block.make('hero').toMeta().label, 'hero')
    assert.equal(Block.make('hero').label('Hero Section').toMeta().label, 'Hero Section')
  })

  it('icon() sets icon', () => {
    assert.equal(Block.make('hero').icon('🦸').toMeta().icon, '🦸')
  })

  it('icon defaults to undefined', () => {
    assert.equal(Block.make('hero').toMeta().icon, undefined)
  })

  it('schema() stores field metas', () => {
    const b = Block.make('hero').schema([TextField.make('heading')])
    assert.equal(b.toMeta().schema.length, 1)
    assert.equal(b.toMeta().schema[0]?.name, 'heading')
  })
})

describe('BuilderField', () => {
  it('type is builder', () => {
    assert.equal(BuilderField.make('content').toMeta().type, 'builder')
  })

  it('blocks() stores block metas in extra', () => {
    const f = BuilderField.make('content').blocks([
      Block.make('hero').schema([TextField.make('heading')]),
      Block.make('text').schema([TextareaField.make('body')]),
    ])
    const blocks = f.toMeta().extra['blocks'] as Array<{ name: string }>
    assert.equal(blocks.length, 2)
    assert.equal(blocks[0]?.name, 'hero')
    assert.equal(blocks[1]?.name, 'text')
  })

  it('addLabel defaults to "Add block"', () => {
    assert.equal(BuilderField.make('content').toMeta().extra['addLabel'], 'Add block')
  })

  it('addLabel() sets label', () => {
    assert.equal(
      BuilderField.make('content').addLabel('Add section').toMeta().extra['addLabel'],
      'Add section',
    )
  })

  it('maxItems() sets max', () => {
    assert.equal(BuilderField.make('content').maxItems(10).toMeta().extra['maxItems'], 10)
  })
})
```

**Step 2: Run to confirm they fail**

```bash
cd packages/panels && pnpm test 2>&1 | grep -E 'Block|BuilderField|FAIL' | head -10
```

**Step 3: Create `packages/panels/src/Block.ts`**

```ts
import type { Field } from './Field.js'
import type { FieldMeta } from './Field.js'

// ─── Block meta ────────────────────────────────────────────

export interface BlockMeta {
  name:   string
  label:  string
  icon:   string | undefined
  schema: FieldMeta[]
}

// ─── Block builder ─────────────────────────────────────────

export class Block {
  private _name:   string
  private _label?: string
  private _icon?:  string
  private _schema: Field[] = []

  protected constructor(name: string) {
    this._name = name
  }

  static make(name: string): Block {
    return new Block(name)
  }

  /** Display label shown in the block picker. Defaults to the block name. */
  label(label: string): this {
    this._label = label
    return this
  }

  /** Emoji or icon string shown in the block picker. */
  icon(icon: string): this {
    this._icon = icon
    return this
  }

  /** Fields that appear when this block type is added. */
  schema(fields: Field[]): this {
    this._schema = fields
    return this
  }

  /** @internal */
  toMeta(): BlockMeta {
    return {
      name:   this._name,
      label:  this._label ?? this._name,
      icon:   this._icon,
      schema: this._schema.map((f) => f.toMeta()),
    }
  }
}
```

**Step 4: Create `packages/panels/src/fields/BuilderField.ts`**

```ts
import { Field } from '../Field.js'
import type { Block } from '../Block.js'

export class BuilderField extends Field {
  constructor(name: string) {
    super(name)
    this._extra['blocks']   = []
    this._extra['addLabel'] = 'Add block'
  }

  static make(name: string): BuilderField {
    return new BuilderField(name)
  }

  /**
   * Define the available block types for this builder field.
   * @example
   * BuilderField.make('content').blocks([
   *   Block.make('hero').label('Hero').schema([...]),
   *   Block.make('text').label('Text').schema([...]),
   * ])
   */
  blocks(blocks: Block[]): this {
    this._extra['blocks'] = blocks.map((b) => b.toMeta())
    return this
  }

  /** Label for the "add block" button. Defaults to "Add block". */
  addLabel(label: string): this {
    this._extra['addLabel'] = label
    return this
  }

  /** Maximum total blocks allowed across all types. */
  maxItems(n: number): this {
    this._extra['maxItems'] = n
    return this
  }

  getType(): string { return 'builder' }
}
```

**Step 5: Export from `packages/panels/src/index.ts`**

```ts
export { Block } from './Block.js'
export type { BlockMeta } from './Block.js'
export { BuilderField } from './fields/BuilderField.js'
```

**Step 6: Run tests**

```bash
cd packages/panels && pnpm test 2>&1 | tail -10
```

Expected: all tests pass.

**Step 7: Build**

```bash
cd packages/panels && pnpm build 2>&1
```

**Step 8: Add rendering in `FieldInput.tsx`**

The builder renders:
1. A list of added blocks — each shows a type badge and its specific fields
2. An "Add block" button that opens an inline block-type picker

Add the `useState` import if not already present. Then add the builder case before the custom renderer fallback:

```tsx
  // ── Builder ──────────────────────────────────────────────
  if (field.type === 'builder') {
    const blockDefs = (field.extra?.blocks ?? []) as Array<{
      name: string; label: string; icon?: string; schema: FieldMeta[]
    }>
    const addLabel  = (field.extra?.addLabel as string) ?? 'Add block'
    const maxItems  = field.extra?.maxItems as number | undefined
    const items     = Array.isArray(value)
      ? (value as Array<{ _type: string } & Record<string, unknown>>)
      : []
    const [pickerOpen, setPickerOpen] = useState(false)

    function addBlock(blockName: string) {
      const def   = blockDefs.find((b) => b.name === blockName)
      if (!def) return
      const empty: Record<string, unknown> = { _type: blockName }
      for (const f of def.schema) empty[f.name] = undefined
      onChange([...items, empty])
      setPickerOpen(false)
    }

    function updateBlock(index: number, fieldName: string, fieldValue: unknown) {
      const next = items.map((item, i) =>
        i === index ? { ...item, [fieldName]: fieldValue } : item,
      )
      onChange(next)
    }

    function removeBlock(index: number) {
      onChange(items.filter((_, i) => i !== index))
    }

    function moveBlock(index: number, direction: -1 | 1) {
      const next  = [...items]
      const other = index + direction
      if (other < 0 || other >= next.length) return
      ;[next[index], next[other]] = [next[other]!, next[index]!]
      onChange(next)
    }

    const atMax = maxItems !== undefined && items.length >= maxItems

    return (
      <div className="flex flex-col gap-3">
        {items.map((item, index) => {
          const def = blockDefs.find((b) => b.name === item._type)
          return (
            <div key={index} className="rounded-lg border border-input bg-card overflow-hidden">
              {/* Block header */}
              <div className="flex items-center justify-between px-4 py-2 bg-muted/50 border-b border-input">
                <span className="flex items-center gap-2 text-xs font-medium">
                  {def?.icon && <span>{def.icon}</span>}
                  <span className="text-muted-foreground uppercase tracking-wide">
                    {def?.label ?? item._type}
                  </span>
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => moveBlock(index, -1)}
                    disabled={index === 0}
                    className="px-1.5 py-0.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-30"
                    title="Move up"
                  >↑</button>
                  <button
                    type="button"
                    onClick={() => moveBlock(index, 1)}
                    disabled={index === items.length - 1}
                    className="px-1.5 py-0.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-30"
                    title="Move down"
                  >↓</button>
                  <button
                    type="button"
                    onClick={() => removeBlock(index)}
                    className="px-1.5 py-0.5 text-xs text-destructive hover:underline ml-1"
                  >Remove</button>
                </div>
              </div>

              {/* Block fields */}
              <div className="p-4 flex flex-col gap-4">
                {(def?.schema ?? []).map((subField) => (
                  <div key={subField.name} className="flex flex-col gap-1.5">
                    <label className="text-sm font-medium">
                      {subField.label}
                      {subField.required && <span className="text-destructive ml-0.5">*</span>}
                    </label>
                    <FieldInput
                      field={subField}
                      value={item[subField.name]}
                      onChange={(v) => updateBlock(index, subField.name, v)}
                    />
                  </div>
                ))}
              </div>
            </div>
          )
        })}

        {/* Block picker */}
        {!atMax && (
          <div className="relative">
            <button
              type="button"
              onClick={() => setPickerOpen((o) => !o)}
              className="flex items-center gap-2 px-4 py-2 rounded-md border border-dashed border-input text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors w-full justify-center"
            >
              <span className="text-base leading-none">+</span>
              {addLabel}
            </button>

            {pickerOpen && (
              <div className="absolute bottom-full mb-2 left-0 z-20 w-full rounded-lg border border-border bg-popover shadow-lg py-1 overflow-hidden">
                {blockDefs.map((def) => (
                  <button
                    key={def.name}
                    type="button"
                    onClick={() => addBlock(def.name)}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-accent hover:text-accent-foreground transition-colors text-left"
                  >
                    {def.icon && <span className="text-base shrink-0">{def.icon}</span>}
                    <div>
                      <p className="font-medium">{def.label}</p>
                      <p className="text-xs text-muted-foreground">{def.schema.length} field{def.schema.length !== 1 ? 's' : ''}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    )
  }
```

**Step 9: Publish + commit**

```bash
cd packages/panels && pnpm build
cd ../../playground && pnpm artisan vendor:publish --tag=panels-pages --force
git add packages/panels/src/Block.ts packages/panels/src/fields/BuilderField.ts packages/panels/src/index.ts packages/panels/src/index.test.ts packages/panels/pages/_components/FieldInput.tsx
git commit -m "feat(panels): add BuilderField with multi-type block picker and reordering"
```

---

## Task 16: Update exports count + bump version + update docs

**Files:**
- Modify: `packages/panels/package.json` (version 0.0.2 → 0.0.3)
- Modify: `packages/panels/README.md`
- Modify: `docs/packages/panels.md`

---

**Step 1: Bump version**

In `packages/panels/package.json`, change `"version": "0.0.2"` to `"version": "0.0.3"`.

**Step 2: Add new fields to README and docs**

In both `packages/panels/README.md` and `docs/packages/panels.md`, update the field types table to include all new fields:

| Class | Description |
|---|---|
| `PasswordField` | Masked password input with optional confirmation |
| `SlugField` | URL slug, auto-generated from a source field |
| `TagsField` | Multi-value chip input (array of strings) |
| `HiddenField` | Hidden form value, never shown in UI |
| `ToggleField` | Boolean switch/toggle — uses `@base-ui-components/react/switch` |
| `ColorField` | Native color picker with hex swatch in table |
| `JsonField` | JSON editor textarea with inline validation |
| `RepeaterField` | Repeatable group of sub-fields (same schema), stored as JSON array |
| `BuilderField` | Multiple block types each with own schema — page builder experience |
| `Block` | Block type definition used with `BuilderField` |

Also add documentation for new Resource features:

```ts
class PostResource extends Resource {
  static defaultSort    = 'createdAt'
  static defaultSortDir = 'DESC' as const
  // ...
}
```

And row actions:
```ts
Action.make('impersonate')
  .label('Login as user')
  .row()               // appears per-row, not in bulk bar
  .handler(async (records) => { ... })
```

**Step 3: Run final test suite**

```bash
cd packages/panels && pnpm test 2>&1 | tail -5
```

Expected: all tests pass (115+ tests).

**Step 4: Final build**

```bash
cd packages/panels && pnpm build
```

**Step 5: Commit**

```bash
git add packages/panels/package.json packages/panels/README.md docs/packages/panels.md
git commit -m "chore(panels): bump to 0.0.3, update docs with new fields and features"
```

---

## Final checklist

- [ ] Toasts appear on create/edit/delete/action
- [ ] Empty state shows when no records
- [ ] No-results state shows when search returns nothing
- [ ] Breadcrumbs visible on create and edit pages
- [ ] Show page at `/{panel}/{resource}/{id}` renders field values
- [ ] Default sort applies when no `?sort` param
- [ ] Per-page selector in pagination area works
- [ ] Row actions appear per-row in table
- [ ] `PasswordField` — masked input, optional confirm
- [ ] `SlugField` — auto-generates from source field
- [ ] `TagsField` — chip input, Enter/comma to add, backspace to remove
- [ ] `HiddenField` — hidden input with default value
- [ ] `ToggleField` — switch with on/off labels
- [ ] `ColorField` — color picker + hex in table
- [ ] `JsonField` — textarea with JSON validation
- [ ] `RepeaterField` — add/remove items, each with nested fields rendered recursively
- [ ] `BuilderField` — block-type picker, each block type has its own fields, up/down reorder
- [ ] All tests pass
- [ ] `pnpm build` clean in `packages/panels`
- [ ] Pages republished to playground after all UI changes
