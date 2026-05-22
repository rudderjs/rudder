import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { viewsScannerPlugin, syncViewsFromDisk } from './views-scanner.js'

/**
 * Scaffold a throwaway project tree that looks like a real app to the scanner:
 *
 *   {root}/
 *     package.json
 *     node_modules/{framework-package}/package.json   (so createRequire resolves it)
 *     app/Views/Home.tsx  (or Home.vue / Home.ts depending on framework)
 *     pages/                                           (scanner writes __view/ here)
 */
function scaffold(framework: 'react' | 'vue' | 'solid' | 'vanilla'): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'views-scanner-'))
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'fixture' }))

  const pkgByFramework: Record<typeof framework, string | null> = {
    react:   'vike-react',
    vue:     'vike-vue',
    solid:   'vike-solid',
    vanilla: null,
  }
  const pkg = pkgByFramework[framework]
  if (pkg) {
    const pkgDir = path.join(root, 'node_modules', pkg)
    fs.mkdirSync(pkgDir, { recursive: true })
    fs.writeFileSync(
      path.join(pkgDir, 'package.json'),
      JSON.stringify({ name: pkg, version: '0.0.0', main: 'index.js' }),
    )
    fs.writeFileSync(path.join(pkgDir, 'index.js'), '')
  }

  const viewsDir = path.join(root, 'app', 'Views')
  fs.mkdirSync(viewsDir, { recursive: true })
  const viewExt = {
    react:   '.tsx',
    vue:     '.vue',
    solid:   '.tsx',
    vanilla: '.ts',
  }[framework]
  fs.writeFileSync(path.join(viewsDir, `Home${viewExt}`), '// placeholder\n')

  fs.mkdirSync(path.join(root, 'pages'), { recursive: true })
  return root
}

describe('views-scanner — framework detection', () => {
  const prevCwd = process.cwd()
  let root = ''

  afterEach(() => {
    process.chdir(prevCwd)
    if (root) fs.rmSync(root, { recursive: true, force: true })
  })

  it('generates a React stub when vike-react is installed', () => {
    root = scaffold('react')
    process.chdir(root)
    viewsScannerPlugin() // eager sync at construction
    const generated = path.join(root, 'pages', '__view', 'home', '+Page.tsx')
    assert.ok(fs.existsSync(generated), '+Page.tsx should exist')
    const contents = fs.readFileSync(generated, 'utf8')
    assert.match(contents, /vike-react\/usePageContext/)
    assert.match(contents, /ViewComponent/)
    assert.ok(fs.existsSync(path.join(root, 'pages', '__view', 'home', '+route.ts')))
    assert.ok(fs.existsSync(path.join(root, 'pages', '__view', 'home', '+data.ts')))
  })

  it('generates a Vue stub when vike-vue is installed', () => {
    root = scaffold('vue')
    process.chdir(root)
    viewsScannerPlugin()
    const generated = path.join(root, 'pages', '__view', 'home', '+Page.vue')
    assert.ok(fs.existsSync(generated), '+Page.vue should exist')
    const contents = fs.readFileSync(generated, 'utf8')
    assert.match(contents, /vike-vue\/usePageContext/)
    assert.match(contents, /<template>/)
    assert.match(contents, /v-bind="viewProps"/)
  })

  it('generates a Solid stub when vike-solid is installed', () => {
    root = scaffold('solid')
    process.chdir(root)
    viewsScannerPlugin()
    const generated = path.join(root, 'pages', '__view', 'home', '+Page.tsx')
    assert.ok(fs.existsSync(generated), '+Page.tsx should exist')
    const contents = fs.readFileSync(generated, 'utf8')
    assert.match(contents, /vike-solid\/usePageContext/)
  })

  it('generates a vanilla stub when no vike-* is installed', () => {
    root = scaffold('vanilla')
    process.chdir(root)
    viewsScannerPlugin()
    const generated = path.join(root, 'pages', '__view', 'home', '+Page.ts')
    assert.ok(fs.existsSync(generated), '+Page.ts should exist')
    const contents = fs.readFileSync(generated, 'utf8')
    assert.match(contents, /export function Page/)
    assert.match(contents, /renderView/)
    assert.doesNotMatch(contents, /usePageContext/)
  })

  it('throws when multiple vike-* renderers are installed', () => {
    root = scaffold('react')
    // Also install vike-vue to trigger the conflict
    const vueDir = path.join(root, 'node_modules', 'vike-vue')
    fs.mkdirSync(vueDir, { recursive: true })
    fs.writeFileSync(
      path.join(vueDir, 'package.json'),
      JSON.stringify({ name: 'vike-vue', version: '0.0.0', main: 'index.js' }),
    )
    fs.writeFileSync(path.join(vueDir, 'index.js'), '')
    process.chdir(root)
    assert.throws(() => viewsScannerPlugin(), /Multiple Vike renderers/)
  })

  it('honors `export const route` override in a React view', () => {
    root = scaffold('react')
    // Overwrite the placeholder with a real file that exports a route.
    fs.writeFileSync(
      path.join(root, 'app', 'Views', 'Home.tsx'),
      `export const route = '/'\nexport default function Home() { return null }\n`,
    )
    process.chdir(root)
    viewsScannerPlugin()
    const routeFile = path.join(root, 'pages', '__view', 'home', '+route.ts')
    const contents  = fs.readFileSync(routeFile, 'utf8')
    assert.match(contents, /export default '\/'/)
    assert.doesNotMatch(contents, /\/home/)
  })

  it('falls back to the id-derived URL when no route override is present', () => {
    root = scaffold('react')
    process.chdir(root)
    viewsScannerPlugin()
    const routeFile = path.join(root, 'pages', '__view', 'home', '+route.ts')
    assert.match(fs.readFileSync(routeFile, 'utf8'), /export default '\/home'/)
  })

  it('honors `export const route` in a Vue dual <script> / <script setup> block', () => {
    // Vue SFCs reject top-level `export` statements inside <script setup>,
    // so real Vue view files put the route constant in a regular <script>
    // block alongside <script setup>. The scanner reads both blocks as plain
    // text so the regex still matches.
    root = scaffold('vue')
    fs.writeFileSync(
      path.join(root, 'app', 'Views', 'Home.vue'),
      `<script lang="ts">\nexport const route = '/dashboard'\n</script>\n<script setup lang="ts">\nconst x = 1\n</script>\n<template><div /></template>\n`,
    )
    process.chdir(root)
    viewsScannerPlugin()
    const routeFile = path.join(root, 'pages', '__view', 'home', '+route.ts')
    assert.match(fs.readFileSync(routeFile, 'utf8'), /export default '\/dashboard'/)
  })

  it('purges stale +Page.* files when the framework changes', () => {
    root = scaffold('react')
    process.chdir(root)
    viewsScannerPlugin()
    const reactStub = path.join(root, 'pages', '__view', 'home', '+Page.tsx')
    assert.ok(fs.existsSync(reactStub))

    // Simulate switching to Vue: remove vike-react, install vike-vue, replace view
    fs.rmSync(path.join(root, 'node_modules', 'vike-react'), { recursive: true, force: true })
    const vueDir = path.join(root, 'node_modules', 'vike-vue')
    fs.mkdirSync(vueDir, { recursive: true })
    fs.writeFileSync(
      path.join(vueDir, 'package.json'),
      JSON.stringify({ name: 'vike-vue', version: '0.0.0', main: 'index.js' }),
    )
    fs.writeFileSync(path.join(vueDir, 'index.js'), '')
    fs.rmSync(path.join(root, 'app', 'Views', 'Home.tsx'))
    fs.writeFileSync(path.join(root, 'app', 'Views', 'Home.vue'), '<!-- vue -->\n')

    viewsScannerPlugin()
    assert.ok(!fs.existsSync(reactStub), 'stale +Page.tsx should be purged')
    assert.ok(fs.existsSync(path.join(root, 'pages', '__view', 'home', '+Page.vue')))
  })
})

describe('views-scanner — ViewPropsRegistry emission', () => {
  const prevCwd = process.cwd()
  let root = ''

  afterEach(() => {
    process.chdir(prevCwd)
    if (root) fs.rmSync(root, { recursive: true, force: true })
    root = ''
  })

  it('emits registry.d.ts for views with an exported Props interface', () => {
    root = scaffold('react')
    fs.writeFileSync(
      path.join(root, 'app', 'Views', 'Home.tsx'),
      `export interface Props { user: { id: number }; count: number }\nexport default function Home() { return null }\n`,
    )
    process.chdir(root)
    viewsScannerPlugin()
    const registryPath = path.join(root, 'pages', '__view', 'registry.d.ts')
    assert.ok(fs.existsSync(registryPath), 'registry.d.ts should be emitted')
    const registry = fs.readFileSync(registryPath, 'utf8')
    assert.match(registry, /declare module '@rudderjs\/view'/)
    assert.match(registry, /interface ViewPropsRegistry/)
    assert.match(registry, /'home':\s*import\(['"]App\/Views\/Home\.tsx['"]\)\.Props/)
  })

  it('emits registry.d.ts for views with an exported Props type alias', () => {
    root = scaffold('react')
    fs.writeFileSync(
      path.join(root, 'app', 'Views', 'Home.tsx'),
      `export type Props = { foo: string }\nexport default function Home() { return null }\n`,
    )
    process.chdir(root)
    viewsScannerPlugin()
    const registry = fs.readFileSync(path.join(root, 'pages', '__view', 'registry.d.ts'), 'utf8')
    assert.match(registry, /'home':\s*import\(['"]App\/Views\/Home\.tsx['"]\)\.Props/)
  })

  it('omits views that do not export Props', () => {
    root = scaffold('react')
    // Default Home.tsx scaffold has no Props export.
    fs.writeFileSync(
      path.join(root, 'app', 'Views', 'Untyped.tsx'),
      `export default function Untyped() { return null }\n`,
    )
    fs.writeFileSync(
      path.join(root, 'app', 'Views', 'Dashboard.tsx'),
      `export interface Props { count: number }\nexport default function Dashboard() { return null }\n`,
    )
    process.chdir(root)
    viewsScannerPlugin()
    const registry = fs.readFileSync(path.join(root, 'pages', '__view', 'registry.d.ts'), 'utf8')
    assert.match(registry, /'dashboard':/)
    assert.doesNotMatch(registry, /'untyped':/, 'view without Props export must be omitted')
    assert.doesNotMatch(registry, /'home':/, 'untyped placeholder must be omitted')
  })

  it('writes an empty ViewPropsRegistry when no views export Props', () => {
    root = scaffold('react')
    // The default scaffold leaves Home.tsx as a placeholder with no Props export.
    process.chdir(root)
    viewsScannerPlugin()
    const registryPath = path.join(root, 'pages', '__view', 'registry.d.ts')
    if (fs.existsSync(registryPath)) {
      const contents = fs.readFileSync(registryPath, 'utf8')
      assert.doesNotMatch(contents, /import\(/, 'no typed views = no import() entries')
      assert.match(contents, /interface ViewPropsRegistry/)
    }
  })

  it('emits registry.d.ts for Vue views that export Props in a regular <script> block', () => {
    root = scaffold('vue')
    fs.writeFileSync(
      path.join(root, 'app', 'Views', 'Home.vue'),
      `<script lang="ts">\nexport interface Props { user: { id: number } }\n</script>\n<script setup lang="ts">\nconst x = 1\n</script>\n<template><div /></template>\n`,
    )
    process.chdir(root)
    viewsScannerPlugin()
    const registry = fs.readFileSync(path.join(root, 'pages', '__view', 'registry.d.ts'), 'utf8')
    assert.match(registry, /'home':\s*import\(['"]App\/Views\/Home\.vue['"]\)\.Props/)
  })

  it('re-emits registry.d.ts after a view source change adds a Props export', () => {
    root = scaffold('react')
    process.chdir(root)
    viewsScannerPlugin()
    const registryPath = path.join(root, 'pages', '__view', 'registry.d.ts')
    const before = fs.existsSync(registryPath) ? fs.readFileSync(registryPath, 'utf8') : ''
    assert.doesNotMatch(before, /'home':\s*import\(/, 'placeholder has no Props export yet')

    // Add an exported Props interface and re-run a scan (mimics the watcher firing).
    fs.writeFileSync(
      path.join(root, 'app', 'Views', 'Home.tsx'),
      `export interface Props { foo: string }\nexport default function Home() { return null }\n`,
    )
    viewsScannerPlugin()
    const after = fs.readFileSync(registryPath, 'utf8')
    assert.match(after, /'home':\s*import\(['"]App\/Views\/Home\.tsx['"]\)\.Props/)
  })
})

describe('views-scanner — typed +Page stubs', () => {
  const prevCwd = process.cwd()
  let root = ''

  afterEach(() => {
    process.chdir(prevCwd)
    if (root) fs.rmSync(root, { recursive: true, force: true })
    root = ''
  })

  it('React stub imports the per-view Props type when available', () => {
    root = scaffold('react')
    fs.writeFileSync(
      path.join(root, 'app', 'Views', 'Home.tsx'),
      `export interface Props { foo: string }\nexport default function Home() { return null }\n`,
    )
    process.chdir(root)
    viewsScannerPlugin()
    const stub = fs.readFileSync(path.join(root, 'pages', '__view', 'home', '+Page.tsx'), 'utf8')
    assert.match(stub, /import type \{ Props \} from ['"]App\/Views\/Home\.tsx['"]/)
    assert.match(stub, /viewProps\?:\s*Props/)
    assert.doesNotMatch(stub, /Record<string, unknown>/, 'must not fall back to loose record when Props exists')
  })

  it('React stub uses a loose record when no Props export is present', () => {
    root = scaffold('react')
    // Default scaffold leaves Home.tsx as a placeholder with no Props export.
    process.chdir(root)
    viewsScannerPlugin()
    const stub = fs.readFileSync(path.join(root, 'pages', '__view', 'home', '+Page.tsx'), 'utf8')
    assert.match(stub, /Record<string, unknown>/)
    assert.doesNotMatch(stub, /import type \{ Props \}/, 'no Props import when source has none')
  })

  it('Solid stub imports the per-view Props type when available', () => {
    root = scaffold('solid')
    fs.writeFileSync(
      path.join(root, 'app', 'Views', 'Home.tsx'),
      `export interface Props { count: number }\nexport default function Home() { return null }\n`,
    )
    process.chdir(root)
    viewsScannerPlugin()
    const stub = fs.readFileSync(path.join(root, 'pages', '__view', 'home', '+Page.tsx'), 'utf8')
    assert.match(stub, /import type \{ Props \} from ['"]App\/Views\/Home\.tsx['"]/)
    assert.match(stub, /viewProps\?:\s*Props/)
    assert.doesNotMatch(stub, /Record<string, unknown>/)
  })

  it('Solid stub uses a loose record when no Props export is present', () => {
    root = scaffold('solid')
    process.chdir(root)
    viewsScannerPlugin()
    const stub = fs.readFileSync(path.join(root, 'pages', '__view', 'home', '+Page.tsx'), 'utf8')
    assert.match(stub, /Record<string, unknown>/)
  })

  it('Vue stub imports the per-view Props type when available', () => {
    root = scaffold('vue')
    fs.writeFileSync(
      path.join(root, 'app', 'Views', 'Home.vue'),
      `<script lang="ts">\nexport interface Props { user: { id: number } }\n</script>\n<script setup lang="ts">\nconst x = 1\n</script>\n<template><div /></template>\n`,
    )
    process.chdir(root)
    viewsScannerPlugin()
    const stub = fs.readFileSync(path.join(root, 'pages', '__view', 'home', '+Page.vue'), 'utf8')
    assert.match(stub, /import type \{ Props \} from ['"]App\/Views\/Home\.vue['"]/)
    assert.match(stub, /viewProps:\s*Props/)
    assert.doesNotMatch(stub, /Record<string, unknown>/)
  })

  it('Vue stub uses a loose record when no Props export is present', () => {
    root = scaffold('vue')
    process.chdir(root)
    viewsScannerPlugin()
    const stub = fs.readFileSync(path.join(root, 'pages', '__view', 'home', '+Page.vue'), 'utf8')
    assert.match(stub, /Record<string, unknown>/)
  })
})

describe('views-scanner — prerender opt-in', () => {
  const prevCwd = process.cwd()
  let root = ''

  afterEach(() => {
    process.chdir(prevCwd)
    if (root) fs.rmSync(root, { recursive: true, force: true })
    root = ''
  })

  it('emits +prerender.ts when the view declares export const prerender = true', () => {
    root = scaffold('react')
    fs.writeFileSync(
      path.join(root, 'app', 'Views', 'Home.tsx'),
      `export const prerender = true\nexport default function Home() { return null }\n`,
    )
    process.chdir(root)
    viewsScannerPlugin()
    const prerenderFile = path.join(root, 'pages', '__view', 'home', '+prerender.ts')
    assert.ok(fs.existsSync(prerenderFile), '+prerender.ts should be emitted')
    assert.match(fs.readFileSync(prerenderFile, 'utf8'), /export default true/)
  })

  it('tolerates the `: boolean` annotation on the export', () => {
    root = scaffold('react')
    fs.writeFileSync(
      path.join(root, 'app', 'Views', 'Home.tsx'),
      `export const prerender: boolean = true\nexport default function Home() { return null }\n`,
    )
    process.chdir(root)
    viewsScannerPlugin()
    assert.ok(fs.existsSync(path.join(root, 'pages', '__view', 'home', '+prerender.ts')))
  })

  it('does not emit +prerender.ts when the export is absent', () => {
    root = scaffold('react')
    process.chdir(root)
    viewsScannerPlugin()
    assert.ok(!fs.existsSync(path.join(root, 'pages', '__view', 'home', '+prerender.ts')))
  })

  it('does not emit +prerender.ts for `export const prerender = false`', () => {
    root = scaffold('react')
    fs.writeFileSync(
      path.join(root, 'app', 'Views', 'Home.tsx'),
      `export const prerender = false\nexport default function Home() { return null }\n`,
    )
    process.chdir(root)
    viewsScannerPlugin()
    assert.ok(!fs.existsSync(path.join(root, 'pages', '__view', 'home', '+prerender.ts')))
  })

  it('removes a stale +prerender.ts when the source flips off the export', () => {
    root = scaffold('react')
    fs.writeFileSync(
      path.join(root, 'app', 'Views', 'Home.tsx'),
      `export const prerender = true\nexport default function Home() { return null }\n`,
    )
    process.chdir(root)
    viewsScannerPlugin()
    const prerenderFile = path.join(root, 'pages', '__view', 'home', '+prerender.ts')
    assert.ok(fs.existsSync(prerenderFile))

    fs.writeFileSync(
      path.join(root, 'app', 'Views', 'Home.tsx'),
      `export default function Home() { return null }\n`,
    )
    viewsScannerPlugin()
    assert.ok(!fs.existsSync(prerenderFile), 'stale +prerender.ts should be removed')
  })

  it('works through a Vue dual <script> block', () => {
    root = scaffold('vue')
    fs.writeFileSync(
      path.join(root, 'app', 'Views', 'Home.vue'),
      `<script lang="ts">\nexport const prerender = true\n</script>\n<script setup lang="ts">\nconst x = 1\n</script>\n<template><div /></template>\n`,
    )
    process.chdir(root)
    viewsScannerPlugin()
    assert.ok(fs.existsSync(path.join(root, 'pages', '__view', 'home', '+prerender.ts')))
  })
})

describe('views-scanner — syncViewsFromDisk (CLI surface)', () => {
  const prevCwd = process.cwd()
  let root = ''

  afterEach(() => {
    process.chdir(prevCwd)
    if (root) fs.rmSync(root, { recursive: true, force: true })
    root = ''
  })

  it('reports viewsRootExists: false when app/Views/ is missing', () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'views-sync-noviews-'))
    process.chdir(root)
    const result = syncViewsFromDisk()
    assert.deepEqual(result, { viewsRootExists: false, framework: null, viewCount: 0, typedCount: 0 })
    // No pages/__view/ should be created either.
    assert.ok(!fs.existsSync(path.join(root, 'pages', '__view')))
  })

  it('regenerates pages/__view/ and returns counts for a typed view', () => {
    root = scaffold('react')
    fs.writeFileSync(
      path.join(root, 'app', 'Views', 'Home.tsx'),
      `export interface Props { foo: string }\nexport default function Home() { return null }\n`,
    )
    fs.writeFileSync(
      path.join(root, 'app', 'Views', 'Plain.tsx'),
      `export default function Plain() { return null }\n`,
    )
    process.chdir(root)
    const result = syncViewsFromDisk()

    assert.equal(result.viewsRootExists, true)
    assert.equal(result.framework, 'react')
    assert.equal(result.viewCount, 2)
    assert.equal(result.typedCount, 1)

    const registry = fs.readFileSync(path.join(root, 'pages', '__view', 'registry.d.ts'), 'utf8')
    assert.match(registry, /'home':\s*import\(['"]App\/Views\/Home\.tsx['"]\)\.Props/)
    assert.ok(fs.existsSync(path.join(root, 'pages', '__view', 'home', '+Page.tsx')))
    assert.ok(fs.existsSync(path.join(root, 'pages', '__view', 'plain', '+Page.tsx')))
  })

  it('is idempotent — second call leaves files untouched', () => {
    root = scaffold('react')
    process.chdir(root)
    syncViewsFromDisk()
    const stubPath = path.join(root, 'pages', '__view', 'home', '+Page.tsx')
    const mtime1 = fs.statSync(stubPath).mtimeMs

    // Wait briefly so a real fs write would change mtime, then re-sync.
    const sleep = (): Promise<void> => new Promise(r => setTimeout(r, 20))
    return sleep().then(() => {
      syncViewsFromDisk()
      const mtime2 = fs.statSync(stubPath).mtimeMs
      assert.equal(mtime1, mtime2, 'idempotent sync must not rewrite unchanged files')
    })
  })
})
