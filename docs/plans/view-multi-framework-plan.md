---
status: draft
created: 2026-04-11
references:
  - controller-views-plan.md
---

# Plan: Multi-framework support for `@rudderjs/view`

## Current state (v1, shipped 2026-04-11)

`@rudderjs/view` works with **React only**. The coupling is concentrated in one file — `packages/vite/src/views-scanner.ts` — in two places:

1. `const VIEW_EXTENSIONS = ['.tsx', '.jsx']` — only JSX files are discovered.
2. The stub generator in `pageFileSource()` hardcodes `import { usePageContext } from 'vike-react/usePageContext'`.

Everything downstream of the scanner (`@rudderjs/view`, `@rudderjs/server-hono` ViewResponse detection, Vike's `renderPage()`) is already framework-agnostic. This plan is entirely about making the scanner polymorphic.

---

## Goal

Make the table of supported frameworks look like this:

| Framework | Status |
|---|---|
| **React** (vike-react) | ✅ shipped in v1 |
| **Vue** (vike-vue) | 🎯 Phase 1 |
| **Solid** (vike-solid) | 🎯 Phase 1 |
| **Vanilla / no-framework** | 🎯 Phase 2 (the "Blade equivalent") |

Vanilla is deliberately Phase 2 because it has a different contract from the other three (no hydration, returns HTML strings, no `usePageContext()` hook) — it's worth landing the three SPA frameworks first as one homogeneous batch, then tackling vanilla as its own thing.

---

## Design decisions

### How does the scanner know which framework the project uses?

**Option A — Auto-detect by peer dependency.** At plugin construction time, look at the user's `package.json` (or `node_modules`) and check which `vike-react` / `vike-vue` / `vike-solid` is installed. Generate stubs for that framework. Single-framework assumption.

**Option B — Per-file detection by extension.** `.tsx`/`.jsx` → React, `.vue` → Vue, `.ts`/`.js` returning a string → vanilla. Mixed file types in one `app/Views/` folder would all work. But mixing React and Vue components in one Vike app isn't supported by Vike itself (one app = one framework), so cross-framework mixing doesn't actually work downstream even if we detect it.

**Option C — Explicit config.** `viewsScannerPlugin({ framework: 'react' })` in `@rudderjs/vite`. No magic.

**Recommendation: Option A (auto-detect by peer dep) with Option C as an escape hatch.**

```ts
// packages/vite/src/index.ts
rudderjs()                                // auto-detects — covers 99% of projects
rudderjs({ view: { framework: 'vue' } })  // explicit override when auto-detect is wrong
```

Auto-detect is what every project wants. Explicit is for projects with weird setups (multiple vike-* installed at once for testing, or a monorepo where peer resolution points at the wrong place).

### Do we support mixing frameworks in one app?

**No.** Vike itself is single-framework per app — you pick `vike-react` OR `vike-vue` OR `vike-solid` in `pages/+config.ts`. Mixing JSX and Vue components in one Vike app doesn't work at the Vike level, so we inherit that constraint. The scanner throws a clear error if it finds `.tsx` AND `.vue` files in the same `app/Views/**` tree.

**Vanilla is special** — vanilla views render to HTML strings and need no framework runtime, so `app/Views/AdminReport.ts` (vanilla) CAN coexist with `app/Views/Dashboard.tsx` (React) in a React project. The scanner can detect vanilla views by return type (a function returning `string` is vanilla; a function returning JSX is React). Vanilla views sit alongside framework views; they just don't hydrate.

### Per-framework stub templates

The scanner today has one function `pageFileSource(view)` that returns a hardcoded React stub. Replace with a lookup table keyed on framework:

```ts
const STUB_GENERATORS: Record<Framework, (view: DiscoveredView) => StubFile[]> = {
  react:   generateReactStub,
  vue:     generateVueStub,
  solid:   generateSolidStub,
  vanilla: generateVanillaStub,
}
```

Each generator returns a list of files to write (some frameworks need just `+Page.tsx`, Vue needs `+Page.vue` AND maybe an `+onRenderHtml.ts`, etc).

---

## Phase 1: Vue + Solid

Both slot into the existing SPA-nav pipeline unchanged — they have their own `vike-{vue,solid}/usePageContext` hooks that expose `pageContext.viewProps` the same way `vike-react` does. So the only work is the stub generator.

### 1.1 Auto-detect framework

Add to `packages/vite/src/views-scanner.ts`:

```ts
type Framework = 'react' | 'vue' | 'solid' | 'vanilla'

function detectFramework(): Framework {
  // Check the app-root's node_modules, not packages/vite's
  const _require = createRequire(process.cwd() + '/package.json')
  try { _require.resolve('vike-react'); return 'react' } catch {}
  try { _require.resolve('vike-vue');   return 'vue'   } catch {}
  try { _require.resolve('vike-solid'); return 'solid' } catch {}
  // Fall back to vanilla — no framework installed, user must ship HTML-string views
  return 'vanilla'
}
```

Runs once at plugin construction time. Result is cached on the plugin instance.

### 1.2 File extension registry

```ts
const EXTENSIONS_BY_FRAMEWORK: Record<Framework, string[]> = {
  react:   ['.tsx', '.jsx'],
  vue:     ['.vue'],
  solid:   ['.tsx', '.jsx'],
  vanilla: ['.ts',  '.js'],
}
```

`discover()` uses the detected framework's extensions instead of the current hardcoded list.

### 1.3 Vue stub generator

```vue
<!-- pages/__view/home/+Page.vue — generated -->
<script setup lang="ts">
import ViewComponent from 'App/Views/Home.vue'
import { usePageContext } from 'vike-vue/usePageContext'
const pageContext = usePageContext()
const viewProps = (pageContext as { viewProps?: Record<string, unknown> }).viewProps ?? {}
</script>
<template>
  <ViewComponent v-bind="viewProps" />
</template>
```

Note the file extension changes to `.vue` for the generated stub — Vike distinguishes the page implementation by the `+Page.*` extension.

### 1.4 Solid stub generator

Almost identical to React, different import path:

```tsx
// pages/__view/home/+Page.tsx — generated for Solid
import ViewComponent from 'App/Views/Home.tsx'
import { usePageContext } from 'vike-solid/usePageContext'

export default function Page() {
  const ctx = usePageContext() as { viewProps?: Record<string, unknown> }
  return <ViewComponent {...(ctx.viewProps ?? {})} />
}
```

Solid's JSX is compiled differently from React's, but the stub template is the same — the `.tsx` file runs through whichever JSX transform the Vite project has configured, same as every other Vike page.

### 1.5 Playground verification

v1 shipped with a React playground demo (`playground/app/Views/{Home,About}.tsx`). For Phase 1, we don't need to add Vue/Solid playgrounds — but we should manually verify with a throwaway project:

```bash
pnpm create rudder-app vue-test --framework vue
cd vue-test
# manually add app/Views/Home.vue + a view() route
pnpm dev
# visit /home, verify SSR + hydration + SPA nav
```

Same for Solid. No need to commit these test projects — they're a one-time "does it actually work" check.

### 1.6 Shared + data/config files

The generated `+config.ts` (`passToClient: ['viewProps']`) and `+data.ts` (no-op stub for SPA fetch trigger) are framework-agnostic TypeScript files. No changes needed.

### 1.7 Scope cut for Phase 1

- Auto-detect only. No explicit `framework` config option yet (add in Phase 3 if users actually need it).
- No mixed-framework detection — if the scanner finds incompatible file types, it throws a clear error.
- No playground demos for Vue/Solid — manual throwaway verification only.
- React regression test: the existing playground SPA nav tests must keep passing unchanged.

**Estimated surface**: ~80 LOC added to `views-scanner.ts`, no changes to `@rudderjs/view` or `@rudderjs/server-hono`.

---

## Phase 2: Vanilla / no-framework mode (the Blade equivalent)

This is the one that's genuinely different — and the most interesting feature in this whole plan.

### 2.1 The contract

User writes a TypeScript file that exports a function returning an HTML string:

```ts
// app/Views/AdminReport.ts
interface AdminReportProps {
  title: string
  rows: { name: string; total: number }[]
}

export default function AdminReport({ title, rows }: AdminReportProps): string {
  return `
    <div class="mx-auto max-w-4xl p-8">
      <h1 class="text-3xl font-bold">${escapeHtml(title)}</h1>
      <table class="w-full border-collapse">
        ${rows.map(row => `
          <tr>
            <td class="border p-2">${escapeHtml(row.name)}</td>
            <td class="border p-2 text-right">${row.total}</td>
          </tr>
        `).join('')}
      </table>
    </div>
  `
}
```

Called from a controller exactly like any other view:

```ts
Route.get('/admin/report', async () => {
  const rows = await Orders.groupBy('customer').select('name', sum('total'))
  return view('admin.report', { title: 'Monthly Report', rows })
})
```

### 2.2 What you DON'T get

- No React/Vue runtime shipped to the client
- No hydration — the HTML is static
- No `useState`, `useEffect`, event handlers
- No SPA navigation *to* these pages from JSX pages (they'd do full reloads, because there's no client framework to hydrate into)

### 2.3 What you DO get

- **Zero JavaScript on the client** for these pages — pure HTML + CSS
- Same controller ergonomics — middleware, DI, ORM, form validation, all run before the view
- Full Vike SSR pipeline — layouts, `+config.ts`, `+data.ts`, all work
- Tiny payloads — perfect for email bodies, PDF generation, webhook HTML responses, admin reports, marketing landing pages, printable invoices
- Controller-driven — the user's view function is called with props; same mental model as every other view

**This is the real Blade equivalent** — Laravel's Blade is server-rendered HTML that doesn't ship framework JS, and that's exactly what this does.

### 2.4 Stub generator

```ts
// pages/__view/admin/report/+Page.ts — generated for vanilla
import renderView from 'App/Views/Admin/Report.ts'
import type { PageContext } from 'vike/types'

export function Page(pageContext: PageContext): string {
  const viewProps = (pageContext as { viewProps?: Record<string, unknown> }).viewProps ?? {}
  return renderView(viewProps as never)
}
```

Vike's vanilla mode looks for a `Page` named export that returns a string (or a DOM element). We use the string form.

### 2.5 The mixing question

Can a React project have `app/Views/Dashboard.tsx` AND `app/Views/AdminReport.ts` simultaneously? **Yes.** The scanner detects the framework for the project as a whole (React), but allows vanilla `.ts` view files to coexist. The stub generator generates a React stub for `.tsx` files and a vanilla stub for `.ts` files. Both resolve through the same `view('id', props)` call.

This gives users a graceful opt-out: "most of my views are React, but this one admin report is pure HTML because I don't want to ship 40KB of React to render a table."

Vike supports this natively — you can have `+Page.tsx` and `+Page.ts` files in the same pages tree. We just mirror that into our generated stubs.

### 2.6 Security — HTML escaping

Vanilla views take raw string interpolation, which means **XSS risk is on the user**. We should ship a tiny `escapeHtml()` helper in `@rudderjs/view` that users can import:

```ts
// @rudderjs/view exports
export function escapeHtml(s: unknown): string {
  if (s == null) return ''
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
```

Document prominently in the README that **all interpolated strings in vanilla views MUST be escaped** — unlike JSX, which auto-escapes. This is the same footgun Blade has and is worth highlighting.

**Optional follow-up (Phase 3 territory)**: ship a tagged template literal `html\`\`` that auto-escapes interpolations:

```ts
import { html } from '@rudderjs/view'

export default function AdminReport({ title, rows }: AdminReportProps) {
  return html`
    <h1>${title}</h1>
    ${rows.map(r => html`<tr><td>${r.name}</td></tr>`)}
  `
}
```

This gives you Blade/EJS ergonomics with automatic XSS protection. Defer to Phase 3 — Phase 2 ships with manual `escapeHtml()` first.

### 2.7 Phase 2 scope

- Vanilla stub generator
- `escapeHtml()` helper exported from `@rudderjs/view`
- Scanner detects `.ts`/`.js` files alongside framework files; generates the right stub type per file
- README section documenting vanilla mode with a concrete example (admin report or email template)
- Manual verification with a throwaway project

**Estimated surface**: ~40 LOC (scanner branch + 10-line helper + 20-line stub template).

---

## Phase 3: Polish (nice-to-haves, not blocking)

Not in scope for the initial multi-framework work, but worth capturing so they don't get lost:

1. **Explicit `framework` config option** on `rudderjs()` — for projects where auto-detect gives the wrong answer
2. **`html\`\`` tagged template literal** with auto-escaping (the Blade/EJS ergonomic story for vanilla)
3. **Svelte support** via `vike-svelte` (community package — works the same as Vue/Solid, add if users ask)
4. **Per-view framework override** — `view('admin.report', props, { framework: 'vanilla' })` — probably not needed, since file extension already disambiguates
5. **Build-time XSS lint rule** that flags unescaped interpolations in vanilla view files

---

## Migration impact

**None.** v1 projects using React keep working unchanged. The auto-detect logic returns `'react'` when `vike-react` is installed, which matches v1's behavior exactly. No breaking changes, no scaffolder updates needed, no existing stubs get regenerated with different content.

The `@rudderjs/view` package and `@rudderjs/server-hono` integration are entirely unchanged — all the work is isolated to the scanner in `@rudderjs/vite`.

---

## Success criteria

- A Vue project using `vike-vue` can ship `app/Views/Dashboard.vue` and render it via `view('dashboard', props)` with full SSR + SPA navigation
- Same for Solid with `.tsx` files and `vike-solid`
- A React project can ship a vanilla view file `app/Views/AdminReport.ts` alongside its React views, and both work — React views hydrate, vanilla views render as static HTML with zero client JS
- The v1 React regression tests (the 4-way SPA navigation playwright tests) still pass unchanged
- README documents all four modes with concrete examples
- No breaking changes for existing React projects

---

## When to tackle this

**Not urgent.** v1 is proven and covers the most common case. Reasons to prioritize:

- A user explicitly asks for Vue/Solid (probably auth migration stakeholder?)
- Starting a Vue-based demo project and needing dogfood
- Wanting the "Blade equivalent" (vanilla mode) for a specific use case like HTML emails or admin reports

Reasons to defer:
- v1 needs real usage feedback first — maybe the multi-framework API should look different after we see how people actually use `view()`
- The auth migration (`auth-views-migration-plan.md`) is a higher-value next step because it touches more surface area and proves the "packages ship views" pattern

Suggested order: **auth migration first, then multi-framework.** The auth migration will surface constraints the multi-framework work needs to respect (e.g., how do packages declare "my views work in React only"?), so doing it first de-risks the scanner changes.
