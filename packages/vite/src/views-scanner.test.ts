import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { viewsScannerPlugin } from './views-scanner.js'

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

  it('honors `export const route` inside a Vue <script setup> block', () => {
    root = scaffold('vue')
    fs.writeFileSync(
      path.join(root, 'app', 'Views', 'Home.vue'),
      `<script setup lang="ts">\nexport const route = '/dashboard'\n</script>\n<template><div /></template>\n`,
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
