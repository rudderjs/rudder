import { describe, it, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'

import {
  scanRouteFiles,
  routesRegistrySource,
  syncRoutesFromDisk,
  routesScannerPlugin,
  type DiscoveredNamedRoute,
} from './routes-scanner.js'

function scaffold(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'rudderjs-routes-scanner-'))
  mkdirSync(path.join(root, 'routes'), { recursive: true })
  return root
}

function write(root: string, rel: string, contents: string): void {
  const full = path.join(root, rel)
  mkdirSync(path.dirname(full), { recursive: true })
  writeFileSync(full, contents)
}

describe('routes-scanner — scanRouteFiles', () => {
  let root = ''
  afterEach(() => { if (root) rmSync(root, { recursive: true, force: true }); root = '' })

  it('extracts (verb, path, name) from `Route.<verb>(path, ...).name(name)` chains', () => {
    root = scaffold()
    write(root, 'routes/web.ts', `
      import { Route } from '@rudderjs/router'
      Route.get('/users/:id', async () => ({ ok: true })).name('users.show')
      Route.post('/posts',    async () => ({ ok: true })).name('posts.store')
    `)
    const out = scanRouteFiles(path.join(root, 'routes'))
    assert.equal(out.length, 2)
    assert.deepEqual(picks(out), [
      { name: 'posts.store', path: '/posts',      verb: 'post' },
      { name: 'users.show',  path: '/users/:id',  verb: 'get'  },
    ])
  })

  it('extracts from `router.<verb>(path, ...).name(name)` chains', () => {
    root = scaffold()
    write(root, 'routes/web.ts', `
      export default (router) => {
        router.get('/dashboard', handler).name('dashboard')
      }
    `)
    const out = scanRouteFiles(path.join(root, 'routes'))
    assert.equal(out.length, 1)
    assert.equal(out[0]?.name, 'dashboard')
    assert.equal(out[0]?.path, '/dashboard')
  })

  it('tolerates multi-line chains with handlers + middleware', () => {
    root = scaffold()
    write(root, 'routes/web.ts', `
      Route.get(
        '/users/:id',
        async (req) => view('users.show', { id: req.params.id }),
        [SomeMiddleware()],
      ).name('users.show')
    `)
    const out = scanRouteFiles(path.join(root, 'routes'))
    assert.equal(out.length, 1)
    assert.equal(out[0]?.name, 'users.show')
    assert.equal(out[0]?.path, '/users/:id')
  })

  it('skips variable paths silently', () => {
    root = scaffold()
    write(root, 'routes/web.ts', `
      const path = '/users/:id'
      router.get(path, handler).name('users.show')   // skipped — non-literal path
      Route.get('/posts', handler).name('posts.index') // picked up
    `)
    const out = scanRouteFiles(path.join(root, 'routes'))
    assert.equal(out.length, 1)
    assert.equal(out[0]?.name, 'posts.index')
  })

  it('handles all 8 verbs (get / post / put / patch / delete / all / head / options)', () => {
    root = scaffold()
    write(root, 'routes/web.ts', `
      Route.get('/a',     handler).name('a')
      Route.post('/b',    handler).name('b')
      Route.put('/c',     handler).name('c')
      Route.patch('/d',   handler).name('d')
      Route.delete('/e',  handler).name('e')
      Route.all('/f',     handler).name('f')
      Route.head('/g',    handler).name('g')
      Route.options('/h', handler).name('h')
    `)
    const out = scanRouteFiles(path.join(root, 'routes'))
    assert.equal(out.length, 8)
  })

  it('does NOT bridge across chains — unnamed chain followed by named chain', () => {
    // Regression: an early regex bridged the path from an unnamed chain to
    // the name of a later chain. The negative-lookahead now bails when the
    // body sees another Route.<verb>( before reaching .name().
    root = scaffold()
    write(root, 'routes/web.ts', `
      Route.get('/', async () => view('welcome', {
        appName: 'Demo',
      }))

      Route.get('/about', h)

      Route.get('/demos', async () => view('demos.index')).name('demos.index')
    `)
    const out = scanRouteFiles(path.join(root, 'routes'))
    assert.equal(out.length, 1)
    assert.equal(out[0]?.name, 'demos.index')
    assert.equal(out[0]?.path, '/demos', 'must match the path on the SAME chain as .name, not from an earlier unnamed chain')
  })

  it('dedups across files; first-write-wins on conflicting paths', () => {
    root = scaffold()
    write(root, 'routes/web.ts', `Route.get('/users/:id', h).name('users.show')`)
    write(root, 'routes/api.ts', `Route.get('/different', h).name('users.show')`)
    const out = scanRouteFiles(path.join(root, 'routes'))
    const winner = out.find(r => r.name === 'users.show')!
    assert.ok(winner)
    // web.ts is alphabetically AFTER api.ts; we sort files ascending so api.ts
    // runs first and wins.
    assert.equal(winner.path, '/different')
  })

  it('walks nested directories', () => {
    root = scaffold()
    write(root, 'routes/admin/users.ts', `Route.get('/admin/users', h).name('admin.users.index')`)
    const out = scanRouteFiles(path.join(root, 'routes'))
    assert.equal(out.length, 1)
    assert.equal(out[0]?.name, 'admin.users.index')
  })

  it('returns empty array when routes/ is missing', () => {
    root = scaffold()
    rmSync(path.join(root, 'routes'), { recursive: true })
    assert.deepEqual(scanRouteFiles(path.join(root, 'routes')), [])
  })
})

describe('routes-scanner — routesRegistrySource emission', () => {
  it('emits a module augmentation with entries', () => {
    const routes: DiscoveredNamedRoute[] = [
      { name: 'users.show', path: '/users/:id', verb: 'get',  source: 'routes/web.ts' },
      { name: 'posts.store', path: '/posts',    verb: 'post', source: 'routes/api.ts' },
    ]
    const src = routesRegistrySource(routes)
    assert.match(src, /declare module '@rudderjs\/router'/)
    assert.match(src, /interface RouteRegistry \{/)
    assert.match(src, /'users\.show':\s*'\/users\/:id'/)
    assert.match(src, /'posts\.store':\s*'\/posts'/)
  })

  it('emits an empty registry when there are no routes', () => {
    const src = routesRegistrySource([])
    assert.match(src, /declare module '@rudderjs\/router'/)
    assert.match(src, /interface RouteRegistry \{\s*\}/)
  })
})

describe('routes-scanner — syncRoutesFromDisk', () => {
  let root = ''
  const prevCwd = process.cwd()

  afterEach(() => {
    process.chdir(prevCwd)
    if (root) rmSync(root, { recursive: true, force: true })
    root = ''
  })

  it('writes the registry to pages/__view/routes.d.ts and returns the count', () => {
    root = scaffold()
    write(root, 'routes/web.ts', `Route.get('/about', h).name('about')`)
    process.chdir(root)
    const result = syncRoutesFromDisk()
    assert.equal(result.routesDirExists, true)
    assert.equal(result.routeCount, 1)
    const out = fs.readFileSync(path.join(root, 'pages', '__view', 'routes.d.ts'), 'utf8')
    assert.match(out, /'about':\s*'\/about'/)
  })

  it('returns routesDirExists=false when there is no routes/ folder', () => {
    root = scaffold()
    rmSync(path.join(root, 'routes'), { recursive: true })
    process.chdir(root)
    const result = syncRoutesFromDisk()
    assert.equal(result.routesDirExists, false)
    assert.equal(result.routeCount, 0)
  })
})

describe('routes-scanner — plugin', () => {
  let root = ''
  const prevCwd = process.cwd()

  afterEach(() => {
    process.chdir(prevCwd)
    if (root) rmSync(root, { recursive: true, force: true })
    root = ''
  })

  it('eager-syncs at construction time', () => {
    root = scaffold()
    write(root, 'routes/web.ts', `Route.get('/eager', h).name('eager')`)
    process.chdir(root)
    routesScannerPlugin()
    const out = fs.readFileSync(path.join(root, 'pages', '__view', 'routes.d.ts'), 'utf8')
    assert.match(out, /'eager':\s*'\/eager'/)
  })
})

function picks(rs: DiscoveredNamedRoute[]): Array<Pick<DiscoveredNamedRoute, 'name' | 'path' | 'verb'>> {
  return rs.map(({ name, path, verb }) => ({ name, path, verb }))
}
