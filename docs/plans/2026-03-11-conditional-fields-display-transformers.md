# Conditional Fields + Display Transformers Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rich field-level control inspired by FilamentPHP and PayloadCMS — conditional visibility, per-field access control, per-field validation, display transformers, and computed virtual fields.

**Architecture:**

```
Data-driven (serialized to JSON meta → frontend):
  .showWhen()   .hideWhen()   .disabledWhen()

Function-based (server-side only, never cross the wire):
  .readableBy()   .editableBy()   .validate()   .display()   ComputedField.compute()
```

- Conditions use serializable operators (`=`, `!=`, `>`, `>=`, `<`, `<=`, `truthy`, `falsy`) — covers 95% of real-world cases without needing closures
- `.disabledWhen()` shows the field but makes it readonly based on another field's value
- `.readableBy(ctx)` / `.editableBy(ctx)` — field-level auth guards evaluated server-side; PanelServiceProvider strips or marks-readonly fields the current user can't access
- `.validate(fn)` — async per-field validator evaluated alongside existing Zod validation
- `.display(fn)` — server-side value formatter applied in list/show responses
- `ComputedField` — virtual column with no DB backing, value computed per-record on the server

**Comparison:**

| | FilamentPHP | PayloadCMS | This plan |
|---|---|---|---|
| Conditions | Closure (server, Livewire) | Function (client bundle) | Operators (serialized JSON) |
| Field access | `.visible(fn)` with auth | `access: { read, update }` | `.readableBy(fn)` `.editableBy(fn)` |
| Per-field validate | Zod on resource | `validate: async (val, {data})` | `.validate(async (val, data) => string\|true)` |
| Display transform | `->formatStateUsing(fn)` | `admin.components.Cell` | `.display(fn)` server-side |
| Virtual fields | `->state(fn)` | `hooks.afterRead` | `ComputedField.compute(fn)` |
| Conditional disable | `->disabled(fn)` | `access.update` | `.disabledWhen(field, op, value)` |

**Tech Stack:** TypeScript, `@boostkit/panels`, React (Vike), `node:test`

---

### Task 1: Expanded `Condition` type + `.showWhen()` / `.hideWhen()` / `.disabledWhen()`

**Files:**
- Modify: `packages/panels/src/Field.ts`

**Step 1: Write failing tests first**

In `packages/panels/src/index.test.ts`, add:

```ts
// ── Conditional fields ──────────────────────────────────────

test('showWhen equality condition', () => {
  const f = TextField.make('x').showWhen('status', 'published')
  assert.deepEqual(f.toMeta().conditions, [
    { type: 'show', field: 'status', op: '=', value: 'published' },
  ])
})

test('showWhen with explicit operator', () => {
  const f = TextField.make('x').showWhen('views', '>', 100)
  assert.deepEqual(f.toMeta().conditions, [
    { type: 'show', field: 'views', op: '>', value: 100 },
  ])
})

test('showWhen with array uses "in"', () => {
  const f = TextField.make('x').showWhen('status', ['draft', 'review'])
  assert.deepEqual(f.toMeta().conditions, [
    { type: 'show', field: 'status', op: 'in', value: ['draft', 'review'] },
  ])
})

test('hideWhen stores hide condition', () => {
  const f = TextField.make('x').hideWhen('featured', true)
  assert.deepEqual(f.toMeta().conditions, [
    { type: 'hide', field: 'featured', op: '=', value: true },
  ])
})

test('disabledWhen stores disabled condition', () => {
  const f = TextField.make('x').disabledWhen('verified', true)
  assert.deepEqual(f.toMeta().conditions, [
    { type: 'disabled', field: 'verified', op: '=', value: true },
  ])
})

test('truthy/falsy operators', () => {
  const f = TextField.make('x').showWhen('name', 'truthy')
  assert.deepEqual(f.toMeta().conditions, [
    { type: 'show', field: 'name', op: 'truthy', value: null },
  ])
})

test('no conditions → conditions absent from meta', () => {
  assert.equal(TextField.make('x').toMeta().conditions, undefined)
})

test('multiple conditions stack', () => {
  const f = TextField.make('x').showWhen('a', '1').hideWhen('b', '2')
  assert.equal(f.toMeta().conditions?.length, 2)
})
```

Run: `cd packages/panels && pnpm test` — expect 8 failures.

**Step 2: Add `Condition` type and update `FieldMeta`**

In `packages/panels/src/Field.ts`, replace the existing `FieldVisibility` block at the top:

```ts
export type FieldVisibility = 'table' | 'create' | 'edit' | 'view'

export type ConditionOp =
  | '=' | '!=' | '>' | '>=' | '<' | '<='
  | 'in' | 'not_in'
  | 'truthy' | 'falsy'

export interface Condition {
  type:  'show' | 'hide' | 'disabled'
  field: string
  op:    ConditionOp
  value: unknown   // null for truthy/falsy
}

export interface FieldMeta {
  name:               string
  type:               string
  label:              string
  required:           boolean
  readonly:           boolean
  sortable:           boolean
  searchable:         boolean
  hidden:             FieldVisibility[]
  extra:              Record<string, unknown>
  component?:         string
  conditions?:        Condition[]
  displayTransformed?: boolean
}
```

**Step 3: Add `_conditions` + three fluent methods to `Field`**

In the `Field` class, add `protected _conditions: Condition[] = []` after `protected _component?`.

Add these three methods after the `component()` method:

```ts
/**
 * Show this field only when a condition on another field is met.
 *
 * @example
 * .showWhen('status', 'published')           // equality
 * .showWhen('views', '>', 100)               // comparison
 * .showWhen('status', ['draft', 'review'])   // one of (array → 'in' op)
 * .showWhen('name', 'truthy')                // non-empty / non-null
 */
showWhen(field: string, opOrValue: ConditionOp | unknown, value?: unknown): this {
  return this._addCondition('show', field, opOrValue, value)
}

/**
 * Hide this field when a condition on another field is met.
 */
hideWhen(field: string, opOrValue: ConditionOp | unknown, value?: unknown): this {
  return this._addCondition('hide', field, opOrValue, value)
}

/**
 * Show the field but make it readonly (disabled) when the condition is met.
 * Inspired by FilamentPHP's `.disabled(fn)`.
 */
disabledWhen(field: string, opOrValue: ConditionOp | unknown, value?: unknown): this {
  return this._addCondition('disabled', field, opOrValue, value)
}

private _addCondition(
  type: 'show' | 'hide' | 'disabled',
  field: string,
  opOrValue: ConditionOp | unknown,
  value?: unknown,
): this {
  const ops: ConditionOp[] = ['=','!=','>','>=','<','<=','in','not_in','truthy','falsy']
  if (Array.isArray(opOrValue)) {
    this._conditions.push({ type, field, op: 'in', value: opOrValue })
  } else if (opOrValue === 'truthy' || opOrValue === 'falsy') {
    this._conditions.push({ type, field, op: opOrValue, value: null })
  } else if (typeof opOrValue === 'string' && ops.includes(opOrValue as ConditionOp) && value !== undefined) {
    this._conditions.push({ type, field, op: opOrValue as ConditionOp, value })
  } else {
    // shorthand: .showWhen('status', 'published')  → op='='
    this._conditions.push({ type, field, op: '=', value: opOrValue })
  }
  return this
}
```

**Step 4: Serialize `_conditions` in `toMeta()`**

In `toMeta()`, add after `if (this._component !== undefined) meta.component = this._component`:
```ts
if (this._conditions.length > 0) meta.conditions = this._conditions
```

**Step 5: Run tests**
```bash
cd packages/panels && pnpm test 2>&1 | tail -5
```
Expected: all 8 new tests pass.

**Step 6: Commit**
```bash
git add packages/panels/src/Field.ts packages/panels/src/index.test.ts
git commit -m "feat(panels): add Condition type + showWhen/hideWhen/disabledWhen to Field"
```

---

### Task 2: Evaluate conditions in create + edit forms

**Files:**
- Modify: `packages/panels/pages/@panel/@resource/create/+Page.tsx`
- Modify: `packages/panels/pages/@panel/@resource/@id/edit/+Page.tsx`

**Step 1: Add `evalCondition` + `isFieldVisible` + `isFieldDisabled` helpers**

Add these helpers after the existing `flattenFormFields` function in **both** form pages:

```ts
import type { Condition } from '@boostkit/panels'

function evalCondition(cond: Condition, values: Record<string, unknown>): boolean {
  const val = values[cond.field]
  switch (cond.op) {
    case '=':       return val === cond.value
    case '!=':      return val !== cond.value
    case '>':       return (val as number)  >  (cond.value as number)
    case '>=':      return (val as number)  >= (cond.value as number)
    case '<':       return (val as number)  <  (cond.value as number)
    case '<=':      return (val as number)  <= (cond.value as number)
    case 'in':      return (cond.value as unknown[]).includes(val)
    case 'not_in':  return !(cond.value as unknown[]).includes(val)
    case 'truthy':  return !!val
    case 'falsy':   return !val
    default:        return true
  }
}

function isFieldVisible(field: FieldMeta, values: Record<string, unknown>): boolean {
  if (!field.conditions?.length) return true
  for (const cond of field.conditions as Condition[]) {
    const match = evalCondition(cond, values)
    if (cond.type === 'show'     && !match) return false
    if (cond.type === 'hide'     &&  match) return false
    // 'disabled' conditions don't affect visibility
  }
  return true
}

function isFieldDisabled(field: FieldMeta, values: Record<string, unknown>): boolean {
  if (!field.conditions?.length) return false
  return (field.conditions as Condition[])
    .filter(c => c.type === 'disabled')
    .some(c => evalCondition(c, values))
}
```

**Step 2: Apply visibility + disabled in `renderField`**

Update `renderField` in both pages:

```ts
function renderField(field: FieldMeta) {
  if (!isFieldVisible(field, values)) return null

  const disabled = field.readonly || isFieldDisabled(field, values)

  return (
    <div key={field.name}>
      {field.type !== 'boolean' && field.type !== 'toggle' && field.type !== 'hidden' && (
        <label className={['block text-sm font-medium mb-1.5', disabled ? 'opacity-50' : ''].join(' ')}>
          {field.label}
          {field.required && !disabled && <span className="text-destructive ml-0.5">*</span>}
        </label>
      )}
      <FieldInput
        field={field}
        value={values[field.name]}
        onChange={(v) => setValue(field.name, v)}
        uploadBase={uploadBase}
        i18n={i18n}
        disabled={disabled}
      />
      {errors[field.name]?.map((e) => (
        <p key={e} className="mt-1 text-xs text-destructive">{e}</p>
      ))}
    </div>
  )
}
```

Also update Section rendering — if all fields in a section are hidden by conditions, hide the whole section:
```ts
// In the section block, replace: const fields = section.fields.filter(...)
const fields = section.fields
  .filter((f) => !f.hidden.includes('create'))  // (or 'edit' in edit page)
  .filter((f) => isFieldVisible(f, values))
if (fields.length === 0) return null
```

**Step 3: Pass `disabled` prop to `FieldInput`**

`FieldInput` already probably has an HTML `disabled` attribute on its inputs. If not, add `disabled?: boolean` to the `Props` interface and thread it through to native inputs.

**Step 4: Sync both files to playground**
```bash
cp packages/panels/pages/@panel/@resource/create/+Page.tsx \
   "playground/pages/(panels)/@panel/@resource/create/+Page.tsx"

cp "packages/panels/pages/@panel/@resource/@id/edit/+Page.tsx" \
   "playground/pages/(panels)/@panel/@resource/@id/edit/+Page.tsx"
```

**Step 5: Export `Condition` and `ConditionOp` from index.ts**
```ts
export type { Condition, ConditionOp } from './Field.js'
```

**Step 6: Build + commit**
```bash
pnpm --filter @boostkit/panels build

git add packages/panels/pages/@panel/@resource/create/+Page.tsx \
        "packages/panels/pages/@panel/@resource/@id/edit/+Page.tsx" \
        "playground/pages/(panels)/@panel/@resource/create/+Page.tsx" \
        "playground/pages/(panels)/@panel/@resource/@id/edit/+Page.tsx" \
        packages/panels/src/index.ts
git commit -m "feat(panels): evaluate conditions in create/edit forms (show/hide/disabled)"
```

---

### Task 3: Field-level access control — `.readableBy()` + `.editableBy()`

Inspired by PayloadCMS's `access: { read, update }`.

**Files:**
- Modify: `packages/panels/src/Field.ts`
- Modify: `packages/panels/src/PanelServiceProvider.ts`

**Step 1: Write failing tests**

```ts
// ── Field-level access control ──────────────────────────────

test('readableBy stores function', () => {
  const fn = (ctx: any) => ctx.user?.role === 'admin'
  const f = TextField.make('x').readableBy(fn)
  // readableBy is not serialized — it's a server-side fn
  assert.equal(f.toMeta().extra['readableBy'], undefined)
  assert.ok(f.canRead({ user: { role: 'admin' } }))
  assert.equal(f.canRead({ user: { role: 'user' } }), false)
})

test('editableBy stores function', () => {
  const f = TextField.make('x').editableBy((ctx: any) => ctx.user?.role === 'admin')
  assert.ok(f.canEdit({ user: { role: 'admin' } }))
  assert.equal(f.canEdit({ user: { role: 'user' } }), false)
})

test('without readableBy, canRead returns true', () => {
  assert.ok(TextField.make('x').canRead({}))
})

test('without editableBy, canEdit returns true', () => {
  assert.ok(TextField.make('x').canEdit({}))
})
```

Run tests — expect 4 failures.

**Step 2: Add `_readableFn` / `_editableFn` to `Field`**

```ts
// In Field class, after _conditions:
protected _readableFn?: (ctx: unknown) => boolean
protected _editableFn?: (ctx: unknown) => boolean

/**
 * Control which users can see this field in list/show responses.
 * Evaluated server-side. Field is stripped from the response when fn returns false.
 * Inspired by PayloadCMS's `access.read`.
 *
 * @example
 * TextField.make('internalNotes').readableBy((ctx) => ctx.user?.role === 'admin')
 */
readableBy(fn: (ctx: unknown) => boolean): this {
  this._readableFn = fn
  return this
}

/**
 * Control which users can edit this field.
 * When fn returns false, the field becomes readonly in the form.
 * Inspired by PayloadCMS's `access.update`.
 *
 * @example
 * EmailField.make('email').editableBy((ctx) => ctx.user?.role === 'admin')
 */
editableBy(fn: (ctx: unknown) => boolean): this {
  this._editableFn = fn
  return this
}

/** @internal */
canRead(ctx: unknown): boolean {
  return this._readableFn ? this._readableFn(ctx) : true
}

/** @internal */
canEdit(ctx: unknown): boolean {
  return this._editableFn ? this._editableFn(ctx) : true
}
```

Note: these are NOT serialized into `FieldMeta` — they're server-side only.

**Step 3: Apply field access in `PanelServiceProvider`**

Add a private helper:
```ts
/**
 * Build a context-aware FieldMeta list, stripping unreadable fields
 * and marking non-editable fields as readonly.
 */
private applyFieldAccess(resource: Resource, ctx: PanelContext): { readable: Field[]; metas: FieldMeta[] } {
  const allFields = flattenFields(resource.fields())
  const readable = allFields.filter(f => f.canRead(ctx))

  const metas = readable.map(f => {
    const meta = f.toMeta()
    if (!f.canEdit(ctx)) meta.readonly = true
    return meta
  })

  return { readable, metas }
}
```

Apply in the list endpoint — after computing the response, strip values for unreadable fields from each record:
```ts
// After result = await q.paginate(...)
const { readable } = this.applyFieldAccess(resource, ctx)
const readableNames = new Set(readable.map(f => f.getName()))

result.data = result.data.map((r: unknown) => {
  const rec = r as Record<string, unknown>
  return Object.fromEntries(
    Object.entries(rec).filter(([k]) => readableNames.has(k) || k === 'id')
  )
})
```

Apply in the show endpoint similarly.

Also update the `/_meta` endpoint so the schema itself reflects field access (strip unreadable fields from the schema sent to the frontend):
```ts
// In the _meta handler, after building resourceMeta:
// Replace the fields array with access-filtered metas
const ctx = this.buildContext(req)
// (apply per-resource and rebuild metas with access-filtered fields)
```

**Step 4: Run tests**
```bash
cd packages/panels && pnpm test 2>&1 | tail -5
```
Expected: all 4 new tests pass.

**Step 5: Commit**
```bash
git add packages/panels/src/Field.ts \
        packages/panels/src/PanelServiceProvider.ts \
        packages/panels/src/index.test.ts
git commit -m "feat(panels): field-level readableBy/editableBy access control"
```

---

### Task 4: Per-field validation — `.validate(fn)`

Inspired by PayloadCMS's `validate: async (value, { data, operation }) => string | true`.

**Files:**
- Modify: `packages/panels/src/Field.ts`
- Modify: `packages/panels/src/PanelServiceProvider.ts`

**Step 1: Write failing tests**

```ts
// ── Per-field validation ────────────────────────────────────

test('validate() stores async validator', async () => {
  const f = TextField.make('slug')
    .validate(async (value) => value ? true : 'Slug is required')
  assert.equal(await f.runValidate('hello', {}), true)
  assert.equal(await f.runValidate('', {}), 'Slug is required')
})

test('validate() receives full form data', async () => {
  const f = TextField.make('endDate')
    .validate(async (value, data) => {
      if ((value as string) < (data as any).startDate) return 'End must be after start'
      return true
    })
  const result = await f.runValidate('2020-01-01', { startDate: '2021-01-01' })
  assert.equal(result, 'End must be after start')
})

test('without validate(), runValidate returns true', async () => {
  const f = TextField.make('x')
  assert.equal(await f.runValidate('anything', {}), true)
})
```

Run — expect 3 failures.

**Step 2: Add `_validateFn` to `Field`**

```ts
protected _validateFn?: (value: unknown, data: Record<string, unknown>) => Promise<string | true> | string | true

/**
 * Custom async validator for this field. Runs server-side alongside Zod validation.
 * Return `true` to pass, or an error string to fail.
 * Receives the field value AND the full form payload — use `data` to cross-validate.
 *
 * Inspired by PayloadCMS's `validate: async (value, { data }) => string | true`.
 *
 * @example
 * SlugField.make('slug')
 *   .validate(async (value, data) => {
 *     const exists = await Article.query().where('slug', value).where('id', '!=', data.id).first()
 *     return exists ? 'Slug already in use' : true
 *   })
 *
 * TextField.make('endDate')
 *   .validate((value, data) => {
 *     return value >= data.startDate ? true : 'End date must be after start date'
 *   })
 */
validate(fn: (value: unknown, data: Record<string, unknown>) => Promise<string | true> | string | true): this {
  this._validateFn = fn
  return this
}

/** @internal */
async runValidate(value: unknown, data: Record<string, unknown>): Promise<string | true> {
  return this._validateFn ? this._validateFn(value, data) : true
}

/** @internal */
hasValidate(): boolean { return this._validateFn !== undefined }
```

**Step 3: Run field validators in `PanelServiceProvider.validatePayload`**

Locate the `validatePayload` method. After the existing Zod-based validation loop, add:

```ts
// Per-field custom validators (inspired by PayloadCMS)
for (const field of flattenFields(resource.fields())) {
  if (!field.hasValidate()) continue
  if (field.isReadonly()) continue
  if (mode === 'create' && field.isHiddenFrom('create')) continue
  if (mode === 'update' && field.isHiddenFrom('edit')) continue

  const name  = field.getName()
  const value = body[name]
  const result = await field.runValidate(value, body)

  if (result !== true) {
    errors[name] = errors[name] ? [...errors[name], result] : [result]
  }
}
```

**Step 4: Run tests**
```bash
cd packages/panels && pnpm test 2>&1 | tail -5
```
Expected: all 3 new tests pass.

**Step 5: Commit**
```bash
git add packages/panels/src/Field.ts \
        packages/panels/src/PanelServiceProvider.ts \
        packages/panels/src/index.test.ts
git commit -m "feat(panels): per-field validate(fn) — async cross-field validation"
```

---

### Task 5: `.display()` transformer on `Field`

**Files:**
- Modify: `packages/panels/src/Field.ts`
- Modify: `packages/panels/src/PanelServiceProvider.ts`

**Step 1: Write failing tests**

```ts
// ── Display transformer ─────────────────────────────────────

test('display() sets displayTransformed in meta', () => {
  const f = NumberField.make('price').display((v) => `$${v}`)
  assert.equal(f.toMeta().displayTransformed, true)
})

test('displayTransformed absent without display()', () => {
  assert.equal(NumberField.make('price').toMeta().displayTransformed, undefined)
})

test('applyDisplay transforms value', () => {
  const f = NumberField.make('price').display((v) => `$${((v as number) / 100).toFixed(2)}`)
  assert.equal(f.applyDisplay(1999, {}), '$19.99')
})

test('applyDisplay receives the full record', () => {
  const f = TextField.make('title').display((v, r) => `${v} (${(r as any).status})`)
  assert.equal(f.applyDisplay('Hello', { status: 'draft' }), 'Hello (draft)')
})
```

Run — expect 4 failures.

**Step 2: Add `_displayFn` + `.display()` + helpers to `Field`**

```ts
protected _displayFn?: (value: unknown, record: unknown) => unknown

/**
 * Format a value for display in the table and show page.
 * Runs server-side — the pre-formatted value is sent to the frontend.
 * Inspired by FilamentPHP's `->formatStateUsing(fn)` and PayloadCMS's `hooks.afterRead`.
 *
 * @example
 * NumberField.make('price').display((v) => `$${((v as number) / 100).toFixed(2)}`)
 * DateField.make('createdAt').display((v) => new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(new Date(v as string)))
 */
display(fn: (value: unknown, record: unknown) => unknown): this {
  this._displayFn = fn
  return this
}

/** @internal */
hasDisplay(): boolean { return this._displayFn !== undefined }

/** @internal */
applyDisplay(value: unknown, record: unknown): unknown {
  return this._displayFn ? this._displayFn(value, record) : value
}
```

Serialize in `toMeta()`:
```ts
if (this._displayFn !== undefined) meta.displayTransformed = true
```

**Step 3: Apply transforms in `PanelServiceProvider` — add `applyTransforms` helper**

```ts
private applyTransforms(resource: Resource, records: unknown[]): unknown[] {
  const fields = flattenFields(resource.fields())
  const displayFields  = fields.filter(f => f.hasDisplay())
  const computedFields = fields.filter((f): f is ComputedField => f instanceof ComputedField)

  if (!displayFields.length && !computedFields.length) return records

  return records.map((r) => {
    const rec = { ...(r as Record<string, unknown>) }
    for (const f of displayFields) {
      rec[f.getName()] = f.applyDisplay(rec[f.getName()], rec)
    }
    for (const f of computedFields) {
      rec[f.getName()] = f.apply(rec)
    }
    return rec
  })
}
```

Call in list endpoint:
```ts
// After result = await q.paginate(...)
result.data = this.applyTransforms(resource, result.data) as typeof result.data
```

Call in show endpoint:
```ts
// After record = await q.find(id), before return:
const transformed = this.applyTransforms(resource, [record])[0]
return res.json({ data: transformed })
```

**Step 4: Update frontend — render `displayTransformed` as plain text**

In `packages/panels/pages/@panel/@resource/+Page.tsx`, in `CellValue`, add at the top of the rendering logic:
```tsx
if (type === 'computed' || displayTransformed) {
  return <span>{String(value ?? '')}</span>
}
```
Pass `displayTransformed={f.displayTransformed}` from the callsite.

In `packages/panels/pages/@panel/@resource/@id/+Page.tsx` (show page), in `renderValue()`:
```tsx
if (field.displayTransformed || field.type === 'computed') {
  return <span>{String(value ?? '')}</span>
}
```

Sync to playground:
```bash
cp packages/panels/pages/@panel/@resource/+Page.tsx \
   "playground/pages/(panels)/@panel/@resource/+Page.tsx"
cp "packages/panels/pages/@panel/@resource/@id/+Page.tsx" \
   "playground/pages/(panels)/@panel/@resource/@id/+Page.tsx"
```

**Step 5: Run tests + commit**
```bash
cd packages/panels && pnpm test 2>&1 | tail -5

git add packages/panels/src/Field.ts \
        packages/panels/src/PanelServiceProvider.ts \
        packages/panels/pages/@panel/@resource/+Page.tsx \
        "packages/panels/pages/@panel/@resource/@id/+Page.tsx" \
        "playground/pages/(panels)/@panel/@resource/+Page.tsx" \
        "playground/pages/(panels)/@panel/@resource/@id/+Page.tsx" \
        packages/panels/src/index.test.ts
git commit -m "feat(panels): display() transformer — server-side value formatting"
```

---

### Task 6: `ComputedField` — virtual server-side field

Inspired by FilamentPHP's `->state(fn)` and PayloadCMS's `hooks.afterRead`.

**Files:**
- Create: `packages/panels/src/fields/ComputedField.ts`
- Modify: `packages/panels/src/index.ts`

**Step 1: Write failing tests**

```ts
// ── ComputedField ───────────────────────────────────────────

test('ComputedField type is "computed"', () => {
  const f = ComputedField.make('x').compute(() => '')
  assert.equal(f.toMeta().type, 'computed')
})

test('ComputedField is auto-readonly + hidden from create/edit', () => {
  const meta = ComputedField.make('x').compute(() => '').toMeta()
  assert.equal(meta.readonly, true)
  assert.ok(meta.hidden.includes('create'))
  assert.ok(meta.hidden.includes('edit'))
})

test('ComputedField.apply() calls compute function', () => {
  const f = ComputedField.make('fullName')
    .compute((r) => `${(r as any).first} ${(r as any).last}`)
  assert.equal(f.apply({ first: 'Jane', last: 'Doe' }), 'Jane Doe')
})

test('ComputedField can chain .display()', () => {
  const f = ComputedField.make('wordCount')
    .compute((r) => ((r as any).body ?? '').split(/\s+/).length)
    .display((v) => `${v} words`)
  assert.equal(f.toMeta().displayTransformed, true)
  assert.equal(f.apply({ body: 'hello world foo' }), 3)
  assert.equal(f.applyDisplay(3, {}), '3 words')
})
```

Run — expect 4 failures.

**Step 2: Create `ComputedField.ts`**

```ts
// packages/panels/src/fields/ComputedField.ts
import { Field } from '../Field.js'

export class ComputedField extends Field {
  private _computeFn: (record: unknown) => unknown = () => null

  static make(name: string): ComputedField {
    return new ComputedField(name)
  }

  constructor(name: string) {
    super(name)
    this._readonly = true
    this._hidden.add('create')
    this._hidden.add('edit')
  }

  /**
   * Derive the field value from the full record object.
   * Runs server-side per record in list and show responses.
   * Inspired by FilamentPHP's `->state(fn)` and PayloadCMS's `hooks.afterRead`.
   *
   * @example
   * ComputedField.make('fullName')
   *   .compute((r) => `${(r as User).firstName} ${(r as User).lastName}`)
   *
   * ComputedField.make('wordCount')
   *   .compute((r) => (r as Article).body?.split(/\s+/).length ?? 0)
   *   .display((v) => `${v} words`)
   */
  compute(fn: (record: unknown) => unknown): this {
    this._computeFn = fn
    return this
  }

  /** @internal */
  apply(record: unknown): unknown {
    return this._computeFn(record)
  }

  getType(): string { return 'computed' }
}
```

**Step 3: Export from `index.ts`**

```ts
export { ComputedField } from './fields/ComputedField.js'
```

**Step 4: Run tests**
```bash
cd packages/panels && pnpm test 2>&1 | tail -5
```
Expected: all pass.

**Step 5: Commit**
```bash
git add packages/panels/src/fields/ComputedField.ts \
        packages/panels/src/index.ts \
        packages/panels/src/index.test.ts
git commit -m "feat(panels): add ComputedField for virtual server-side columns"
```

---

### Task 7: Demo in `ArticleResource`

**Files:**
- Modify: `playground/app/Panels/Admin/resources/ArticleResource.ts`

**Step 1: Showcase all four new features**

```ts
import { ComputedField } from '@boostkit/panels'

fields() {
  return [
    Section.make('Content').schema(
      TextField.make('title').required().searchable().sortable(),
      SlugField.make('slug').from('title').required()
        // Per-field validation — unique slug check
        .validate(async (value, data) => {
          const { Article } = await import('../../../Models/Article.js')
          const q = Article.query().where('slug', value as string)
          if (data['id']) (q as any).where('id', '!=', data['id'])
          return await (q as any).first() ? 'Slug already in use' : true
        }),

      TextareaField.make('excerpt').rows(3).hideFromTable(),

      // Conditional field — only visible when status = published
      DateField.make('publishedAt')
        .label('Publish Date')
        .showWhen('status', 'published'),

      TagsField.make('tags').label('Tags'),

      RelationField.make('categories')
        .label('Categories').resource('categories').display('name').multiple().creatable(),
    ),

    Section.make('Publishing').columns(2).schema(
      SelectField.make('status')
        .label('Status')
        .options([
          { label: 'Draft',     value: 'draft'     },
          { label: 'Published', value: 'published' },
          { label: 'Archived',  value: 'archived'  },
        ])
        .default('draft').required(),

      ToggleField.make('featured').label('Featured').onLabel('Featured').offLabel('Not featured'),

      ColorField.make('accentColor').label('Accent Color').hideFromTable(),

      DateField.make('createdAt').label('Created At').sortable().readonly()
        .hideFromCreate().hideFromEdit()
        // Display transformer — format date for table/show
        .display((v) =>
          v ? new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(new Date(v as string)) : '—'
        ),
    ),

    // Computed virtual field — word count derived from excerpt
    ComputedField.make('wordCount')
      .label('Words')
      .compute((r) => {
        const text = (r as any).excerpt as string ?? ''
        return text.trim() ? text.trim().split(/\s+/).length : 0
      })
      .display((v) => `${v} words`),

    Section.make('SEO & Metadata').description('Optional SEO fields.').collapsible().collapsed().schema(
      TextField.make('metaTitle').label('Meta Title').hideFromTable(),
      TextareaField.make('metaDescription').label('Meta Description').rows(2).hideFromTable(),
      JsonField.make('metadata').label('Extra Metadata').rows(4).hideFromTable(),
    ),
  ]
}
```

**Step 2: Verify in playground**

```bash
cd playground && pnpm dev
```

- `publishedAt` only shows in form when status = "Published" ✓
- `wordCount` column appears in table with "N words" ✓
- `createdAt` shows formatted dates like "Mar 11, 2026" ✓
- Saving an article with a duplicate slug shows inline validation error ✓

**Step 3: Commit**
```bash
git add playground/app/Panels/Admin/resources/ArticleResource.ts
git commit -m "demo(playground): showcase showWhen, display(), ComputedField, validate() in ArticleResource"
```

---

### Task 8: Update README + docs

**Files:**
- Modify: `packages/panels/README.md`
- Modify: `docs/packages/panels.md`

Add four new sections (after **Global Search**):

---

**`## Conditional Fields`**

````markdown
Show, hide, or disable form fields based on another field's current value.
Conditions are evaluated live in create and edit forms — no page reload.

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
| `.showWhen(field, op, value)` | Show when `field {op} value` — ops: `=` `!=` `>` `>=` `<` `<=` |
| `.showWhen(field, [values])` | Show when `field` is one of `[values]` |
| `.showWhen(field, 'truthy')` | Show when field is non-empty / non-null / non-zero |
| `.showWhen(field, 'falsy')` | Show when field is empty / null / zero / false |
| `.hideWhen(...)` | Inverse of showWhen — same overloads |
| `.disabledWhen(...)` | Show but make readonly — same overloads |

Multiple conditions can be stacked — all must pass.
Conditions only apply to **create and edit forms**. Use `.hideFromTable()` / `.hideFrom('view')` for table/show visibility.
````

---

**`## Field-level Access Control`**

````markdown
Restrict individual fields based on the current user — independent of the resource-level `policy()`.
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
| `.readableBy(ctx => bool)` | Field stripped from list + show responses; removed from the schema sent to the frontend |
| `.editableBy(ctx => bool)` | Field marked `readonly: true` in the schema — shown in form but not editable |

`ctx` is `PanelContext` (`{ user, headers, path }`).
````

---

**`## Per-field Validation`**

````markdown
Add async validators directly on a field — runs server-side alongside Zod validation.
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

- Return `true` → passes
- Return a string → shown as a field-level validation error (same as Zod errors)
- Runs after Zod validation; both can produce errors for the same field
- `data` is the full request body — use it to compare with other fields
````

---

**`## Display Transformers + Computed Fields`**

````markdown
### `.display(fn)` — format a raw value for the table and show page

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
    : '—'
  )

// Use the full record for context
TextField.make('status')
  .display((v, record) => {
    const r = record as { status: string; publishedAt?: string }
    return r.publishedAt ? `${v} on ${r.publishedAt}` : String(v)
  })
```

### `ComputedField` — virtual column with no database backing

Inspired by FilamentPHP's `->state(fn)` and PayloadCMS's `hooks.afterRead`.
Always readonly; hidden from create and edit forms.

```ts
import { ComputedField } from '@boostkit/panels'

// Word count from excerpt
ComputedField.make('wordCount')
  .label('Words')
  .compute((r) => (r as Article).excerpt?.split(/\s+/).length ?? 0)
  .display((v) => `${v} words`)

// Full name from parts
ComputedField.make('fullName')
  .label('Full Name')
  .searchable()
  .compute((r) => `${(r as User).firstName} ${(r as User).lastName}`)

// Revenue from nested relation data
ComputedField.make('revenue')
  .label('Revenue')
  .compute((r) => (r as any).orders?.reduce((s: number, o: any) => s + o.total, 0) ?? 0)
  .display((v) => `$${((v as number) / 100).toFixed(2)}`)
```

Combine `.compute()` with `.display()` to both derive and format in one field.
````

---

**Step 3: Commit**
```bash
git add packages/panels/README.md docs/packages/panels.md
git commit -m "docs(panels): conditional fields, field access, validate(), display transformers"
```

---

### Task 9: Final checks + changeset

**Step 1: Full test suite**
```bash
cd packages/panels && pnpm test
```
Expected: all pass (previous count + ~23 new tests).

**Step 2: Typecheck**
```bash
pnpm typecheck
```

**Step 3: Create changeset**
```bash
pnpm changeset
```
Select `@boostkit/panels` → `minor`. Message:
> Add conditional fields (showWhen/hideWhen/disabledWhen with rich operators), field-level access control (readableBy/editableBy), per-field async validation, display transformers (.display()), and ComputedField for virtual server-side columns.

**Step 4: Commit**
```bash
git add .changeset/
git commit -m "chore: changeset for panels minor (field-level features)"
```
