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
 * `vike-vue`, or `vike-solid` from the project's package.json at plugin
 * construction time. If none are installed, the scanner falls back to
 * **vanilla mode** (the "Blade equivalent"): `.ts`/`.js` views that export a
 * function returning an HTML string, no client hydration.
 */

import fs from 'node:fs'
import path from 'node:path'
import type { Plugin } from 'vite'

type Framework = 'react' | 'vue' | 'solid' | 'vanilla'

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
    ['vike-react', 'react'],
    ['vike-vue',   'vue'],
    ['vike-solid', 'solid'],
  ] as const) {
    if (fs.existsSync(path.join(nodeModules, pkg, 'package.json'))) {
      installed.push(fw)
    }
  }

  if (installed.length > 1) {
    throw new Error(
      `[rudderjs:views-scanner] Multiple Vike renderers found (${installed.join(', ')}). ` +
      `Install only one of vike-react, vike-vue, vike-solid.`,
    )
  }
  return installed[0] ?? 'vanilla'
}

// ─── Extensions per framework ──────────────────────────────

const EXTENSIONS_BY_FRAMEWORK: Record<Framework, string[]> = {
  react:   ['.tsx', '.jsx'],
  vue:     ['.vue'],
  solid:   ['.tsx', '.jsx'],
  vanilla: ['.ts',  '.js'],
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
const ROUTE_EXPORT_RE = /(?:^|[\s;])export\s+const\s+route\s*(?::\s*string)?\s*=\s*['"`]([^'"`]+)['"`]/m

function readRouteOverride(absPath: string): string | null {
  try {
    const source = fs.readFileSync(absPath, 'utf8')
    const m = source.match(ROUTE_EXPORT_RE)
    return m ? m[1] ?? null : null
  } catch {
    return null
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
    return { id, absPath, importPath, outDir, url }
  })
}

// ─── Stub generators ───────────────────────────────────────

function reactStub(view: DiscoveredView): StubFile {
  return {
    filename: '+Page.tsx',
    contents: `// AUTO-GENERATED by @rudderjs/vite — do not edit.
// Source: ${view.importPath}
import ViewComponent from '${view.importPath}'
import { usePageContext } from 'vike-react/usePageContext'

// Cast to a permissive component type — controller-supplied props are validated
// at the call site (view('id', props)), not in this generated stub.
const View = ViewComponent as unknown as (props: Record<string, unknown>) => JSX.Element

export default function Page() {
  const ctx = usePageContext() as unknown as { viewProps?: Record<string, unknown> }
  const props = ctx.viewProps ?? {}
  return <View {...props} />
}
`,
  }
}

function solidStub(view: DiscoveredView): StubFile {
  return {
    filename: '+Page.tsx',
    contents: `// AUTO-GENERATED by @rudderjs/vite — do not edit.
// Source: ${view.importPath}
import ViewComponent from '${view.importPath}'
import { usePageContext } from 'vike-solid/usePageContext'

const View = ViewComponent as unknown as (props: Record<string, unknown>) => JSX.Element

export default function Page() {
  const ctx = usePageContext() as unknown as { viewProps?: Record<string, unknown> }
  return <View {...(ctx.viewProps ?? {})} />
}
`,
  }
}

function vueStub(view: DiscoveredView): StubFile {
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
  react:   reactStub,
  vue:     vueStub,
  solid:   solidStub,
  vanilla: vanillaStub,
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
 * Single shared config at the views root that tells Vike to serialize
 * `viewProps` from server pageContext to the client. Without this, the
 * server SSR works but hydration crashes because the client component
 * receives `props = {}` (viewProps is undefined client-side).
 */
const VIEW_ROOT_CONFIG = `// AUTO-GENERATED by @rudderjs/vite — do not edit.
// Forwards controller-supplied viewProps from server SSR to client hydration.
import type { Config } from 'vike/types'

export default {
  passToClient: ['viewProps'],
} satisfies Config
`

// ─── File IO ───────────────────────────────────────────────

const ALL_PAGE_FILENAMES = ['+Page.tsx', '+Page.jsx', '+Page.vue', '+Page.ts', '+Page.js']

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

function generate(generatedRoot: string, views: DiscoveredView[], framework: Framework): void {
  if (views.length === 0) return
  writeIfChanged(path.join(generatedRoot, '+config.ts'), VIEW_ROOT_CONFIG)
  const generator = STUB_GENERATORS[framework]
  for (const v of views) {
    const stub = generator(v)
    purgeStalePageFiles(v.outDir, stub.filename)
    writeIfChanged(path.join(v.outDir, stub.filename), stub.contents)
    writeIfChanged(path.join(v.outDir, '+route.ts'),   routeFileSource(v))
    writeIfChanged(path.join(v.outDir, '+data.ts'),    DATA_FILE_SOURCE)
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
      // Leaf dirs are identified by a generated +route.ts (framework-agnostic).
      if (fs.existsSync(path.join(full, '+route.ts'))) {
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
export function viewsScannerPlugin(): Plugin {
  const cwd            = process.cwd()
  const viewsRoot      = path.join(cwd, 'app', 'Views')
  const pagesRoot      = path.join(cwd, 'pages')
  const generatedRoot  = path.join(pagesRoot, '__view')

  // Detect the framework lazily — only when we actually need to scan views.
  // This keeps the plugin silent on projects that don't use app/Views/ at
  // all (e.g. multi-framework scaffolder setups that install vike-react AND
  // vike-vue for demo pages but never call view()). If detection is done
  // eagerly, those projects crash at plugin construction with a "multiple
  // renderers" error even though they don't touch @rudderjs/view.
  let framework: Framework | null = null
  const getFramework = (): Framework => framework ??= detectFramework(cwd)

  const sync = (): void => {
    const fw    = getFramework()
    const views = discover(viewsRoot, pagesRoot, fw)
    cleanStale(generatedRoot, views)
    generate(generatedRoot, views, fw)
  }

  // Eager sync at plugin construction time — Vike scans `pages/` during its
  // own plugin init, so the generated stubs MUST exist on disk before any
  // Vite/Vike hook fires. configureServer/buildStart are too late.
  if (fs.existsSync(viewsRoot)) sync()

  return {
    name: 'rudderjs:views-scanner',
    enforce: 'pre',
    buildStart() {
      if (!fs.existsSync(viewsRoot)) return
      sync()
    },
    configureServer(server) {
      if (!fs.existsSync(viewsRoot)) return
      server.watcher.add(viewsRoot)
      const onChange = (file: string): void => {
        if (!file.startsWith(viewsRoot)) return
        const exts = EXTENSIONS_BY_FRAMEWORK[getFramework()]
        if (!exts.some(e => file.toLowerCase().endsWith(e))) return
        sync()
      }
      server.watcher.on('add',    onChange)
      server.watcher.on('unlink', onChange)
      server.watcher.on('change', onChange)
    },
  }
}
