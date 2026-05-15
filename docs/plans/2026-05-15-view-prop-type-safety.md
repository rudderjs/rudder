# View-Prop Type-Safety Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.

**Status:** planning, 2026-05-15.
**Effort:** ~1.5–2 days for Phases 1–4 (single PR per the minimum-push preference). Phases 5–6 are optional follow-ups.
**Prerequisites:** none. Stacks cleanly on top of current `main` (`@rudderjs/view@1.x`, `@rudderjs/vite@2.x`).

**Goal:** Make `view('id', props)` and the receiving view component type-check together so a prop mismatch fails at compile time, not at runtime. Inertia-style controller↔component agreement, zero codegen ceremony at the call site.

**Architecture:** Three moving parts, all opt-in.

1. `@rudderjs/view` exposes an empty `ViewPropsRegistry` module-augmentation interface and adds a typed `view<Id extends keyof ViewPropsRegistry>(id, props)` overload above the existing untyped one. Apps that never augment the registry keep today's behavior verbatim — no breaking change.
2. `@rudderjs/vite`'s views scanner gains one new output: `pages/__view/registry.d.ts`. For every discovered view whose source file has `export interface Props` or `export type Props`, the scanner emits a registry entry mapping the view id to `import('App/Views/<file>').Props`. Views without an exported `Props` are omitted; the call falls through to the loose overload.
3. The per-view `+Page` stubs are upgraded to read `pageContext.viewProps` with the registry-derived type, so authors get intellisense in the rendered component too.

**Tech Stack:** TypeScript module augmentation + dynamic-import type extraction (no AST parsing). Regex-only source scanning (matches the existing `ROUTE_EXPORT_RE` style in `views-scanner.ts`). No new runtime dependencies.

**Why this design**

- **No TS AST dep.** Asking TypeScript to extract `Props` shapes at build time would require `ts-morph` or the TS compiler API. Instead, the generated `.d.ts` just re-exports the type via `import('...').Props` — TypeScript does the heavy lifting at type-check time. The scanner only needs to know *whether* a `Props` export exists (regex is enough).
- **Single emitted file vs per-view files.** One `pages/__view/registry.d.ts` keeps the watcher diff small and avoids file-explosion for apps with many views. The shared registry pattern matches how `@rudderjs/view/types/vike.ts` already works.
- **`export interface Props` convention.** This is the lowest-friction convention that works across React, Solid, and Vue's `<script setup lang="ts">`. Vanilla (HTML-string) views opt out — they're typed function arguments already.
- **Opt-in.** Apps without a `Props` export keep the current `Record<string, unknown>` behavior verbatim. No migration required.

---

## What ships

| Component | Path | Status |
|---|---|---|
| `ViewPropsRegistry` interface + typed `view<Id>()` overload | `packages/view/src/index.ts` (modify) | new |
| Vike `PageContext.viewProps` becomes generic over registry id | `packages/view/src/types/vike.ts` (modify) | new |
| Scanner detects `export interface Props` / `export type Props` in view sources | `packages/vite/src/views-scanner.ts` (modify) | new |
| Scanner emits `pages/__view/registry.d.ts` with one `import(...).Props` entry per typed view | `packages/vite/src/views-scanner.ts` (modify) | new |
| React `+Page.tsx` stub uses registry type for `viewProps` | `packages/vite/src/views-scanner.ts` (modify) | new |
| Solid `+Page.tsx` stub uses registry type | `packages/vite/src/views-scanner.ts` (modify) | new |
| Vue `+Page.vue` stub uses registry type | `packages/vite/src/views-scanner.ts` (modify) | new |
| Snapshot tests covering the new outputs | `packages/vite/src/views-scanner.test.ts` (modify) | new |
| Unit test for typed `view()` overload (positive + `@ts-expect-error`) | `packages/view/src/typed-view.test-d.ts` (new) | new |
| Playground demo: `app/Views/Demos/TypedViewDemo.tsx` exports `Props`, controller call gets type-checked | `playground/app/Views/Demos/TypedViewDemo.tsx`, `playground/routes/web.ts` | new |
| Docs page on the convention | `docs/guide/typed-views.md` (new) + sidebar entry | new |
| Changeset (minor on view + vite) | `.changeset/typed-view-props.md` | new |

Out of scope (deferred follow-ups, listed at bottom): vanilla-view typing, `pnpm rudder view:sync` CLI command, codegen of fixture props for storybook.

---

## Phase 1 — `ViewPropsRegistry` interface + typed overload

### Task 1.1: Add `ViewPropsRegistry` interface to `@rudderjs/view`

**Files:**
- Modify: `packages/view/src/index.ts`

**Step 1: Write the failing test**

Create `packages/view/src/typed-view.test-d.ts`:

```ts
/**
 * Type-only test. Compiled with `tsc --noEmit`; failing assertions surface as
 * tsc errors. This file MUST be picked up by the package's tsconfig include.
 */
import { view, type ViewPropsRegistry } from './index.js'

// Augmentation simulates what the scanner will emit.
declare module './index.js' {
  interface ViewPropsRegistry {
    'typed.demo': { user: { id: number; name: string }; count: number }
  }
}

// ✅ Correct shape compiles.
view('typed.demo', { user: { id: 1, name: 'a' }, count: 0 })

// ❌ Missing required prop.
// @ts-expect-error count missing
view('typed.demo', { user: { id: 1, name: 'a' } })

// ❌ Wrong prop type.
// @ts-expect-error count must be number
view('typed.demo', { user: { id: 1, name: 'a' }, count: 'oops' })

// ❌ Extra prop with exactOptionalPropertyTypes / strict object literal check.
// @ts-expect-error 'bogus' not in Props
view('typed.demo', { user: { id: 1, name: 'a' }, count: 0, bogus: true })

// ✅ Unknown id falls through to the loose overload.
view('not-in-registry', { whatever: 1 })

// Exported to silence "isolatedModules" tsc warning.
export {}
```

**Step 2: Run the test to verify it fails**

Run: `cd packages/view && pnpm typecheck`
Expected: FAIL — `ViewPropsRegistry` not exported from `./index.js`, typed overload not yet present.

**Step 3: Add registry interface and typed overload**

Modify `packages/view/src/index.ts`. Find the existing `view()` signature; replace with:

```ts
/**
 * Module-augmentation registry mapping view ids → component prop types.
 *
 * `@rudderjs/vite`'s views scanner populates this automatically at build
 * time by emitting `pages/__view/registry.d.ts`. App authors never write
 * to this interface directly — they just `export interface Props` in their
 * view component and the scanner picks it up.
 *
 * Unrecognized ids fall through to the loose `view(id, props?)` overload,
 * so calls in apps that haven't adopted the convention keep working.
 */
export interface ViewPropsRegistry {}

/** Resolved prop type for a registered view id. */
export type ViewPropsFor<Id extends keyof ViewPropsRegistry> = ViewPropsRegistry[Id]

// Typed overload — narrows props by id when the registry has an entry.
export function view<Id extends keyof ViewPropsRegistry>(
  id:      Id,
  props:   ViewPropsRegistry[Id],
  options?: ViewOptions,
): ViewResponse

// Loose fallback — preserves today's behavior for unregistered ids and
// dynamic call sites (`view(someVar, props)`).
export function view(id: string, props?: ViewProps, options?: ViewOptions): ViewResponse

export function view(id: string, props?: ViewProps, options?: ViewOptions): ViewResponse {
  // ... existing implementation unchanged ...
}
```

**Step 4: Run the test to verify it passes**

Run: `cd packages/view && pnpm typecheck`
Expected: PASS — `@ts-expect-error` directives all match real errors, valid calls compile.

**Step 5: Run the rest of the view package's tests**

Run: `cd packages/view && pnpm test`
Expected: PASS — runtime overloads collapse to the single impl, no behavioral change.

**Step 6: Commit**

```bash
git add packages/view/src/index.ts packages/view/src/typed-view.test-d.ts
git commit -m "feat(view): add ViewPropsRegistry interface and typed view() overload"
```

---

### Task 1.2: Narrow `pageContext.viewProps` over registry id

**Files:**
- Modify: `packages/view/src/types/vike.ts`

**Step 1: Update the Vike augmentation**

Currently `viewProps` is typed as `ViewProps` (loose record). Make it generic so framework hooks can narrow when they know the id:

```ts
// packages/view/src/types/vike.ts
import type { ViewProps, ViewPropsRegistry } from '../index.js'

declare global {
  namespace Vike {
    interface PageContext {
      /**
       * Props passed to the view component, set by `view('id', props)`.
       *
       * Typed as the union of all registered prop shapes when at least one
       * view has augmented `ViewPropsRegistry`; falls back to `ViewProps`
       * (loose record) for apps that haven't adopted the typed convention.
       */
      viewProps?: keyof ViewPropsRegistry extends never
        ? ViewProps
        : ViewPropsRegistry[keyof ViewPropsRegistry]
      viewHeaders?: Record<string, string>
    }
  }
}

export {}
```

**Step 2: Typecheck**

Run: `cd packages/view && pnpm typecheck`
Expected: PASS.

**Step 3: Commit**

```bash
git add packages/view/src/types/vike.ts
git commit -m "feat(view): narrow pageContext.viewProps over ViewPropsRegistry"
```

---

## Phase 2 — Scanner emits per-app registry.d.ts

### Task 2.1: Detect `export interface Props` / `export type Props` in view sources

**Files:**
- Modify: `packages/vite/src/views-scanner.ts`
- Test: `packages/vite/src/views-scanner.test.ts`

**Step 1: Write the failing test**

Append to `views-scanner.test.ts` (a new `describe` block):

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { viewsScannerPlugin } from './views-scanner.js'

function withTempApp(setup: (root: string) => void): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rudderjs-typedview-'))
  setup(root)
  return root
}

test('scanner emits registry.d.ts for views with exported Props', () => {
  const root = withTempApp(r => {
    fs.mkdirSync(path.join(r, 'app/Views'), { recursive: true })
    fs.mkdirSync(path.join(r, 'node_modules/vike-react'), { recursive: true })
    fs.writeFileSync(path.join(r, 'node_modules/vike-react/package.json'), '{}')
    fs.writeFileSync(
      path.join(r, 'app/Views/Dashboard.tsx'),
      `export interface Props { user: { id: number }; count: number }\nexport default function Dashboard(_: Props) { return null }\n`,
    )
    fs.writeFileSync(
      path.join(r, 'app/Views/Untyped.tsx'),
      `export default function Untyped() { return null }\n`,
    )
  })

  const cwdBefore = process.cwd()
  process.chdir(root)
  try {
    viewsScannerPlugin() // construction triggers eager sync
    const registry = fs.readFileSync(path.join(root, 'pages/__view/registry.d.ts'), 'utf8')
    assert.match(registry, /'dashboard':\s*import\(['"]App\/Views\/Dashboard\.tsx['"]\)\.Props/)
    assert.doesNotMatch(registry, /'untyped':/, 'view without Props export must be omitted')
  } finally {
    process.chdir(cwdBefore)
    fs.rmSync(root, { recursive: true, force: true })
  }
})
```

**Step 2: Run the test to verify it fails**

Run: `cd packages/vite && pnpm test`
Expected: FAIL — `registry.d.ts` does not exist; emit logic missing.

**Step 3: Add Props detection to discover()**

In `views-scanner.ts`, add a regex and extend `DiscoveredView`:

```ts
// Same style as ROUTE_EXPORT_RE. Multiline-tolerant.
const PROPS_EXPORT_RE = /(?:^|[\s;])export\s+(?:interface|type)\s+Props\b/m

function readHasPropsExport(absPath: string): boolean {
  try {
    return PROPS_EXPORT_RE.test(fs.readFileSync(absPath, 'utf8'))
  } catch {
    return false
  }
}

interface DiscoveredView {
  id:          string
  absPath:     string
  importPath:  string
  outDir:      string
  url:         string
  hasProps:    boolean   // NEW
}
```

In `discover()`, set `hasProps: readHasPropsExport(absPath)`.

**Step 4: Add the registry generator**

Below `cleanStale`, add:

```ts
/**
 * Emit `pages/__view/registry.d.ts` with one TypeScript module-augmentation
 * entry per view that has an exported `Props` type.
 *
 * Uses `import('...').Props` rather than a top-level import so that:
 *   (a) the file stays a pure type-declaration with no runtime impact, and
 *   (b) tsc resolves the import lazily — missing source files surface as a
 *       targeted error pointing at the missing view, not a registry-wide
 *       compile break.
 *
 * Views without an exported `Props` are omitted; their calls fall through
 * to the loose `view(id, props?)` overload.
 */
function registryFileSource(views: DiscoveredView[]): string {
  const typed = views.filter(v => v.hasProps)
  const entries = typed
    .map(v => `    '${v.id}': import('${v.importPath}').Props`)
    .join('\n')

  return `// AUTO-GENERATED by @rudderjs/vite — do not edit.
// Maps view ids → exported component Props types for typed view() calls.
// Re-generated on every scan; views without an exported Props are omitted.
declare module '@rudderjs/view' {
  interface ViewPropsRegistry {
${entries}
  }
}
export {}
`
}
```

In `generate()`, after the loop over `views`:

```ts
writeIfChanged(path.join(generatedRoot, 'registry.d.ts'), registryFileSource(views))
```

**Step 5: Run the test to verify it passes**

Run: `cd packages/vite && pnpm test`
Expected: PASS.

**Step 6: Commit**

```bash
git add packages/vite/src/views-scanner.ts packages/vite/src/views-scanner.test.ts
git commit -m "feat(vite): scanner emits registry.d.ts for views with exported Props"
```

---

### Task 2.2: Idempotent registry write + cleanup when no typed views remain

**Files:**
- Modify: `packages/vite/src/views-scanner.ts`
- Test: `packages/vite/src/views-scanner.test.ts`

**Step 1: Write the failing test**

```ts
test('registry.d.ts is removed when no view exports Props', () => {
  const root = withTempApp(r => {
    fs.mkdirSync(path.join(r, 'app/Views'), { recursive: true })
    fs.mkdirSync(path.join(r, 'node_modules/vike-react'), { recursive: true })
    fs.writeFileSync(path.join(r, 'node_modules/vike-react/package.json'), '{}')
    fs.writeFileSync(path.join(r, 'app/Views/Untyped.tsx'), `export default () => null\n`)
  })
  process.chdir(root)
  viewsScannerPlugin()
  const target = path.join(root, 'pages/__view/registry.d.ts')
  // Acceptable outcomes: file absent, OR file present with an empty interface.
  if (fs.existsSync(target)) {
    const contents = fs.readFileSync(target, 'utf8')
    assert.doesNotMatch(contents, /import\(/, 'no typed views = no import() entries')
  }
})
```

**Step 2: Decide behavior — empty interface vs file removal**

Pick "empty interface". It keeps tsc happy on apps in transition and avoids special-casing the cleanup pass. Emit:

```ts
declare module '@rudderjs/view' {
  interface ViewPropsRegistry {
  }
}
```

The existing `registryFileSource()` already produces this when `typed` is empty — no code change needed. Just ensure the empty case is exercised by tests.

**Step 3: Run the test**

Run: `cd packages/vite && pnpm test`
Expected: PASS.

**Step 4: Commit**

(no code change unless test surfaced a bug — likely just adds the test)

```bash
git add packages/vite/src/views-scanner.test.ts
git commit -m "test(vite): cover empty ViewPropsRegistry case"
```

---

### Task 2.3: Re-emit on view source change (HMR)

**Files:**
- Modify: `packages/vite/src/views-scanner.ts`

The existing `sync()` runs on `add`/`unlink`/`change`, so this is mostly free — but the `change` handler currently filters by extension only. Confirm a content edit (adding `export interface Props`) actually retriggers `discover()`.

**Step 1: Manual smoke test**

In `playground/`:

```bash
cd playground && pnpm dev
```

Edit `app/Views/Welcome.tsx` to add `export interface Props { foo: string }` at the top. Observe that `playground/pages/__view/registry.d.ts` updates within a watcher tick to include `'welcome': import('App/Views/Welcome.tsx').Props`.

Revert the Welcome.tsx edit before continuing.

**Step 2: If the watcher doesn't re-emit on content change, add a content-hash short-circuit**

(Most likely it works — the change handler calls `sync()` which re-reads every file. But verify before assuming.)

**Step 3: Commit if any code changed**

```bash
git add packages/vite/src/views-scanner.ts
git commit -m "fix(vite): re-emit registry.d.ts on view source content changes"
```

---

## Phase 3 — Typed `+Page` stubs

### Task 3.1: React stub reads typed viewProps

**Files:**
- Modify: `packages/vite/src/views-scanner.ts` (the `reactStub` function)

**Step 1: Write the failing test**

Add to `views-scanner.test.ts`:

```ts
test('react stub references the per-view Props type when available', () => {
  // setup root with Dashboard.tsx that exports Props (same fixture as Task 2.1)
  // ...
  process.chdir(root)
  viewsScannerPlugin()
  const stub = fs.readFileSync(path.join(root, 'pages/__view/dashboard/+Page.tsx'), 'utf8')
  assert.match(stub, /import type \{ Props \} from ['"]App\/Views\/Dashboard\.tsx['"]/)
  assert.match(stub, /viewProps\?:\s*Props/)
  assert.doesNotMatch(stub, /Record<string, unknown>/, 'should not fall back to loose record when Props exists')
})

test('react stub falls back to loose props when no Props export', () => {
  // setup root with Untyped.tsx, no Props export
  // ...
  process.chdir(root)
  viewsScannerPlugin()
  const stub = fs.readFileSync(path.join(root, 'pages/__view/untyped/+Page.tsx'), 'utf8')
  assert.match(stub, /Record<string, unknown>/)
})
```

**Step 2: Run the test**

Run: `cd packages/vite && pnpm test`
Expected: FAIL.

**Step 3: Update `reactStub` to branch on `hasProps`**

```ts
function reactStub(view: DiscoveredView): StubFile {
  const propsImport = view.hasProps
    ? `import type { Props } from '${view.importPath}'\n`
    : ''
  const propsType = view.hasProps ? 'Props' : 'Record<string, unknown>'

  return {
    filename: '+Page.tsx',
    contents: `// AUTO-GENERATED by @rudderjs/vite — do not edit.
// Source: ${view.importPath}
import type { ReactNode } from 'react'
import ViewComponent from '${view.importPath}'
${propsImport}import { usePageContext } from 'vike-react/usePageContext'

const View = ViewComponent as unknown as (props: ${propsType}) => ReactNode

export default function Page() {
  const ctx = usePageContext() as unknown as { viewProps?: ${propsType} }
  const props = ctx.viewProps ?? ({} as ${propsType})
  return <View {...props} />
}
`,
  }
}
```

**Step 4: Run the test**

Run: `cd packages/vite && pnpm test`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/vite/src/views-scanner.ts packages/vite/src/views-scanner.test.ts
git commit -m "feat(vite): React +Page stub uses per-view Props type when exported"
```

---

### Task 3.2: Solid + Vue stubs follow the same pattern

**Files:**
- Modify: `packages/vite/src/views-scanner.ts` (`solidStub`, `vueStub`)
- Test: `packages/vite/src/views-scanner.test.ts`

Mirror the React pattern. Vue's `<script setup>` block uses `defineProps<Props>()` syntax — but the generated stub imports `Props` as a type and uses it in `usePageContext` casting; the underlying component handles its own `defineProps`. Vanilla deliberately skipped (function-arg typing already enforces shape at the call site through TypeScript inference).

Add one test each for solid and vue, modeled on the React tests. Commit:

```bash
git commit -m "feat(vite): Solid and Vue +Page stubs use per-view Props type"
```

---

## Phase 4 — Playground demonstration

### Task 4.1: TypedViewDemo

**Files:**
- Create: `playground/app/Views/Demos/TypedViewDemo.tsx`
- Modify: `playground/routes/web.ts`

**Step 1: Create the demo view**

```tsx
// playground/app/Views/Demos/TypedViewDemo.tsx
import type { ReactNode } from 'react'

export interface Props {
  user: { id: number; name: string }
  posts: Array<{ id: number; title: string }>
}

export default function TypedViewDemo({ user, posts }: Props): ReactNode {
  return (
    <main>
      <h1>Hello, {user.name}</h1>
      <ul>{posts.map(p => <li key={p.id}>{p.title}</li>)}</ul>
    </main>
  )
}
```

**Step 2: Wire the route**

```ts
// playground/routes/web.ts — add to the existing router definition
router.get('/demos/typed-view', () => view('demos.typed-view', {
  user:  { id: 1, name: 'Suleiman' },
  posts: [{ id: 1, title: 'Hello' }],
}))
```

**Step 3: Boot the playground and verify**

```bash
cd playground && pnpm dev
```

Open http://localhost:3000/demos/typed-view in a browser — page renders with the expected data.

**Step 4: Trigger a type error to confirm the safety net**

Temporarily change the route to pass a wrong prop:

```ts
router.get('/demos/typed-view', () => view('demos.typed-view', {
  user:  { id: 1 }, // ❌ name missing
  posts: [],
}))
```

Run: `cd playground && pnpm typecheck`
Expected: tsc errors pointing at the `view()` call site, citing missing `name`.

Revert the deliberate break.

**Step 5: Commit**

```bash
git add playground/app/Views/Demos/TypedViewDemo.tsx playground/routes/web.ts
git commit -m "feat(playground): typed view demo at /demos/typed-view"
```

---

### Task 4.2: Add demo card to /demos index

**Files:**
- Modify: `playground/app/Views/Demos/Index.tsx` (or wherever the demos hub lives — confirm path before editing)

Add a tile linking to `/demos/typed-view` matching the existing demo-card pattern.

Commit:

```bash
git commit -m "docs(playground): list typed-view demo on /demos hub"
```

---

## Phase 5 — Docs

### Task 5.1: Author the guide

**Files:**
- Create: `docs/guide/typed-views.md`
- Modify: `docs/.vitepress/config.ts` (sidebar)

Cover:

1. **The convention** — `export interface Props` in your view file is the only thing you do.
2. **What you get** — controller type-checking, intellisense on `pageContext.viewProps`, no codegen step to remember.
3. **Opt-in is per-view** — older views without `Props` keep working unchanged.
4. **Multi-framework support** — React, Solid, Vue. Note vanilla is intentionally excluded.
5. **How it works under the hood** — pointer to `pages/__view/registry.d.ts`, scanner regenerates on every scan, file is gitignored.
6. **Migration recipe** — for an existing view, add the `Props` export; that's it.
7. **Comparison snippet** — short note that this is RudderJS's equivalent of Inertia's prop typing / Nuxt's typed `useFetch`, but with zero generator step.

**Step 1: Write the page**

(Skip full contents here — follow `docs/guide/service-providers.md` as a stylistic template.)

**Step 2: Sidebar entry**

Add `{ text: 'Typed Views', link: '/guide/typed-views' }` near the existing Views entry in `docs/.vitepress/config.ts`.

**Step 3: Build the docs locally**

```bash
cd docs && pnpm build
```

Expected: no broken-link warnings.

**Step 4: Commit**

```bash
git add docs/guide/typed-views.md docs/.vitepress/config.ts
git commit -m "docs: typed views guide"
```

---

### Task 5.2: Update README + CLAUDE.md feature list

**Files:**
- Modify: `README.md` (the "Built-in" features showcase)
- Modify: `CLAUDE.md` ("Controller Views" section)

`README.md` already showcases 13 framework features; the typed-view DX is a natural #14 candidate **only if approved** — per memory, the README showcase is frozen. Skip the README update unless explicitly authorized. Update `CLAUDE.md`'s Controller Views section to mention the typed `view<Props>()` convention.

Commit:

```bash
git commit -m "docs: note typed view() convention in CLAUDE.md"
```

---

## Phase 6 — Changeset + verification

### Task 6.1: Changeset

**Files:**
- Create: `.changeset/typed-view-props.md`

```markdown
---
'@rudderjs/view': minor
'@rudderjs/vite': minor
---

Typed views: `view('id', props)` now type-checks against the receiving component's exported `Props` type. Opt in by exporting `interface Props` in any view file; the views scanner picks it up on the next sync and emits `pages/__view/registry.d.ts` to wire the registry. Apps that don't adopt the convention keep working unchanged.
```

**Step 1: Commit**

```bash
git add .changeset/typed-view-props.md
git commit -m "chore: changeset for typed view props"
```

---

### Task 6.2: Full verification before pushing

Run, in order:

```bash
pnpm build                              # all packages compile
pnpm typecheck                          # whole workspace typechecks
pnpm --filter @rudderjs/view test       # view package tests
pnpm --filter @rudderjs/vite test       # scanner tests including new ones
cd playground && pnpm typecheck         # playground typechecks against the new registry.d.ts
cd playground && pnpm build && pnpm dev # boot test — http://localhost:3000/demos/typed-view loads
```

If anything fails, fix before push. Per the `feedback_verify_before_push` memory rule, all four checks must pass locally.

---

### Task 6.3: Push and open the PR

```bash
git push -u origin <branch-name>
gh pr create --title "feat(view, vite): typed view() with opt-in Props registry" --body "$(cat <<'EOF'
## Summary
- `view('id', props)` now type-checks against the receiving component's exported `Props` type.
- Opt in per-view by adding `export interface Props` — scanner picks it up, emits `pages/__view/registry.d.ts`, and the registry augmentation propagates through TypeScript.
- Apps that don't adopt the convention keep working unchanged — no migration required.

## Test plan
- [ ] `pnpm typecheck` passes across the workspace
- [ ] `pnpm --filter @rudderjs/view test` passes (including new `typed-view.test-d.ts`)
- [ ] `pnpm --filter @rudderjs/vite test` passes (including new scanner tests)
- [ ] `playground/` boots; `/demos/typed-view` renders
- [ ] Deliberate mismatched prop in `playground/routes/web.ts` surfaces a tsc error at the `view()` call site
EOF
)"
```

---

## Deferred follow-ups (out of scope for v1)

- **Vanilla view typing.** Vanilla views are HTML-string functions and already take typed args; revisit only if there's a real ergonomics gap.
- **`pnpm rudder view:sync` CLI command.** Gemini's suggestion from the brainstorm. The watcher handles this in dev; a CLI surface would help only for CI workflows that build before booting Vite. Defer until requested.
- **Storybook prop fixtures.** A future codegen pass could emit `*.fixtures.ts` from each view's `Props` for design-system tooling. Out of scope.
- **`view.lazy()` / route-level view import for code splitting.** Orthogonal to typing.

## Risks / open questions

- **Empty `export interface Props {}` would compile** but yields the empty-object type. Documented as a developer choice; not worth enforcing.
- **Vue SFC type extraction is regex-only.** If a Vue author writes their type inline (`defineProps<{ x: string }>()`) instead of `export interface Props`, the registry skips them. Documented in the guide.
- **`exactOptionalPropertyTypes: true`** in the base tsconfig may make some test fixtures slightly stricter than expected; the typed-view `@ts-expect-error` cases assume this flag is on (which it is, per `tsconfig.base.json`).

## Related work

- `docs/plans/2026-05-12-vike-dx-integration.md` — landed the Vike framework hooks this plan builds on (`+onCreatePageContext`, `+onError`, `+headersResponse`). The two plans share no files but the augmentation pattern here mirrors the one used there.
