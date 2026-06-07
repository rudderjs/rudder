// Scanner WATCHER wiring: the views/routes/env scanner suites cover the
// construction-time sync thoroughly, but nothing fired the dev-server watcher
// — a regression in configureServer (listener not registered, path filter
// inverted, wrong watched path) passed every test. These tests drive each
// plugin's configureServer with a fake Vite server (same shape as
// plugins.test.ts's FakeWatcher) and assert a watcher event re-emits the
// generated output — and that non-matching events do NOT.

import { describe, it, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { envScannerPlugin } from './env-scanner.js'
import { routesScannerPlugin } from './routes-scanner.js'
import { viewsScannerPlugin } from './views-scanner.js'

// ── Fakes (subset of plugins.test.ts's FakeServer — these three plugins
//     only ever touch server.watcher) ───────────────────────

class FakeWatcher {
  private listeners: Record<string, Array<(file: string) => void>> = {}
  public added: string[] = []
  add(p: string): void { this.added.push(p) }
  on(event: string, listener: (file: string) => void): void {
    (this.listeners[event] ??= []).push(listener)
  }
  fire(event: string, file: string): void {
    for (const fn of this.listeners[event] ?? []) fn(file)
  }
}

function makeServer(): { watcher: FakeWatcher } {
  return { watcher: new FakeWatcher() }
}

type ConfigureServer = (server: unknown) => void

const prevCwd = process.cwd()
let root = ''

/** Scratch project root; realpath'd so cwd-derived paths match what we fire. */
function scaffold(prefix: string): string {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)))
  return root
}

function write(rel: string, contents: string): void {
  const file = path.join(root, rel)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, contents)
}

function read(rel: string): string {
  return fs.readFileSync(path.join(root, rel), 'utf8')
}

afterEach(() => {
  process.chdir(prevCwd)
  if (root) fs.rmSync(root, { recursive: true, force: true })
  root = ''
})

// ── env-scanner ───────────────────────────────────────────

describe('env-scanner — configureServer watcher re-syncs on .env.example changes', () => {
  it('watches .env.example and re-emits env.d.ts when it changes', () => {
    scaffold('rudderjs-env-watch-')
    write('.env.example', 'FIRST_KEY=1\n')
    process.chdir(root)

    const plugin = envScannerPlugin() // eager sync at construction
    const server = makeServer()
    ;(plugin.configureServer as ConfigureServer)(server)

    const example = path.join(root, '.env.example')
    assert.ok(server.watcher.added.includes(example), '.env.example must be added to the watcher')
    assert.match(read('.rudder/types/env.d.ts'), /FIRST_KEY/)

    write('.env.example', 'FIRST_KEY=1\nSECOND_KEY=2\n')
    server.watcher.fire('change', example)
    assert.match(read('.rudder/types/env.d.ts'), /SECOND_KEY/, 'watcher change event must re-scan')
  })

  it('ignores events for other files', () => {
    scaffold('rudderjs-env-watch-')
    write('.env.example', 'FIRST_KEY=1\n')
    process.chdir(root)

    const plugin = envScannerPlugin()
    const server = makeServer()
    ;(plugin.configureServer as ConfigureServer)(server)

    write('.env.example', 'FIRST_KEY=1\nSECOND_KEY=2\n')
    server.watcher.fire('change', path.join(root, '.env')) // not the example file
    assert.doesNotMatch(read('.rudder/types/env.d.ts'), /SECOND_KEY/, 'non-example events must not re-scan')
  })

  it('unlink of .env.example removes the stale registry', () => {
    scaffold('rudderjs-env-watch-')
    write('.env.example', 'FIRST_KEY=1\n')
    process.chdir(root)

    const plugin = envScannerPlugin()
    const server = makeServer()
    ;(plugin.configureServer as ConfigureServer)(server)
    assert.ok(fs.existsSync(path.join(root, '.rudder/types/env.d.ts')))

    fs.rmSync(path.join(root, '.env.example'))
    server.watcher.fire('unlink', path.join(root, '.env.example'))
    assert.ok(!fs.existsSync(path.join(root, '.rudder/types/env.d.ts')), 'registry must not outlive the contract file')
  })
})

// ── routes-scanner ────────────────────────────────────────

describe('routes-scanner — configureServer watcher re-scans routes/', () => {
  it('watches routes/ and re-emits routes.d.ts on change', () => {
    scaffold('rudderjs-routes-watch-')
    write('routes/web.ts', `router.get('/dashboard', h).name('dashboard')\n`)
    process.chdir(root)

    const plugin = routesScannerPlugin()
    const server = makeServer()
    ;(plugin.configureServer as ConfigureServer)(server)

    const routesDir = path.join(root, 'routes')
    assert.ok(server.watcher.added.includes(routesDir), 'routes/ must be added to the watcher')
    assert.match(read('.rudder/types/routes.d.ts'), /dashboard/)

    write('routes/web.ts', [
      `router.get('/dashboard', h).name('dashboard')`,
      `router.get('/billing', h).name('billing')`,
      '',
    ].join('\n'))
    server.watcher.fire('change', path.join(routesDir, 'web.ts'))
    assert.match(read('.rudder/types/routes.d.ts'), /billing/, 'watcher change event must re-scan')
  })

  it('add and unlink events re-scan too; out-of-dir events do not', () => {
    scaffold('rudderjs-routes-watch-')
    write('routes/web.ts', `router.get('/a', h).name('a')\n`)
    process.chdir(root)

    const plugin = routesScannerPlugin()
    const server = makeServer()
    ;(plugin.configureServer as ConfigureServer)(server)

    // add: a new file in routes/
    write('routes/api.ts', `router.get('/api/b', h).name('b')\n`)
    server.watcher.fire('add', path.join(root, 'routes', 'api.ts'))
    assert.match(read('.rudder/types/routes.d.ts'), /'b'/)

    // out-of-dir change: must NOT pick up further edits
    write('routes/api.ts', `router.get('/api/c', h).name('c')\n`)
    server.watcher.fire('change', path.join(root, 'app', 'Http', 'web.ts'))
    assert.doesNotMatch(read('.rudder/types/routes.d.ts'), /'c'/, 'events outside routes/ must not re-scan')

    // unlink: removing the file drops its routes on the next event
    fs.rmSync(path.join(root, 'routes', 'api.ts'))
    server.watcher.fire('unlink', path.join(root, 'routes', 'api.ts'))
    assert.doesNotMatch(read('.rudder/types/routes.d.ts'), /'b'/)
  })
})

// ── views-scanner ─────────────────────────────────────────

describe('views-scanner — configureServer watcher re-generates pages/__view', () => {
  it('re-scans when a view file is added (vanilla framework)', () => {
    scaffold('rudderjs-views-watch-')
    write('package.json', JSON.stringify({ name: 'fixture' }))
    write('app/Views/Home.ts', '// placeholder\n')
    fs.mkdirSync(path.join(root, 'pages'), { recursive: true })
    process.chdir(root)

    const plugin = viewsScannerPlugin() // eager sync sees only Home
    const server = makeServer()
    ;(plugin.configureServer as ConfigureServer)(server)

    const viewsRoot = path.join(root, 'app', 'Views')
    assert.ok(server.watcher.added.includes(viewsRoot), 'app/Views must be added to the watcher')
    assert.ok(fs.existsSync(path.join(root, 'pages', '__view', 'home')))
    assert.ok(!fs.existsSync(path.join(root, 'pages', '__view', 'about')))

    write('app/Views/About.ts', '// placeholder\n')
    server.watcher.fire('add', path.join(viewsRoot, 'About.ts'))
    assert.ok(
      fs.existsSync(path.join(root, 'pages', '__view', 'about')),
      'watcher add event must re-generate the page stubs',
    )
  })

  it('filters non-view extensions and out-of-root paths', () => {
    scaffold('rudderjs-views-watch-')
    write('package.json', JSON.stringify({ name: 'fixture' }))
    write('app/Views/Home.ts', '// placeholder\n')
    fs.mkdirSync(path.join(root, 'pages'), { recursive: true })
    process.chdir(root)

    const plugin = viewsScannerPlugin()
    const server = makeServer()
    ;(plugin.configureServer as ConfigureServer)(server)

    write('app/Views/About.ts', '// placeholder\n')
    // Wrong extension → filtered before the scan.
    server.watcher.fire('add', path.join(root, 'app', 'Views', 'notes.txt'))
    assert.ok(!fs.existsSync(path.join(root, 'pages', '__view', 'about')))
    // Right extension, outside app/Views → filtered.
    server.watcher.fire('add', path.join(root, 'app', 'Models', 'About.ts'))
    assert.ok(!fs.existsSync(path.join(root, 'pages', '__view', 'about')))
    // The real event lands → re-scan happens.
    server.watcher.fire('change', path.join(root, 'app', 'Views', 'About.ts'))
    assert.ok(fs.existsSync(path.join(root, 'pages', '__view', 'about')))
  })

  it('unlink of the last view shrinks the registry back', () => {
    scaffold('rudderjs-views-watch-')
    write('package.json', JSON.stringify({ name: 'fixture' }))
    write('app/Views/Home.ts', 'export interface Props { title: string }\n')
    fs.mkdirSync(path.join(root, 'pages'), { recursive: true })
    process.chdir(root)

    const plugin = viewsScannerPlugin()
    const server = makeServer()
    ;(plugin.configureServer as ConfigureServer)(server)
    assert.match(read('.rudder/types/views.d.ts'), /home/)

    fs.rmSync(path.join(root, 'app', 'Views', 'Home.ts'))
    server.watcher.fire('unlink', path.join(root, 'app', 'Views', 'Home.ts'))
    assert.doesNotMatch(read('.rudder/types/views.d.ts'), /'home'/, 'registry must shrink when the view is deleted')
  })
})
