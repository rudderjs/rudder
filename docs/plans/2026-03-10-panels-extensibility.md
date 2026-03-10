# Panels Extensibility Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let developers override any resource view (index, create, edit, show) with a custom Vike page, and define custom field types with custom React renderers.

**Architecture:**
- **Custom views**: Zero new routing API — Vike static segments beat dynamic ones automatically. We expose a `resourceData()` helper so developers can reuse the panels data-fetching logic from their custom `+data.ts`. The playground's own `+data.ts` becomes a thin wrapper around it.
- **Custom fields**: Add `Field.component(key)` that stores a string key on `FieldMeta`. Publish a `CustomFieldRenderers.tsx` stub alongside `FieldInput.tsx`; `FieldInput` imports that stub and falls back to it for unknown types. Developers fill the stub with their custom components.

**Tech Stack:** TypeScript (NodeNext/ESM), `node:test`, React (published pages), Vike SSR

---

## Task 1: Extract `resourceData()` helper into `@boostkit/panels`

The data-fetching logic in the playground's `+data.ts` is duplicated every time a developer writes a custom resource view. Extract it into the panels package so it can be imported.

**Files:**
- Create: `packages/panels/src/resourceData.ts`
- Modify: `packages/panels/src/index.ts`
- Modify: `packages/panels/src/index.test.ts`
- Modify: `playground/pages/(panels)/@panel/@resource/+data.ts`

---

**Step 1: Add tests for `resourceData` to `packages/panels/src/index.test.ts`**

Open `packages/panels/src/index.test.ts` and add at the very end (after all existing `describe` blocks):

```ts
// ─── resourceData ────────────────────────────────────────────

describe('resourceData', () => {
  // We test the exported function exists and has the right shape.
  // Full integration tests require a live ORM — covered manually.

  it('is exported from index', async () => {
    const mod = await import('./index.js')
    assert.equal(typeof mod.resourceData, 'function')
  })

  it('throws when panel not found', async () => {
    const { resourceData, PanelRegistry } = await import('./index.js')
    PanelRegistry.reset()
    await assert.rejects(
      () => resourceData({ panel: 'ghost', resource: 'x', url: '/ghost/x' }),
      /Panel "\/ghost" not found/,
    )
  })

  it('throws when resource not found', async () => {
    const { resourceData, PanelRegistry, Panel } = await import('./index.js')
    PanelRegistry.reset()
    PanelRegistry.register(Panel.make('demo').path('/demo'))
    await assert.rejects(
      () => resourceData({ panel: 'demo', resource: 'missing', url: '/demo/missing' }),
      /Resource "missing" not found/,
    )
  })

  it('returns panelMeta + resourceMeta when model is undefined', async () => {
    const { resourceData, PanelRegistry, Panel, Resource, TextField } = await import('./index.js')
    PanelRegistry.reset()
    class PostResource extends Resource {
      fields() { return [TextField.make('title')] }
    }
    PanelRegistry.register(Panel.make('blog').path('/blog').resources([PostResource]))
    const result = await resourceData({ panel: 'blog', resource: 'posts', url: '/blog/posts' })
    assert.equal(result.panelMeta.name, 'blog')
    assert.equal(result.resourceMeta.slug, 'posts')
    assert.deepEqual(result.records, [])
    assert.equal(result.pagination, null)
  })
})
```

**Step 2: Run the test to see it fail**

```bash
cd packages/panels
pnpm test 2>&1 | tail -20
```

Expected: fails with `mod.resourceData is not a function` or similar.

---

**Step 3: Create `packages/panels/src/resourceData.ts`**

```ts
import { PanelRegistry } from './PanelRegistry.js'

export interface ResourceDataContext {
  /** Panel path segment (e.g. 'admin' for a panel at /admin). */
  panel:    string
  /** Resource slug (e.g. 'users'). */
  resource: string
  /** Full request URL including query string, e.g. '/admin/users?sort=name&dir=ASC'. */
  url:      string
}

export interface ResourceDataResult {
  panelMeta:    ReturnType<ReturnType<typeof PanelRegistry.all>[number]['toMeta']>
  resourceMeta: Record<string, unknown>
  records:      unknown[]
  pagination:   { total: number; currentPage: number; lastPage: number; perPage: number } | null
  pathSegment:  string
  slug:         string
}

export async function resourceData(ctx: ResourceDataContext): Promise<ResourceDataResult> {
  const { panel: pathSegment, resource: slug, url } = ctx

  const panel = PanelRegistry.all().find((p) => p.getPath() === `/${pathSegment}`)
  if (!panel) throw new Error(`Panel "/${pathSegment}" not found.`)

  const ResourceClass = panel.getResources().find((R) => R.getSlug() === slug)
  if (!ResourceClass) throw new Error(`Resource "${slug}" not found.`)

  const resource     = new ResourceClass()
  const resourceMeta = resource.toMeta()
  const panelMeta    = panel.toMeta()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Model  = ResourceClass.model as any
  const params = new URLSearchParams(url.split('?')[1] ?? '')
  const page   = Number(params.get('page') ?? 1)
  const sort   = params.get('sort') ?? undefined
  const dir    = (params.get('dir') ?? 'ASC').toUpperCase() as 'ASC' | 'DESC'
  const search = params.get('search') ?? undefined

  let records: unknown[]  = []
  let pagination: { total: number; currentPage: number; lastPage: number; perPage: number } | null = null

  if (Model) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q: any = Model.query()

    if (sort) {
      const sortableFields = resource.fields().filter((f: any) => f.isSortable()).map((f: any) => f.getName())
      if (sortableFields.includes(sort)) q = q.orderBy(sort, dir)
    }

    if (search) {
      const cols = resource.fields().filter((f: any) => f.isSearchable()).map((f: any) => f.getName())
      if (cols.length > 0) {
        q = q.where(cols[0]!, 'LIKE', `%${search}%`)
        for (let i = 1; i < cols.length; i++) q = q.orWhere(cols[i]!, `%${search}%`)
      }
    }

    for (const filter of resource.filters()) {
      const value = params.get(`filter[${filter.getName()}]`)
      if (value !== null && value !== '') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const applied = (filter as any).apply({}, value) as Record<string, unknown>
        for (const [col, val] of Object.entries(applied)) {
          if (col === '_search') {
            const { value: sv, columns } = val as { value: string; columns: string[] }
            if (columns[0]) q = q.where(columns[0], 'LIKE', `%${sv}%`)
            for (let i = 1; i < columns.length; i++) q = q.orWhere(columns[i]!, `%${sv}%`)
          } else {
            q = q.where(col, val)
          }
        }
      }
    }

    const result = await q.paginate(page, 15)
    records    = result.data
    pagination = {
      total:       result.total,
      currentPage: result.currentPage,
      lastPage:    result.lastPage,
      perPage:     result.perPage,
    }
  }

  return { panelMeta, resourceMeta, records, pagination, pathSegment, slug } as ResourceDataResult
}
```

**Step 4: Export from `packages/panels/src/index.ts`**

Add at the end of the file (before the closing):

```ts
// ─── Data helpers ───────────────────────────────────────────

export { resourceData } from './resourceData.js'
export type { ResourceDataContext, ResourceDataResult } from './resourceData.js'
```

**Step 5: Run the tests to confirm they pass**

```bash
cd packages/panels
pnpm test 2>&1 | tail -20
```

Expected: all 99 tests pass (95 existing + 4 new).

**Step 6: Build the package**

```bash
cd packages/panels
pnpm build
```

Expected: no errors.

**Step 7: Slim down the playground's `+data.ts` to use `resourceData`**

Replace the entire content of `playground/pages/(panels)/@panel/@resource/+data.ts`:

```ts
import { resourceData } from '@boostkit/panels'
import type { PageContextServer } from 'vike/types'

export type Data = Awaited<ReturnType<typeof resourceData>>

export async function data(pageContext: PageContextServer) {
  const { panel, resource } = pageContext.routeParams as { panel: string; resource: string }
  return resourceData({ panel, resource, url: pageContext.urlOriginal })
}
```

**Step 8: Verify playground still works**

Start the playground and confirm `/admin/users` and `/admin/todos` load correctly.

```bash
cd playground
pnpm dev
```

Open `http://localhost:3000/admin/users` — table should render with data, sort/search/filter working.

**Step 9: Commit**

```bash
git add packages/panels/src/resourceData.ts packages/panels/src/index.ts packages/panels/src/index.test.ts playground/pages/\(panels\)/@panel/@resource/+data.ts
git commit -m "feat(panels): extract resourceData() helper for custom resource views"
```

---

## Task 2: Custom field types — `Field.component()` + `CustomFieldRenderers`

Developers need to define field types beyond the built-ins (text, email, select, etc.) and provide a custom React component to render them in create/edit forms.

**Design:**
- `Field.component(key: string)` stores a key string on `FieldMeta`
- A new published file `_components/CustomFieldRenderers.tsx` is an empty map: `Record<string, React.ComponentType<FieldInputProps>>`
- `FieldInput.tsx` imports that map and falls back to it for unknown field types
- Developer fills the stub with their renderers, never touches `FieldInput.tsx`

**Files:**
- Modify: `packages/panels/src/Field.ts`
- Modify: `packages/panels/src/index.ts` (export `FieldInputProps`)
- Modify: `packages/panels/src/index.test.ts`
- Create: `packages/panels/pages/_components/CustomFieldRenderers.tsx`
- Modify: `packages/panels/pages/_components/FieldInput.tsx`
- Modify: `packages/panels/src/PanelServiceProvider.ts` (add `CustomFieldRenderers.tsx` to publish list)

---

**Step 1: Add tests for `Field.component()` to `packages/panels/src/index.test.ts`**

Inside the existing `describe('Field', ...)` block, add these cases after the existing field tests:

```ts
  it('component() stores a key on meta', () => {
    const f = TextField.make('color').component('color-picker')
    assert.equal(f.toMeta().component, 'color-picker')
  })

  it('component is undefined by default', () => {
    const f = TextField.make('x')
    assert.equal(f.toMeta().component, undefined)
  })
```

**Step 2: Run tests to see them fail**

```bash
cd packages/panels
pnpm test 2>&1 | grep -E 'component|FAIL|Error' | head -10
```

Expected: fails — `component()` method does not exist yet.

**Step 3: Add `component` to `FieldMeta` and `Field` in `packages/panels/src/Field.ts`**

In `FieldMeta`, add one optional field:

```ts
export interface FieldMeta {
  name:       string
  type:       string
  label:      string
  required:   boolean
  readonly:   boolean
  sortable:   boolean
  searchable: boolean
  hidden:     FieldVisibility[]
  extra:      Record<string, unknown>
  component?: string   // ← add this
}
```

In the `Field` class body, add a protected property and method (after `_extra`):

```ts
  protected _component?: string

  /**
   * Key for a custom React renderer registered in CustomFieldRenderers.tsx.
   * Use this when the built-in field types don't cover your UI.
   *
   * @example
   * ColorField.make('brand').component('color-picker')
   */
  component(key: string): this {
    this._component = key
    return this
  }
```

In `toMeta()`, add `component` to the returned object:

```ts
  toMeta(): FieldMeta {
    return {
      name:       this._name,
      type:       this.getType(),
      label:      this.getLabel(),
      required:   this._required,
      readonly:   this._readonly,
      sortable:   this._sortable,
      searchable: this._searchable,
      hidden:     [...this._hidden],
      extra:      this._extra,
      component:  this._component,
    }
  }
```

**Step 4: Run tests to confirm they pass**

```bash
cd packages/panels
pnpm test 2>&1 | tail -10
```

Expected: all 101 tests pass.

**Step 5: Create `packages/panels/pages/_components/CustomFieldRenderers.tsx`**

```tsx
import type { FieldMeta } from '@boostkit/panels'

/**
 * Custom field renderer props — same interface as built-in FieldInput.
 * Your component receives the field metadata, current value, and an onChange callback.
 */
export interface FieldInputProps {
  field:    FieldMeta
  value:    unknown
  onChange: (value: unknown) => void
}

/**
 * Register custom field renderers here.
 *
 * Key = the string passed to Field.component('your-key') in your Resource.
 * Value = a React component that renders the form input for that field.
 *
 * @example
 * import { ColorPicker } from '../../components/ColorPicker.js'
 *
 * export const customFieldRenderers: Record<string, React.ComponentType<FieldInputProps>> = {
 *   'color-picker': ColorPicker,
 * }
 */
export const customFieldRenderers: Record<string, React.ComponentType<FieldInputProps>> = {}
```

**Step 6: Update `packages/panels/pages/_components/FieldInput.tsx` to fall back to custom renderers**

At the top of the file, add the import after existing imports:

```tsx
import { customFieldRenderers } from './CustomFieldRenderers.js'
```

Before the final `<input>` fallback (at the very bottom of `FieldInput`, just before the `const typeMap` block), add:

```tsx
  // ── Custom renderer ──────────────────────────────────────
  const customKey = field.component ?? field.type
  const CustomRenderer = customFieldRenderers[customKey]
  if (CustomRenderer) {
    return <CustomRenderer field={field} value={value} onChange={onChange} />
  }
```

This checks `field.component` first (the explicit key), then falls back to `field.type` (so a fully custom field class can be handled without calling `.component()` if the type string itself is registered).

**Step 7: Export `FieldInputProps` from `packages/panels/src/index.ts`**

The `FieldInputProps` type lives in a published page file (client-side), so we cannot re-export it from the server package. Leave it in `CustomFieldRenderers.tsx` only — developers import it from the published file:

```ts
import type { FieldInputProps } from '../_components/CustomFieldRenderers.js'
```

No change needed to `index.ts`.

**Step 8: Add `CustomFieldRenderers.tsx` to the publish group in `packages/panels/src/PanelServiceProvider.ts`**

Find the `publishes()` array item for `panels-pages`. It currently lists `pages/` as the source directory. The new file is inside that directory already, so no change to the publish config is needed — it will be included automatically on the next `vendor:publish`.

Verify by searching for the publish config:

```bash
grep -n 'panels-pages' packages/panels/src/PanelServiceProvider.ts
```

If the source is `pages/` (the whole directory), the new file is already covered.

**Step 9: Build the package**

```bash
cd packages/panels
pnpm build
```

Expected: no errors.

**Step 10: Republish pages to playground**

```bash
cd playground
pnpm artisan vendor:publish --tag=panels-pages --force
```

Expected: `Published to pages/(panels)` — `CustomFieldRenderers.tsx` now exists in `playground/pages/(panels)/_components/`.

**Step 11: Verify in playground**

Confirm the file was published:

```bash
ls playground/pages/\(panels\)/_components/
```

Expected: `AdminLayout.tsx  ConfirmDialog.tsx  CustomFieldRenderers.tsx  FieldInput.tsx`

**Step 12: Commit**

```bash
git add packages/panels/src/Field.ts packages/panels/src/index.test.ts packages/panels/pages/_components/CustomFieldRenderers.tsx packages/panels/pages/_components/FieldInput.tsx playground/pages/\(panels\)/_components/
git commit -m "feat(panels): add Field.component() and CustomFieldRenderers for custom field types"
```

---

## Task 3: Demo custom field in playground

Prove the system works end-to-end with a real custom field in the playground.

**Files:**
- Create: `playground/pages/(panels)/_components/fields/RatingInput.tsx`
- Modify: `playground/pages/(panels)/_components/CustomFieldRenderers.tsx`
- Modify: `playground/app/Panels/Admin/resources/TodoResource.ts`

---

**Step 1: Create `playground/pages/(panels)/_components/fields/RatingInput.tsx`**

```tsx
import type { FieldInputProps } from '../CustomFieldRenderers.js'

export function RatingInput({ value, onChange }: FieldInputProps) {
  const rating = Number(value) || 0
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          onClick={() => onChange(star)}
          className={[
            'text-2xl leading-none transition-colors',
            star <= rating ? 'text-yellow-400' : 'text-muted-foreground/30',
          ].join(' ')}
        >
          ★
        </button>
      ))}
    </div>
  )
}
```

**Step 2: Register it in `playground/pages/(panels)/_components/CustomFieldRenderers.tsx`**

```tsx
import type { FieldMeta } from '@boostkit/panels'
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

**Step 3: Add a rating field to `TodoResource`**

Open `playground/app/Panels/Admin/resources/TodoResource.ts`.

Add `NumberField` import if not already there, then add a field using `.component('rating')`:

```ts
NumberField.make('priority').label('Priority').component('rating'),
```

(Add it to the `fields()` array.)

**Step 4: Open the playground and test**

```bash
cd playground && pnpm dev
```

Navigate to `http://localhost:3000/admin/todos/create`. The "Priority" field should render five star buttons instead of a number input.

**Step 5: Commit**

```bash
git add playground/pages/\(panels\)/_components/fields/RatingInput.tsx playground/pages/\(panels\)/_components/CustomFieldRenderers.tsx playground/app/Panels/Admin/resources/TodoResource.ts
git commit -m "demo(playground): custom rating field using Field.component()"
```

---

## Task 4: Update README and docs

**Files:**
- Modify: `packages/panels/README.md`
- Modify: `docs/packages/panels.md`

**Step 1: Add "Custom Resource Views" section to both files**

Content to add (after the "Custom Pages" section):

````md
## Custom Resource Views

To replace the default table for a specific resource, create a Vike page at the resource's static path. Vike's route priority makes static segments win over dynamic ones — your page is served instead of the built-in table.

```
pages/(panels)/@panel/users/+Page.tsx    ← custom index for 'users'
pages/(panels)/@panel/users/+data.ts
```

Use `resourceData()` to fetch panels data without duplicating the built-in query logic:

```ts
// pages/(panels)/@panel/users/+data.ts
import { resourceData } from '@boostkit/panels'
import type { PageContextServer } from 'vike/types'

export type Data = Awaited<ReturnType<typeof resourceData>>

export async function data(pageContext: PageContextServer) {
  const { panel } = pageContext.routeParams as { panel: string }
  return resourceData({ panel, resource: 'users', url: pageContext.urlOriginal })
}
```

```tsx
// pages/(panels)/@panel/users/+Page.tsx
import { useData }    from 'vike-react/useData'
import { AdminLayout } from '../../_components/AdminLayout.js'
import type { Data }  from './+data.js'

export default function UsersGridPage() {
  const { panelMeta, resourceMeta, records } = useData<Data>()
  return (
    <AdminLayout panelMeta={panelMeta} currentSlug={resourceMeta.slug as string}>
      <div className="grid grid-cols-3 gap-4">
        {(records as any[]).map((r) => (
          <div key={r.id} className="rounded-lg border p-4">{r.name}</div>
        ))}
      </div>
    </AdminLayout>
  )
}
```

`resourceData()` applies all the same sort / search / filter / pagination logic as the default table — you get that for free.
````

**Step 2: Add "Custom Field Types" section to both files**

````md
## Custom Field Types

Use `.component(key)` on any field to hand off rendering to a custom React component.

```ts
// In your Resource
NumberField.make('priority').label('Priority').component('rating')
```

Register the component in `pages/(panels)/_components/CustomFieldRenderers.tsx` (published file — edit it directly):

```tsx
import type { FieldMeta } from '@boostkit/panels'
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

Your `RatingInput` component receives `{ field, value, onChange }` — the same props as built-in field renderers.

> **Note:** `CustomFieldRenderers.tsx` is a published file. It is yours to edit. Re-publishing with `--force` will overwrite it — back it up or diff before upgrading.
````

**Step 3: Commit**

```bash
git add packages/panels/README.md docs/packages/panels.md
git commit -m "docs(panels): document custom views and custom field types"
```

---

## Final checklist

- [ ] `pnpm test` in `packages/panels` — all 101 tests pass
- [ ] `pnpm build` in `packages/panels` — no errors
- [ ] Playground `/admin/todos/create` shows star rating for "Priority"
- [ ] `resourceData` is importable from `@boostkit/panels`
- [ ] `CustomFieldRenderers.tsx` is present in playground after `vendor:publish`
