/**
 * app/Views scanner — generates virtual Vike pages for files in `app/Views/**`.
 *
 * For a React project `app/Views/Dashboard.tsx` we emit:
 *
 *   pages/__view/dashboard/+Page.tsx     → re-exports user's view + reads viewProps from pageContext
 *   pages/__view/dashboard/+route.ts     → pins the route to /dashboard
 *   pages/__view/dashboard/+data.ts      → no-op; forces Vike client router to fetch pageContext
 *
 * The generated `pages/__view/` directory is gitignored. The plugin watches
 * `app/Views/**` and regenerates on add/remove/rename.
 *
 * Framework selection is automatic — the scanner resolves `vike-react`,
 * `vike-react-rsc-rudder` (or the legacy `vike-react-rsc` name), `vike-vue`,
 * or `vike-solid` from the project's node_modules at plugin construction time.
 * If none are installed, the scanner falls back to **vanilla mode** (the "Blade
 * equivalent"): `.ts`/`.js` views that export a function returning an HTML
 * string, no client hydration.
 *
 * `react-rsc` (React Server Components via `vike-react-rsc-rudder`) is a React-only
 * renderer variant: same `.tsx` views, but the generated page is a server
 * component that reads pageContext via `getPageContext()` (synchronous,
 * AsyncLocalStorage-backed) instead of the `usePageContext()` client hook.
 * It is mutually exclusive with `vike-react` — both are React renderers.
 * The RSC variant also pins the route via an inlined `route` value in a
 * per-view `+config.ts` instead of a separate `+route.ts` module — see
 * `rscViewConfigSource` for why a module would break under RSC.
 */

import fs from 'node:fs'
import path from 'node:path'
import type { Plugin } from 'vite'

type Framework = 'react' | 'react-rsc' | 'vue' | 'solid' | 'vanilla'

interface DiscoveredView {
  /** Dot-notation id, e.g. `'dashboard'` or `'users.show'` */
  id:          string
  /** Absolute path to the user's view file */
  absPath:     string
  /** Path relative to the playground root, with `App/` prefix for the alias */
  importPath:  string
  /** Output directory for the generated Vike page (absolute) */
  outDir:      string
  /**
   * Public URL where this view should be served. Defaults to the id-derived
   * path (`'auth.login'` → `/auth/login`). Overridden by `export const route`
   * in the view file so controllers can use pretty URLs like `/login` while
   * keeping the file at `app/Views/Auth/Login.tsx`.
   *
   * CRITICAL for SPA nav: the Vike client route table is built from the
   * generated `+route.ts` files. If the URL here doesn't match the URL the
   * browser actually visits, client nav falls back to full reloads.
   */
  url:         string
  /**
   * True when the view source exports a `Props` interface or type alias.
   * Drives both the registry.d.ts emission and the per-framework +Page stub
   * type. Detected by regex (same approach as `readRouteOverride`); a typed
   * but unconventionally-named Props export is intentionally not picked up —
   * the `export interface Props` / `export type Props` convention is the
   * contract authors are documented against.
   */
  hasProps:    boolean
  /**
   * Build-time prerender mode for this view.
   *
   * - `'off'`     — no `export const prerender` (or `= false`). Default.
   * - `'static'`  — `export const prerender = true`. Scanner emits a single
   *                 `+prerender.ts` next to the generated `+Page.*` and Vike
   *                 writes one pre-rendered HTML for this view's URL.
   * - `'dynamic'` — `export const prerender = [...]` or `() => [...]`. The
   *                 view's URL is parameterized (`/blog/@slug`); the user's
   *                 export enumerates the URLs to render. Scanner emits both
   *                 a `+prerender.ts` AND a `+onBeforePrerenderStart.ts` that
   *                 re-exports the user's symbol as Vike's hook.
   *
   * Build-time only either way — dev always SSRs.
   */
  prerender:   'off' | 'static' | 'dynamic'
}

interface StubFile {
  filename: string
  contents: string
}

// ─── Framework detection ───────────────────────────────────

/**
 * Resolve which UI framework the project uses by probing `vike-*` packages
 * in the app-root's node_modules. Runs once at plugin construction.
 *
 * Uses a direct fs check rather than `require.resolve` to avoid Node's
 * module resolution cache (which can return stale hits in tests and when
 * dependencies are swapped without a process restart).
 */
function detectFramework(cwd: string): Framework {
  const nodeModules = path.join(cwd, 'node_modules')
  const installed: Framework[] = []
  for (const [pkg, fw] of [
    ['vike-react',            'react'],
    ['vike-react-rsc-rudder', 'react-rsc'],
    ['vike-react-rsc',        'react-rsc'],
    ['vike-vue',              'vue'],
    ['vike-solid',            'solid'],
  ] as const) {
    // Dedupe: our `vike-react-rsc-rudder` fork and the legacy upstream
    // `vike-react-rsc` both map to `react-rsc` — having both on disk is the
    // *same* renderer, not a conflict, so it must not trip the guard below.
    if (fs.existsSync(path.join(nodeModules, pkg, 'package.json')) && !installed.includes(fw)) {
      installed.push(fw)
    }
  }

  if (installed.length > 1) {
    throw new Error(
      `[rudderjs:views-scanner] Multiple Vike renderers found (${installed.join(', ')}). ` +
      `Install only one of vike-react, vike-react-rsc-rudder, vike-vue, vike-solid ` +
      `(vike-react and vike-react-rsc-rudder are both React renderers — pick one).`,
    )
  }
  return installed[0] ?? 'vanilla'
}

/** RSC renderer package names — our fork (preferred) first, then legacy upstream. */
const RSC_PACKAGES = ['vike-react-rsc-rudder', 'vike-react-rsc'] as const

/**
 * Resolve which RSC renderer package is installed so generated page stubs
 * import from the real specifier. Prefers our `vike-react-rsc-rudder` fork,
 * falls back to the legacy upstream `vike-react-rsc`, and defaults to the fork
 * name when neither is on disk (only reachable once detection already said
 * `react-rsc`, so the fallback never produces a broken import in practice).
 */
function rscPackageName(cwd: string): string {
  const nodeModules = path.join(cwd, 'node_modules')
  for (const pkg of RSC_PACKAGES) {
    if (fs.existsSync(path.join(nodeModules, pkg, 'package.json'))) return pkg
  }
  return RSC_PACKAGES[0]
}

// ─── Extensions per framework ──────────────────────────────

const EXTENSIONS_BY_FRAMEWORK: Record<Framework, string[]> = {
  react:       ['.tsx', '.jsx'],
  'react-rsc': ['.tsx', '.jsx'],
  vue:         ['.vue'],
  solid:       ['.tsx', '.jsx'],
  vanilla:     ['.ts',  '.js'],
}

// ─── Id / path helpers ─────────────────────────────────────

function stripExt(file: string): string {
  return file.replace(/\.(tsx|jsx|vue|ts|js)$/i, '')
}

/** Convert `Dashboard.tsx` → `dashboard`, `Users/Show.tsx` → `users.show` */
function fileToId(relPath: string): string {
  return stripExt(relPath)
    .split(path.sep)
    .map(seg => seg.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase())
    .join('.')
}

function walk(dir: string, extensions: string[], base = dir): string[] {
  if (!fs.existsSync(dir)) return []
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...walk(full, extensions, base))
    } else if (extensions.some(e => entry.name.toLowerCase().endsWith(e))) {
      out.push(path.relative(base, full))
    }
  }
  return out
}

/**
 * Scan the view source for an optional `export const route = '...'` or
 * `export const route = "..."` declaration and return its value. Matches
 * TypeScript, JavaScript, and the <script setup> block inside a .vue file.
 *
 * Regex-based on purpose — parsing TS ASTs here would be overkill and
 * introduce a dep. The pattern is strict enough that false positives require
 * deliberate obfuscation.
 */
// Anchored at start-of-line (via the `m` flag's `^`) so a commented-out
// override (`// export const route = '/old-path'`) doesn't get picked up as
// the active route — the `[\s;]` alternative used to match the space after
// `//`, silently swapping the view's URL to the stale value. Vue dual-script
// blocks place their `export` at the start of a line within the `<script>`
// block, so this still picks them up. Same fix shape as PRERENDER_DECL_RE.
const ROUTE_EXPORT_RE = /^export\s+const\s+route\s*(?::\s*string)?\s*=\s*['"`]([^'"`]+)['"`]/m

/**
 * Read the `export const route = '...'` override from a view file, if any.
 *
 * Returns `null` on read failure (missing file, permission error, encoding
 * issue) so callers fall back to the id-derived URL. This swallow is
 * intentional: a transient read error during dev rescans should not crash
 * the scanner — the next `change` event from the watcher will retry. Real
 * authoring mistakes (typo in the export, wrong quote style) silently fall
 * through to the convention URL, which is the same behavior as "no override
 * present" — surfaces as a mismatched URL the developer can see.
 */
function readRouteOverride(absPath: string): string | null {
  try {
    const source = fs.readFileSync(absPath, 'utf8')
    const m = source.match(ROUTE_EXPORT_RE)
    return m ? m[1] ?? null : null
  } catch {
    return null
  }
}

/**
 * Detect `export interface Props` / `export type Props` in a view source.
 *
 * Mirrors the regex-only approach used for `ROUTE_EXPORT_RE` — parsing a TS
 * AST would require ts-morph and yield no benefit; the scanner only needs to
 * know *whether* a Props export exists. TypeScript later resolves the actual
 * shape via the generated `import('...').Props` in `registry.d.ts`.
 *
 * Multiline-tolerant (Vue SFCs have the export inside a `<script>` block;
 * the surrounding `<script>` tags don't interfere because the regex anchors
 * at start-of-line via the `m` flag's `^` — Vue's `export` sits at column
 * zero within the `<script>` block).
 *
 * Anchored at `^` so a commented-out reference declaration
 * (`// export interface Props { x: number }`) doesn't fool the scanner into
 * emitting a `registry.d.ts` entry that imports a non-existent type. Same
 * fix shape as PRERENDER_DECL_RE.
 */
const PROPS_EXPORT_RE = /^export\s+(?:interface|type)\s+Props\b/m

function readHasPropsExport(absPath: string): boolean {
  try {
    return PROPS_EXPORT_RE.test(fs.readFileSync(absPath, 'utf8'))
  } catch {
    return false
  }
}

/**
 * Detect the `export const prerender = …` declaration and capture everything
 * after the identifier on the same line. Two-pass so type annotations like
 * `: () => Promise<string[]>` (whose `=>` arrow contains a literal `=` that
 * a single-regex match would interpret as the assignment operator) parse
 * correctly.
 *
 * Anchored at start-of-line (via the `m` flag's `^`) so the literal characters
 * `export const prerender = [...]` appearing inside a string elsewhere in the
 * file (e.g. a documentation snippet on a /demos card) don't false-positive
 * as the actual top-level export. Top-level exports in TS/JS are at the start
 * of a logical line; Vue dual-script blocks place their `export` at the start
 * of a line within the `<script>` block too, so this still picks them up.
 *
 * A multi-line type annotation or RHS isn't supported — the assumption is that
 * the export declaration fits on one line, matching real-world author style.
 */
const PRERENDER_DECL_RE = /^export\s+const\s+prerender\b([^\n]*)/m

/** Static opt-in: `= true` (with or without `: boolean` annotation). */
const PRERENDER_STATIC_RHS_RE = /=\s*true\b/

/**
 * Dynamic opt-in: RHS starts with an array literal, a paren (arrow function
 * or call expression), or a `function` / `async function` keyword. The `=` is
 * required before each alternative so trailing `(`s in type annotations
 * (e.g. `() => Promise<string[]>`) don't false-positive as the value.
 *
 * Variable-reference RHS (`= MY_LIST` or `= MY_LIST.slice()`) is intentionally
 * not picked up — opt-in is explicit; users wrap in a function or inline.
 */
const PRERENDER_DYNAMIC_RHS_RE = /=\s*(?:\[|\(|async\s+\(|async\s+function\b|function\b)/

function readPrerenderOpt(absPath: string): 'off' | 'static' | 'dynamic' {
  try {
    const text = fs.readFileSync(absPath, 'utf8')
    const m = text.match(PRERENDER_DECL_RE)
    if (!m) return 'off'
    const rest = m[1] ?? ''
    if (PRERENDER_STATIC_RHS_RE.test(rest))  return 'static'
    if (PRERENDER_DYNAMIC_RHS_RE.test(rest)) return 'dynamic'
    return 'off'
  } catch {
    return 'off'
  }
}

function discover(viewsRoot: string, pagesRoot: string, framework: Framework): DiscoveredView[] {
  const exts = EXTENSIONS_BY_FRAMEWORK[framework]
  return walk(viewsRoot, exts).map(rel => {
    const id      = fileToId(rel)
    const absPath = path.join(viewsRoot, rel)
    // Use the App/ alias (already configured in @rudderjs/vite) so the
    // generated import is portable across machines.
    const importPath = `App/Views/${rel.replace(/\\/g, '/')}`
    const outDir     = path.join(pagesRoot, '__view', ...id.split('.'))
    const url        = readRouteOverride(absPath) ?? '/' + id.replace(/\./g, '/')
    const hasProps   = readHasPropsExport(absPath)
    const prerender  = readPrerenderOpt(absPath)
    return { id, absPath, importPath, outDir, url, hasProps, prerender }
  })
}

// ─── Stub generators ───────────────────────────────────────

function reactStub(view: DiscoveredView): StubFile {
  // When the view source exports `Props`, use it as the prop shape so that
  // intellisense inside the stub (and any downstream type-aware tooling) sees
  // the real prop names — not an opaque `Record<string, unknown>`. The cast
  // pattern stays the same; only the type widens or narrows.
  //
  // The fallback initialiser only needs an `as Props` cast when `propsType`
  // is a real shape with required fields. `{}` is already assignable to
  // `Record<string, unknown>`, so the untyped branch keeps the original
  // byte sequence — avoids churn in checked-in stubs for views that haven't
  // adopted the convention yet.
  const propsImport   = view.hasProps ? `import type { Props } from '${view.importPath}'\n` : ''
  const propsType     = view.hasProps ? 'Props' : 'Record<string, unknown>'
  const propsFallback = view.hasProps ? `({} as ${propsType})` : '{}'

  return {
    filename: '+Page.tsx',
    contents: `// AUTO-GENERATED by @rudderjs/vite — do not edit.
// Source: ${view.importPath}
import type { ReactNode } from 'react'
import ViewComponent from '${view.importPath}'
${propsImport}import { usePageContext } from 'vike-react/usePageContext'

// Cast to a permissive component type — controller-supplied props are validated
// at the call site (view('id', props)), not in this generated stub.
const View = ViewComponent as unknown as (props: ${propsType}) => ReactNode

export default function Page() {
  const ctx = usePageContext() as unknown as { viewProps?: ${propsType} }
  const props = ctx.viewProps ?? ${propsFallback}
  return <View {...props} />
}
`,
  }
}

function reactRscStub(view: DiscoveredView, pkgName: string = RSC_PACKAGES[0]): StubFile {
  // Identical to reactStub, with one difference: the generated +Page is a
  // React Server Component (no `"use client"`), so it cannot call the
  // `usePageContext()` hook — that throws under the `react-server` condition.
  // RSC reads pageContext via `getPageContext()` (synchronous, backed by an
  // AsyncLocalStorage store) from `<rsc-pkg>/pageContext`. The controller
  // still injects `viewProps` via `pageContextInit`, so `view('id', props)`
  // keeps working; the server component may also fetch its own data.
  //
  // `pkgName` is the actually-installed RSC renderer (our fork or the legacy
  // upstream name) so the import resolves against the consumer's node_modules
  // either way.
  const propsImport   = view.hasProps ? `import type { Props } from '${view.importPath}'\n` : ''
  const propsType     = view.hasProps ? 'Props' : 'Record<string, unknown>'
  const propsFallback = view.hasProps ? `({} as ${propsType})` : '{}'

  return {
    filename: '+Page.tsx',
    contents: `// AUTO-GENERATED by @rudderjs/vite — do not edit.
// Source: ${view.importPath}
import type { ReactNode } from 'react'
import ViewComponent from '${view.importPath}'
${propsImport}import { getPageContext } from '${pkgName}/pageContext'

// Cast to a permissive component type — controller-supplied props are validated
// at the call site (view('id', props)), not in this generated stub.
const View = ViewComponent as unknown as (props: ${propsType}) => ReactNode

export default function Page() {
  const ctx = getPageContext() as unknown as { viewProps?: ${propsType} }
  const props = ctx.viewProps ?? ${propsFallback}
  return <View {...props} />
}
`,
  }
}

function solidStub(view: DiscoveredView): StubFile {
  const propsImport   = view.hasProps ? `import type { Props } from '${view.importPath}'\n` : ''
  const propsType     = view.hasProps ? 'Props' : 'Record<string, unknown>'
  const propsFallback = view.hasProps ? `({} as ${propsType})` : '{}'

  return {
    filename: '+Page.tsx',
    contents: `// AUTO-GENERATED by @rudderjs/vite — do not edit.
// Source: ${view.importPath}
import ViewComponent from '${view.importPath}'
${propsImport}import { usePageContext } from 'vike-solid/usePageContext'

const View = ViewComponent as unknown as (props: ${propsType}) => JSX.Element

export default function Page() {
  const ctx = usePageContext() as unknown as { viewProps?: ${propsType} }
  return <View {...(ctx.viewProps ?? ${propsFallback})} />
}
`,
  }
}

function vueStub(view: DiscoveredView): StubFile {
  // Vue SFCs cannot put `export` statements inside <script setup>, so the
  // type-import goes in a regular <script lang="ts"> block. The Props type
  // is sourced from the user's view file, which itself defines Props in a
  // regular <script> block (the same convention required for the
  // export-const-route override).
  //
  // No-Props branch keeps the original byte sequence (no explicit
  // `viewProps:` annotation, plain `{}` fallback) so unchanged views stay
  // unchanged on disk.
  if (!view.hasProps) {
    return {
      filename: '+Page.vue',
      contents: `<!-- AUTO-GENERATED by @rudderjs/vite — do not edit. -->
<!-- Source: ${view.importPath} -->
<script setup lang="ts">
import ViewComponent from '${view.importPath}'
import { usePageContext } from 'vike-vue/usePageContext'

const pageContext = usePageContext()
const viewProps = (pageContext as { viewProps?: Record<string, unknown> }).viewProps ?? {}
</script>
<template>
  <ViewComponent v-bind="viewProps" />
</template>
`,
    }
  }

  return {
    filename: '+Page.vue',
    contents: `<!-- AUTO-GENERATED by @rudderjs/vite — do not edit. -->
<!-- Source: ${view.importPath} -->
<script setup lang="ts">
import ViewComponent from '${view.importPath}'
import type { Props } from '${view.importPath}'
import { usePageContext } from 'vike-vue/usePageContext'

const pageContext = usePageContext()
const viewProps: Props = (pageContext as { viewProps?: Props }).viewProps ?? ({} as Props)
</script>
<template>
  <ViewComponent v-bind="viewProps" />
</template>
`,
  }
}

function vanillaStub(view: DiscoveredView): StubFile {
  return {
    filename: '+Page.ts',
    contents: `// AUTO-GENERATED by @rudderjs/vite — do not edit.
// Source: ${view.importPath}
import renderView from '${view.importPath}'
import type { PageContext } from 'vike/types'

export function Page(pageContext: PageContext): string {
  const viewProps = (pageContext as { viewProps?: Record<string, unknown> }).viewProps ?? {}
  // View functions may return a plain string or a SafeString from @rudderjs/view's
  // html\`\` tag. String(...) coerces both uniformly (SafeString.toString() returns
  // its already-safe value).
  const result = (renderView as (props: Record<string, unknown>) => unknown)(viewProps)
  return typeof result === 'string' ? result : String(result)
}
`,
  }
}

const STUB_GENERATORS: Record<Framework, (view: DiscoveredView) => StubFile> = {
  react:       reactStub,
  'react-rsc': reactRscStub,
  vue:         vueStub,
  solid:       solidStub,
  vanilla:     vanillaStub,
}

// ─── Shared framework-agnostic files ───────────────────────

/**
 * No-op +data hook. Its presence forces Vike's client router to recognize
 * this page as having a server-side hook (`hasServerOnlyHook: true`), which
 * makes it fetch `pageContext.json` on every SPA navigation. Without this,
 * navigating from a regular Vike page into a controller view skips the fetch
 * entirely and renders the view with `viewProps = {}` — crashing the page.
 * The actual viewProps are injected via `pageContextInit` from the controller's
 * `renderPage()` call, not via this hook.
 */
const DATA_FILE_SOURCE = `// AUTO-GENERATED by @rudderjs/vite — do not edit.
import type { PageContextServer } from 'vike/types'
export const data = (_pageContext: PageContextServer): null => null
`

const PRERENDER_FILE_SOURCE = `// AUTO-GENERATED by @rudderjs/vite — do not edit.
// Opts this view into Vike's build-time static prerender pipeline.
// Source: \`export const prerender = true\` in the corresponding app/Views/ file.
export default true
`

/**
 * Codegen for `+onBeforePrerenderStart.ts` — Vike's per-page hook that
 * enumerates URLs to prerender for parameterized routes. We re-export the
 * user's `prerender` symbol from the view file and wrap it in an async
 * function regardless of its declared form (array, sync function, or async
 * function) — `() => Promise<X[]>` accepts all three at runtime.
 *
 * The hook is paired with `+prerender.ts` (Vike requires both — the boolean
 * opts the page into prerender, the hook supplies the URL list). Emitted
 * only when the view's prerender mode is `'dynamic'`.
 */
function onBeforePrerenderStartSource(view: DiscoveredView): string {
  return `// AUTO-GENERATED by @rudderjs/vite — do not edit.
// Source: \`export const prerender = [...] | (...) => ...\` in ${view.importPath}
import type { OnBeforePrerenderStartAsync } from 'vike/types'
import { prerender as source } from '${view.importPath}'

// \`prerender\` may be declared as a URL array, or a sync/async function that
// returns one. Normalize the imported symbol to that union so the runtime
// guard below type-checks regardless of which form the view used — a bare
// array would otherwise narrow the function branch to \`never\` (uncallable).
type Urls = Awaited<ReturnType<OnBeforePrerenderStartAsync>>
const value = source as Urls | (() => Urls | Promise<Urls>)

export const onBeforePrerenderStart: OnBeforePrerenderStartAsync<unknown> =
  async () => (typeof value === 'function' ? await value() : value)
`
}

function routeFileSource(view: DiscoveredView): string {
  // CRITICAL: the route URL must match the controller route the user registers
  // (e.g. `Route.get('/home', () => view('home'))`). Vike's client router does
  // its own route table lookup before fetching pageContext.json — if `/home`
  // is not in the table, it falls back to a full page reload.
  //
  // By default, the view id maps 1:1 to the URL path ('home' → /home). A view
  // file can override this by exporting a `route` constant at the top-level —
  // useful when the controller's URL differs from the natural id path
  // (e.g. `app/Views/Welcome.tsx` served at `/` instead of `/welcome`).
  return `// AUTO-GENERATED by @rudderjs/vite — do not edit.
export default '${view.url}'
`
}

/**
 * RSC route source — a per-view `+config.ts` that pins the route as an inlined
 * config VALUE rather than a separate `+route.ts` module.
 *
 * Why RSC needs this: vike-react-rsc's server-component exclusion plugin strips
 * every server-only project module from the client bundle, replacing its code
 * with `export default {}`. A `+route.ts` (`export default '/foo'`) is exactly
 * such a module, so on the client Vike's router would read the route as `{}`
 * (an object) and throw `[Wrong Usage] route … has an invalid type 'object'`,
 * breaking client routing and hydration. Vike's `route` config has
 * `env.client: 'if-client-routing'` (vike-react-rsc sets `clientRouting: true`),
 * so the route MUST reach the client — and a string set in `+config.ts` is
 * inlined into the page config (no physical module to strip). The scanner only
 * ever emits literal string routes, which always inline cleanly.
 */
function rscViewConfigSource(view: DiscoveredView): string {
  return `// AUTO-GENERATED by @rudderjs/vite — do not edit.
import type { Config } from 'vike/types'

export default {
  route: '${view.url}',
} satisfies Config
`
}

/**
 * Single shared config at the views root that tells Vike to serialize
 * `viewProps` + `viewHeaders` from server pageContext to the client. Without
 * this, the server SSR works but hydration crashes because the client
 * component receives `props = {}` (viewProps is undefined client-side).
 */
const VIEW_ROOT_CONFIG = `// AUTO-GENERATED by @rudderjs/vite — do not edit.
// Forwards controller-supplied viewProps + viewHeaders to client hydration.
import type { Config } from 'vike/types'

export default {
  passToClient: ['viewProps', 'viewHeaders'],
} satisfies Config
`

/**
 * RSC variant of the view-root config. Wires the RudderJS framework hooks as
 * vike `import:` strings (resolved from `@rudderjs/vite` in `node_modules`)
 * instead of physical `pages/+<hook>.ts` re-export stubs.
 *
 * Why RSC needs this: vike-react-rsc's `serverComponentExclusionPlugin` strips
 * every server-only project module from the client bundle (→ `export default
 * {}`). A physical `pages/+onCreatePageContext.ts` is such a module — and
 * `onCreatePageContext` is a GLOBAL hook vike runs on the client too — so its
 * export vanishes client-side and `execHook` throws during hydration (which a
 * vike bug then surfaces as an opaque `[Bug] You stumbled upon a Vike bug`).
 * `import:` specifiers point into `node_modules`, which the exclusion plugin
 * skips (it's how vike-react-rsc wires its own hooks), so they survive. No
 * `satisfies Config` here: the Config type expects hook functions, not the
 * import-string form vike resolves at config time.
 */
const RSC_VIEW_ROOT_CONFIG = `// AUTO-GENERATED by @rudderjs/vite — do not edit.
// Forwards controller viewProps + viewHeaders to client hydration, and wires
// the RudderJS framework hooks via import: strings. RSC can't use physical
// pages/+<hook>.ts stubs — vike-react-rsc-rudder strips them from the client
// bundle, breaking onCreatePageContext (which runs on the client) during hydration.
export default {
  passToClient: ['viewProps', 'viewHeaders'],
  onCreatePageContext: 'import:@rudderjs/vite/hooks/onCreatePageContext:onCreatePageContext',
  onError: 'import:@rudderjs/vite/hooks/onError:onError',
  headersResponse: 'import:@rudderjs/vite/hooks/headersResponse:headersResponse',
}
`

// ─── Top-level framework hook stubs ───────────────────────
//
// These re-export the hook implementations from `@rudderjs/vite`. The scanner
// writes them to `pages/+<hook>.ts` once, on first sync — only if the user
// hasn't already created their own. Users can replace the file to override.

interface FrameworkHookStub {
  filename: string
  contents: string
}

const FRAMEWORK_HOOK_STUBS: FrameworkHookStub[] = [
  {
    filename: '+onCreatePageContext.ts',
    contents: `// AUTO-GENERATED by @rudderjs/vite — overwrite freely to customize.
// Wires the page-context enhancer registry so packages can inject typed
// per-request data into pageContext (e.g. \`pageContext.user\` from @rudderjs/auth).
export { onCreatePageContext } from '@rudderjs/vite/hooks/onCreatePageContext'
`,
  },
  {
    filename: '+onError.ts',
    contents: `// AUTO-GENERATED by @rudderjs/vite — overwrite freely to customize.
// Routes Vike SSR errors through @rudderjs/core's report() pipeline.
export { onError } from '@rudderjs/vite/hooks/onError'
`,
  },
  {
    filename: '+headersResponse.ts',
    contents: `// AUTO-GENERATED by @rudderjs/vite — overwrite freely to customize.
// Reads response headers off pageContext.viewHeaders (set by view('id', props, { headers })).
export { headersResponse } from '@rudderjs/vite/hooks/headersResponse'
`,
  },
]

function generateFrameworkHooks(pagesRoot: string): void {
  fs.mkdirSync(pagesRoot, { recursive: true })
  for (const stub of FRAMEWORK_HOOK_STUBS) {
    const target = path.join(pagesRoot, stub.filename)
    // Only create on first run — preserve user customizations on subsequent
    // syncs. Users who want to override the hook just edit the file in place.
    if (fs.existsSync(target)) continue
    fs.writeFileSync(target, stub.contents)
  }
}

/**
 * RSC counterpart to `generateFrameworkHooks`: the hooks are wired via `import:`
 * strings in `RSC_VIEW_ROOT_CONFIG` instead, so any physical `pages/+<hook>.ts`
 * stub we previously generated must be removed — left in place it would be both
 * a duplicate hook definition AND a module the client exclusion strips. Only our
 * own auto-generated stubs are removed; a user-customized file is left alone.
 */
function removeAutoGeneratedFrameworkHooks(pagesRoot: string): void {
  for (const stub of FRAMEWORK_HOOK_STUBS) {
    const target = path.join(pagesRoot, stub.filename)
    if (!fs.existsSync(target)) continue
    if (fs.readFileSync(target, 'utf8').startsWith('// AUTO-GENERATED by @rudderjs/vite')) {
      fs.rmSync(target, { force: true })
    }
  }
}

// ─── File IO ───────────────────────────────────────────────

const ALL_PAGE_FILENAMES = ['+Page.tsx', '+Page.jsx', '+Page.vue', '+Page.ts', '+Page.js']

/**
 * Idempotent file write — read-compare-then-write. Returns `true` only when
 * the content actually changed.
 *
 * Load-bearing for watch stability: Vite's HMR fires on any `fs.writeFile`
 * to a tracked path, even if the bytes are identical. During `buildStart()`
 * and watcher-triggered rescans the scanner re-generates every page file;
 * without this guard, every rescan would trigger a full SSR module
 * invalidation for unchanged pages, causing dev-mode page flicker.
 */
function writeIfChanged(file: string, contents: string): boolean {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  if (fs.existsSync(file)) {
    const existing = fs.readFileSync(file, 'utf8')
    if (existing === contents) return false
  }
  fs.writeFileSync(file, contents)
  return true
}

/** Remove any `+Page.*` file in this view's dir that isn't the current target. */
function purgeStalePageFiles(outDir: string, keep: string): void {
  if (!fs.existsSync(outDir)) return
  for (const name of ALL_PAGE_FILENAMES) {
    if (name === keep) continue
    const p = path.join(outDir, name)
    if (fs.existsSync(p)) fs.rmSync(p)
  }
}

/**
 * Emit `pages/__view/registry.d.ts` — one TypeScript module-augmentation
 * entry per view that has an exported `Props` type.
 *
 * Uses `import('...').Props` rather than a top-level import so that
 *   (a) the file is a pure type declaration with no runtime impact, and
 *   (b) tsc resolves the import lazily — a missing source file surfaces as
 *       a targeted error pointing at the view, not a registry-wide compile
 *       break.
 *
 * Views without an exported `Props` are omitted; their call sites fall
 * through to `@rudderjs/view`'s loose `view(id, props?)` overload. When no
 * view exports Props, the registry is still emitted with an empty interface
 * — keeps tsc happy on apps in transition and avoids special-casing the
 * cleanup pass when a Props export is later removed.
 */
function registryFileSource(views: DiscoveredView[]): string {
  const typed = views.filter(v => v.hasProps)
  const entries = typed
    .map(v => `    '${v.id}': import('${v.importPath}').Props`)
    .join('\n')
  const body = entries ? `\n${entries}\n  ` : '\n  '

  return `// AUTO-GENERATED by @rudderjs/vite — do not edit.
// Maps view ids → exported component Props types for typed view() calls.
// Re-generated on every scan; views without an exported Props are omitted.
declare module '@rudderjs/view' {
  interface ViewPropsRegistry {${body}}
}
export {}
`
}

function generate(generatedRoot: string, pagesRoot: string, views: DiscoveredView[], framework: Framework, rscPkg: string = RSC_PACKAGES[0]): void {
  if (views.length === 0) return
  const isRsc = framework === 'react-rsc'
  writeIfChanged(path.join(generatedRoot, '+config.ts'), isRsc ? RSC_VIEW_ROOT_CONFIG : VIEW_ROOT_CONFIG)
  writeIfChanged(path.join(generatedRoot, 'registry.d.ts'), registryFileSource(views))
  if (isRsc) {
    // RSC wires the framework hooks via import: strings in RSC_VIEW_ROOT_CONFIG;
    // physical pages/+<hook>.ts stubs would be stripped from the client bundle.
    removeAutoGeneratedFrameworkHooks(pagesRoot)
  } else {
    generateFrameworkHooks(pagesRoot)
  }
  const generator = STUB_GENERATORS[framework]
  for (const v of views) {
    const stub = isRsc ? reactRscStub(v, rscPkg) : generator(v)
    purgeStalePageFiles(v.outDir, stub.filename)
    writeIfChanged(path.join(v.outDir, stub.filename), stub.contents)
    if (framework === 'react-rsc') {
      // RSC: pin the route via an inlined `+config.ts` value, not a `+route.ts`
      // module (which vike-react-rsc strips from the client bundle). Remove any
      // stale `+route.ts` left over from a non-RSC renderer or an older scanner.
      writeIfChanged(path.join(v.outDir, '+config.ts'), rscViewConfigSource(v))
      const staleRoute = path.join(v.outDir, '+route.ts')
      if (fs.existsSync(staleRoute)) fs.rmSync(staleRoute, { force: true })
    } else {
      writeIfChanged(path.join(v.outDir, '+route.ts'), routeFileSource(v))
    }
    writeIfChanged(path.join(v.outDir, '+data.ts'),    DATA_FILE_SOURCE)
    syncPrerenderArtifacts(v)
  }
}

/**
 * Reconcile `+prerender.ts` + `+onBeforePrerenderStart.ts` against the view's
 * current prerender mode:
 *
 * - `'off'`     → both files absent
 * - `'static'`  → only `+prerender.ts` present
 * - `'dynamic'` → both files present (Vike needs both to enumerate parameterized URLs)
 *
 * Drives switching between modes (static ↔ dynamic ↔ off) on disk symmetric
 * to the source export's shape, so removing or changing the export in a view
 * file drops or rewrites the generated artifacts on the next scan.
 */
function syncPrerenderArtifacts(view: DiscoveredView): void {
  const prerenderFile = path.join(view.outDir, '+prerender.ts')
  const hookFile      = path.join(view.outDir, '+onBeforePrerenderStart.ts')

  if (view.prerender === 'off') {
    if (fs.existsSync(prerenderFile)) fs.rmSync(prerenderFile, { force: true })
    if (fs.existsSync(hookFile))      fs.rmSync(hookFile,      { force: true })
    return
  }

  writeIfChanged(prerenderFile, PRERENDER_FILE_SOURCE)

  if (view.prerender === 'dynamic') {
    writeIfChanged(hookFile, onBeforePrerenderStartSource(view))
  } else if (fs.existsSync(hookFile)) {
    // Mode switched dynamic → static: the hook is no longer wanted (Vike
    // would otherwise try to import a `prerender` symbol the view no longer
    // exports as a function/array).
    fs.rmSync(hookFile, { force: true })
  }
}

function cleanStale(generatedRoot: string, current: DiscoveredView[]): void {
  if (!fs.existsSync(generatedRoot)) return
  const expected = new Set(current.map(v => v.outDir))
  const walkDirs = (dir: string): string[] => {
    const out: string[] = []
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const full = path.join(dir, entry.name)
      // Leaf dirs are identified by a generated page stub (framework-agnostic):
      // every view dir gets exactly one +Page.*. A legacy +route.ts also marks a
      // leaf for non-RSC renderers; RSC leaves carry a +config.ts route instead.
      const isLeaf =
        fs.existsSync(path.join(full, '+route.ts')) ||
        ALL_PAGE_FILENAMES.some((f) => fs.existsSync(path.join(full, f)))
      if (isLeaf) {
        out.push(full)
      } else {
        out.push(...walkDirs(full))
      }
    }
    return out
  }
  for (const dir of walkDirs(generatedRoot)) {
    if (!expected.has(dir)) {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  }
}

// ─── Plugin ────────────────────────────────────────────────

/**
 * Vite plugin that scans `app/Views/**` and emits virtual Vike pages
 * under `pages/__view/`. Watches the source directory in dev mode.
 */
export interface ViewsSyncResult {
  /** Whether `app/Views/` exists in the target directory. */
  viewsRootExists: boolean
  /** Detected framework — `null` when viewsRoot is absent (no scan ran). */
  framework:       Framework | null
  /** Number of views discovered. */
  viewCount:       number
  /** Number of views with an exported `Props` type. */
  typedCount:      number
}

/**
 * Synchronously regenerate `pages/__view/` from `app/Views/`.
 *
 * Public surface for the `rudder view:sync` CLI command and any other
 * tooling that needs to materialize the registry / Vike stubs without
 * starting Vite. Idempotent — read-compare-then-write semantics across
 * every generated file (see `writeIfChanged`).
 *
 * Returns enough metadata for callers to print a useful summary line
 * without re-walking the directory.
 */
export function syncViewsFromDisk(cwd: string = process.cwd()): ViewsSyncResult {
  const trace = process.env['RUDDER_PERF_TRACE'] === '1'
  const t0 = trace ? performance.now() : 0
  const viewsRoot     = path.join(cwd, 'app', 'Views')
  const pagesRoot     = path.join(cwd, 'pages')
  const generatedRoot = path.join(pagesRoot, '__view')

  if (!fs.existsSync(viewsRoot)) {
    return { viewsRootExists: false, framework: null, viewCount: 0, typedCount: 0 }
  }

  const framework = detectFramework(cwd)
  const rscPkg    = framework === 'react-rsc' ? rscPackageName(cwd) : RSC_PACKAGES[0]
  const views     = discover(viewsRoot, pagesRoot, framework)
  cleanStale(generatedRoot, views)
  generate(generatedRoot, pagesRoot, views, framework, rscPkg)

  const result: ViewsSyncResult = {
    viewsRootExists: true,
    framework,
    viewCount:  views.length,
    typedCount: views.filter(v => v.hasProps).length,
  }

  if (trace) {
    const dt = performance.now() - t0
    console.log(`[perf] view-scan ${dt.toFixed(1)}ms (${result.viewCount} views, ${result.typedCount} typed)`)
  }

  return result
}

export function viewsScannerPlugin(): Plugin {
  const cwd            = process.cwd()
  const viewsRoot      = path.join(cwd, 'app', 'Views')

  // Detect the framework lazily — only when we actually need to scan views.
  // This keeps the plugin silent on projects that don't use app/Views/ at
  // all (e.g. multi-framework scaffolder setups that install vike-react AND
  // vike-vue for demo pages but never call view()). If detection is done
  // eagerly, those projects crash at plugin construction with a "multiple
  // renderers" error even though they don't touch @rudderjs/view.
  let framework: Framework | null = null
  const getFramework = (): Framework => framework ??= detectFramework(cwd)

  // Eager sync at plugin construction time — Vike scans `pages/` during its
  // own plugin init, so the generated stubs MUST exist on disk before any
  // Vite/Vike hook fires. configureServer/buildStart are too late.
  if (fs.existsSync(viewsRoot)) syncViewsFromDisk(cwd)

  return {
    name: 'rudderjs:views-scanner',
    enforce: 'pre',
    buildStart() {
      if (!fs.existsSync(viewsRoot)) return
      syncViewsFromDisk(cwd)
    },
    configureServer(server) {
      if (!fs.existsSync(viewsRoot)) return
      server.watcher.add(viewsRoot)
      const onChange = (file: string): void => {
        if (!file.startsWith(viewsRoot)) return
        const exts = EXTENSIONS_BY_FRAMEWORK[getFramework()]
        if (!exts.some(e => file.toLowerCase().endsWith(e))) return
        syncViewsFromDisk(cwd)
      }
      server.watcher.on('add',    onChange)
      server.watcher.on('unlink', onChange)
      server.watcher.on('change', onChange)
    },
  }
}
