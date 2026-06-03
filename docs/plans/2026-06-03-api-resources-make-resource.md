# API Resources Completion + `make:resource` Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.
> This plan is self-contained for a fresh session/agent — no prior conversation context needed.

**Goal:** Close the remaining Laravel "Eloquent: API Resources" parity gaps — `make:resource` scaffolder, paginator-aware response envelopes, `additional()`, broader conditional helpers (`whenHas`/`whenCounted`/`whenAggregated`), and `Model.toResource()` integration — plus the docs page.

**Architecture:** `JsonResource` + `ResourceCollection` **already exist and ship** in `@rudderjs/orm` (`packages/orm/src/resource.ts`, with `when`/`whenNotNull`/`whenLoaded`/`mergeWhen` + `collection()`/`toResponse()`). This plan is additive surface on that file, a new MakeSpec in `@rudderjs/orm` + a CLI loader entry (mirroring `make:factory`), and one docs page. No new package; no adapter/contract changes anywhere.

**Tech Stack:** TypeScript strict/NodeNext ESM (`.js` import extensions), `node --test` via each package's `pnpm test`, MakeSpec scaffolder pattern from `@rudderjs/console`.

---

## 0. Context for a fresh session

**What already exists — do not rebuild:**

- `packages/orm/src/resource.ts` — `JsonResource<T>` (abstract `toArray(req?)`, protected `when`/`whenNotNull`/`whenLoaded`/`mergeWhen`, `static collection(items, meta?)`, `toJSON()` that throws on async `toArray`) and `ResourceCollection<T>` (`toArray(req?)`, `toResponse(req?)` → `{ data, meta? }`, `static of`). Read the whole file first; every task below extends it.
- Scaffolder infra: `packages/console/src/make.ts:3-45` — the `MakeSpec` interface (`command`, `description`, `label`, `suffix?`, `directory`, `extension?`, `stub(className)`, `afterCreate?`) + `registerMakeSpecs()` (globalThis-backed registry).
- The reference MakeSpec to mirror: `packages/orm/src/commands/make-factory.ts` (`makeFactorySpec`). Subpath export in `packages/orm/package.json` (`"./commands/make-factory"`); loaded by `packages/cli/src/index.ts` `loadPackageCommands()` (~lines 144-276 — find the `@rudderjs/orm` block that registers `makeFactorySpec`/`makeSeederSpec` and mirror it).
- Model serialization the resources build on: `Model.toJSON()` (`packages/orm/src/index.ts:~3455`), `static hidden/visible/appends/casts`.
- Aggregate eager loading stamps deterministic camelCase aliases on instances: `withCount('posts')` → `postsCount`, `withSum('posts', 'views')` → `postsSumViews`, etc., tagged on a `Symbol.for('rudderjs.orm.aggregates')` Set (see `packages/orm/CLAUDE.md`, relations bullet). Task 3's `whenCounted`/`whenAggregated` read those stamped properties — no querying.
- Pagination shapes: `Model.paginate(page, perPage)` resolves to `{ data, total, perPage, lastPage, page, hasMorePages }` (plain object); `cursorPaginate` resolves to a `CursorPaginator` (`packages/orm/src/cursor-paginator.ts`: `{ data, perPage, nextCursor, prevCursor, hasMore }` + `toJSON()`).
- Gap-analysis source: `docs/plans/2026-06-01-laravel-db-orm-gap-analysis.md` (the Resources row lists the Laravel surface this plan closes).

**Conventions (repo rules — follow exactly):**

- Branch BEFORE any edit (`git checkout -b feat/...` off `main`); one PR per task.
- Conventional commits; **never** include `Co-Authored-By: Claude` or any Claude attribution. Author email must be the GitHub noreply (`13323859+suliemandev@users.noreply.github.com`).
- Every `feat:` PR needs a changeset (`pnpm changeset`, minor). Check before push: `git diff --stat main..HEAD .changeset/` shows a new file.
- orm tests: `packages/orm/src/**/*.test.ts` next to source → `cd packages/orm && pnpm test` (tsc to `dist-test/` then `node --test`; glob discovery — no list files to edit).
- `instanceof` is fragile across dev-HMR re-imports (see CLAUDE.md / memory `instanceof Table` incident) — **duck-type** paginator detection in Task 2, don't `instanceof CursorPaginator`.
- Windows CI note: a `-1073741502` exit on the two `windows-latest` checks is a known desktop-heap flake, not your change — rerun-failed on a fresh runner clears it. Don't cancel a running required job.

---

### Task 1: `make:resource` scaffolder

**Files:**
- Create: `packages/orm/src/commands/make-resource.ts`
- Create: `packages/orm/src/commands/make-resource.test.ts` (mirror the existing factory/seeder spec tests if present in `src/commands/`; otherwise assert spec fields + stub content)
- Modify: `packages/orm/package.json` (exports map: add `"./commands/make-resource"`)
- Modify: `packages/cli/src/index.ts` (`loadPackageCommands()` — add the loader entry next to make-factory/make-seeder)

**Step 1 — failing test:** spec has `command: 'make:resource'`, `suffix: 'Resource'`, `directory: 'app/Resources'`; `stub('UserResource')` contains `extends JsonResource`, `import { User } from 'App/Models/User.js'`, and a `toArray()` body.

**Step 2 — implement** (model on `make-factory.ts`, same header-comment style):

```ts
import type { MakeSpec } from '@rudderjs/console'

/**
 * `pnpm rudder make:resource User` → `app/Resources/UserResource.ts`
 *
 * The base model name is inferred from the resource's stem — `UserResource`
 * imports `User` from `App/Models/User.js`. Users rename if their model file
 * doesn't match the convention.
 */
export const makeResourceSpec: MakeSpec = {
  command:     'make:resource',
  description: 'Create a new API resource class',
  label:       'Resource created',
  suffix:      'Resource',
  directory:   'app/Resources',
  stub: (className) => {
    const modelName = className.replace(/Resource$/, '')
    return `import { JsonResource } from '@rudderjs/orm'
import { ${modelName} } from 'App/Models/${modelName}.js'

export class ${className} extends JsonResource<${modelName}> {
  toArray() {
    return {
      id: this.resource.id,
      // name:  this.resource.name,
      // admin: this.when(this.resource.role === 'admin', true),
      // posts: this.whenLoaded('posts', PostResource.collection(this.resource.posts as Post[])),
    }
  }
}

// In a route handler:
//   return res.json(new ${className}(${modelName.toLowerCase()}).toArray())
//   return res.json(await ${className}.collection(${modelName.toLowerCase()}s).toResponse())
`
  },
}
```

> Type note: `JsonResource<T>`'s constraint is `T extends Record<string, unknown>`. If a hydrated `Model` subclass doesn't satisfy it cleanly in the stub (check against `packages/orm/src/resource.ts` + a real model), either loosen the stub generic the way `make-factory` deliberately uses `any` (with the same explanatory comment), or widen the constraint in Task 4 — don't ship a stub that fails `tsc` on a fresh `make:model X && make:resource X` pair.

**Step 3 — wire:** package.json export (copy the make-factory entry shape, both `import` + `types` conditions if used there); CLI loader entry in `packages/cli/src/index.ts` next to the existing orm block — same `tryImport('@rudderjs/orm', 'commands/make-resource')` + `registerMakeSpecs(mod['makeResourceSpec'])` pattern.

**Step 4 — verify:** `cd packages/orm && pnpm build && pnpm test`; `cd packages/cli && pnpm build && pnpm typecheck`; then from `playground/`: `pnpm rudder make:resource Demo` writes `app/Resources/DemoResource.ts` and the file passes `pnpm typecheck` in playground; delete the scratch file after.

**Changeset:** minor `@rudderjs/orm` + minor `@rudderjs/cli` (new loader entry).

---

### Task 2: Paginator-aware collections + `additional()` + `toResponse()` on single resources

**Files:**
- Modify: `packages/orm/src/resource.ts`
- Create: `packages/orm/src/resource-envelope.test.ts`

**Surface (Laravel parity, non-breaking — every existing call site keeps working):**

1. `Resource.collection(...)` additionally accepts paginator results and auto-derives `meta`:
   - Offset shape (duck-type: `data` array + numeric `total`/`perPage`/`page`/`lastPage` present) → items = `.data`, `meta: { total, page, perPage, lastPage }`.
   - Cursor shape (duck-type: `data` array + `nextCursor`/`prevCursor`/`hasMore` keys present) → items = `.data`, `meta: { perPage, nextCursor, prevCursor, hasMore }`.
   - Plain array → exactly today's behavior. Explicit `meta` second arg merges over (wins on key conflict with) the derived meta.
   - **Duck-type, no `instanceof`** (HMR re-import fragility — see Conventions).
2. `additional(extra: Record<string, unknown>)` on **both** `ResourceCollection` and `JsonResource` — returns `this`, merges into the envelope at top level (Laravel semantics: alongside `data`/`meta`, not inside).
3. `JsonResource.toResponse(req?)` → `Promise<{ data: Record<string, unknown>, ...additional }>` — the wrapped single-resource envelope (async-safe, unlike `toJSON()`). Existing unwrapped `new R(x).toArray()` usage stays the documented default; `toResponse()` is the opt-in envelope.

**TDD:** failing tests first — `collection(await User.paginate(1, 2))` envelope equals `{ data: [...], meta: { total, page, perPage, lastPage } }`; cursor variant; explicit-meta merge precedence; `additional({ status: 'ok' })` lands top-level on both collection and single; plain-array path byte-identical to before (regression). Use the in-memory test adapter patterns from neighboring orm tests (e.g. the existing resource/serialization tests — find with `ls packages/orm/src/*.test.ts | grep -i resour` or grep `JsonResource`).

**Changeset:** minor `@rudderjs/orm`.

---

### Task 3: Conditional helper breadth — `whenHas` / `whenCounted` / `whenAggregated`

**Files:**
- Modify: `packages/orm/src/resource.ts`
- Create: `packages/orm/src/resource-helpers.test.ts`

**Surface (all `protected`, on `JsonResource`):**

```ts
/** Include only when the attribute is present on the underlying resource
 *  (covers Model partial-select hydration). value defaults to the attribute. */
whenHas<R>(attribute: string, value?: R, fallback?: R): R | undefined

/** Include the stamped `<relation>Count` only when withCount('<relation>')
 *  loaded it — reads `postsCount` for whenCounted('posts'). */
whenCounted(relation: string, fallback?: number): number | undefined

/** Generalized: whenAggregated('posts', 'sum', 'views') reads `postsSumViews`
 *  (the deterministic camelCase alias the ORM stamps — see packages/orm/CLAUDE.md). */
whenAggregated(relation: string, fn: 'count' | 'sum' | 'min' | 'max' | 'avg' | 'exists', column?: string): unknown
```

Implementation is presence-checking on `this.resource` (same pattern as the existing `whenLoaded`) — compute the alias with the same camelCase rules the aggregate loader uses (`postsCount`, `postsSumViews`, `postsExists`); grep `packages/orm/src/relations/aggregate.ts` (or wherever the alias is built) and **reuse/extract that alias helper rather than re-deriving the string format** (DRY — drift here would silently break the helper when the alias rules change).

**Deliberately skipped:** `whenPivotLoaded` — pivot columns are not surfaced on M2M reads in this ORM (v1 decision, `packages/orm/CLAUDE.md` belongsToMany bullet). Note it in the docs page as "gated on pivot-column reads", don't implement.

**TDD:** model instance from `withCount`/`withSum` queries (in-memory adapter) → helper includes; plain query → helper omits; `whenHas` with partial select.

**Changeset:** minor `@rudderjs/orm`.

---

### Task 4: Model integration — `static resourceClass` + `toResource()` / `toResourceCollection()`

**Files:**
- Modify: `packages/orm/src/index.ts` (Model methods), `packages/orm/src/collection.ts` (ModelCollection method), `packages/orm/src/resource.ts` (only if the generic constraint needs widening — see Task 1 note)
- Create: `packages/orm/src/to-resource.test.ts`

**Surface** (naming mirrors the existing `static factoryClass` precedent from the factory wiring — see the `make:factory` stub comment):

```ts
class User extends Model {
  static resourceClass = UserResource          // optional binding
}

user.toResource()                              // → new UserResource(user)
user.toResource(AdminUserResource)             // explicit override wins
users.toResourceCollection()                   // ModelCollection → ResourceCollection
users.toResourceCollection(AdminUserResource)
```

No class arg + no `static resourceClass` → throw `[RudderJS ORM] User has no resourceClass — set \`static resourceClass = UserResource\` or pass the class: \`user.toResource(UserResource)\`.` No name-convention auto-discovery (would need a resource registry; YAGNI — the explicit static matches how factories wire).

Watch the import direction: `index.ts` already exports `resource.ts`; the Model methods reference resource types — keep `resource.ts` free of `Model` imports (type-only generic stays `Record<string, unknown>`-constrained or is widened, never `extends Model`).

**TDD:** bound static path, explicit-arg path, override precedence, throw message, collection variant, and that `toResourceCollection().toResponse()` composes with Task 2's envelope.

**Changeset:** minor `@rudderjs/orm`.

---

### Task 5: Docs + playground demo

**Files:**
- Create: `docs/guide/database/resources.md`
- Modify: `docs/guide/database.md` (link it), `docs/guide/database/models.md` (cross-ref from the serialization section)
- Modify: `packages/orm/CLAUDE.md` (Key Files line for `resource.ts` + new bullets: envelope rules, helper aliases, `resourceClass`)
- Playground: create `playground/app/Resources/TodoResource.ts` (the Todo module model exists at `playground/app/Modules/Todo/`) + a small JSON endpoint in `playground/routes/api.ts` returning `TodoResource.collection(await Todo.paginate(...)).toResponse()`.

**Docs page covers:** `pnpm rudder make:resource Post`; single + collection + paginator envelopes; `additional()`; all conditional helpers (incl. the `whenPivotLoaded` deferral note); `static resourceClass` + `toResource()`; the async-`toArray` rule (`toJSON()` throws → `await resource.toArray()` / `toResponse()`).

Style: mirror an existing `docs/guide/database/*.md` page's frontmatter/heading conventions. The playground also has `.ai/skills/orm-models/rules/resources.md` — update it if its content now drifts (it documents manual `meta` passing, which Task 2 supersedes).

No changeset (docs/playground only). Post-merge note for the maintainer: rudderjs.com 4-step docs sync + sidebar hand-update.

---

## Risks / guardrails

- **Non-breaking only:** every Task-2/3/4 addition is opt-in; existing `collection(items, meta)` and bare `toArray()` call sites must pass unchanged (regression tests pin this).
- **Client bundle:** `resource.ts` is on `@rudderjs/orm`'s client-reachable graph — no `node:` imports, no `process.env`. Run `pnpm test:client-bundle` from root after Tasks 2–4.
- **Alias drift (Task 3):** reuse the ORM's aggregate-alias builder; don't re-implement the camelCase rules.
- **Stub must typecheck on a fresh scaffold** (Task 1 type note) — verify in playground before shipping.
- **No new contract/adapter surface anywhere** — if you find yourself editing `@rudderjs/contracts` or an adapter, stop and re-read the plan; everything here is Model-layer.
