import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import type { Plugin } from 'vite'
import { rudderjs } from './index.js'

// ── Minimal Vite-server fakes ─────────────────────────────

type MiddlewareFn = (
  req: { headers: Record<string, string | string[] | undefined>; socket?: { remoteAddress?: string } },
  res: unknown,
  next: () => void,
) => void

class MiddlewareStack {
  private fns: MiddlewareFn[] = []
  use(fn: MiddlewareFn): void { this.fns.push(fn) }
  run(req: Parameters<MiddlewareFn>[0]): void {
    for (const fn of this.fns) fn(req, {}, () => undefined)
  }
}

class FakeWatcher {
  private listeners: Record<string, Array<(arg: string) => void>> = {}
  public added: string[] = []
  add(path: string): void { this.added.push(path) }
  on(event: string, listener: (file: string) => void): void {
    if (!this.listeners[event]) this.listeners[event] = []
    this.listeners[event]!.push(listener)
  }
  fire(event: string, file: string): void {
    for (const fn of this.listeners[event] ?? []) fn(file)
  }
}

interface FakeServer {
  middlewares: MiddlewareStack
  watcher:     FakeWatcher
  httpServer:  { on(event: string, listener: (...args: unknown[]) => void): void } | null
  environments: { ssr: { moduleGraph: {
    invalidateAll: () => void
    invalidated: number
    getModulesByFile: (file: string) => undefined
    invalidateModule: (mod: unknown) => void
  } } }
  hot:         { sent: Array<{ type: string }>, send: (msg: { type: string }) => void }
}

function makeServer(httpServer: FakeServer['httpServer'] = null): FakeServer {
  const ssrInvalidations = { invalidated: 0 }
  return {
    middlewares: new MiddlewareStack(),
    watcher:     new FakeWatcher(),
    httpServer,
    environments: {
      // getModulesByFile returns undefined → the watcher falls back to
      // invalidateAll() (these tests cover the watcher wiring + fallback; the
      // scoped-invalidation walk is unit-tested in index.test.ts).
      ssr: { moduleGraph: {
        invalidateAll: () => { ssrInvalidations.invalidated++ },
        invalidated: ssrInvalidations.invalidated,
        getModulesByFile: () => undefined,
        invalidateModule: () => {},
      } },
    },
    hot: {
      sent: [],
      send(msg) { this.sent.push(msg) },
    },
  }
}

async function findPlugin(name: string): Promise<Plugin> {
  const plugins = await rudderjs()
  const p = plugins.find(x => x.name === name)
  assert.ok(p, `plugin ${name} should exist`)
  return p as Plugin
}

// ── rudderjs:ip ───────────────────────────────────────────

describe("rudderjs:ip — middleware injects x-real-ip", () => {
  it('sets x-real-ip from req.socket.remoteAddress when not already set', async () => {
    const plugin = await findPlugin('rudderjs:ip')
    const server = makeServer()
    ;(plugin.configureServer as (s: unknown) => void)(server)

    const req = {
      headers: {} as Record<string, string | string[] | undefined>,
      socket:  { remoteAddress: '203.0.113.42' },
    }
    server.middlewares.run(req)
    assert.equal(req.headers['x-real-ip'], '203.0.113.42')
  })

  it('does NOT overwrite an existing x-real-ip header', async () => {
    const plugin = await findPlugin('rudderjs:ip')
    const server = makeServer()
    ;(plugin.configureServer as (s: unknown) => void)(server)

    const req = {
      headers: { 'x-real-ip': '10.0.0.1' } as Record<string, string | string[] | undefined>,
      socket:  { remoteAddress: '203.0.113.42' },
    }
    server.middlewares.run(req)
    assert.equal(req.headers['x-real-ip'], '10.0.0.1')
  })

  it('does NOT inject when x-forwarded-for is already set (proxy chain)', async () => {
    const plugin = await findPlugin('rudderjs:ip')
    const server = makeServer()
    ;(plugin.configureServer as (s: unknown) => void)(server)

    const req = {
      headers: { 'x-forwarded-for': '198.51.100.7' } as Record<string, string | string[] | undefined>,
      socket:  { remoteAddress: '203.0.113.42' },
    }
    server.middlewares.run(req)
    assert.equal(req.headers['x-real-ip'], undefined)
  })

  it('no-op when req has no socket info', async () => {
    const plugin = await findPlugin('rudderjs:ip')
    const server = makeServer()
    ;(plugin.configureServer as (s: unknown) => void)(server)

    const req = {
      headers: {} as Record<string, string | string[] | undefined>,
    }
    server.middlewares.run(req)
    assert.equal(req.headers['x-real-ip'], undefined)
  })
})

// ── rudderjs:routes ───────────────────────────────────────

describe("rudderjs:routes — file watcher invalidates SSR + clears singletons", () => {
  const cwd = process.cwd()

  beforeEach(() => {
    const g = globalThis as Record<string, unknown>
    g['__rudderjs_instance__'] = { stub: true }
    g['__rudderjs_app__']      = { stub: true }
  })

  afterEach(() => {
    const g = globalThis as Record<string, unknown>
    delete g['__rudderjs_instance__']
    delete g['__rudderjs_app__']
  })

  it('registers the three watch directories with the Vite watcher', async () => {
    const plugin = await findPlugin('rudderjs:routes')
    const server = makeServer()
    ;(plugin.configureServer as (s: unknown) => void)(server)

    const expected = ['routes', 'bootstrap', 'app'].map(d => path.resolve(cwd, d))
    for (const e of expected) {
      assert.ok(server.watcher.added.includes(e), `should watch ${e}`)
    }
  })

  it('change in routes/ invalidates SSR + clears globalThis singletons + sends full-reload', async () => {
    const plugin = await findPlugin('rudderjs:routes')
    const server = makeServer()
    ;(plugin.configureServer as (s: unknown) => void)(server)

    let invalidated = 0
    server.environments.ssr.moduleGraph.invalidateAll = () => { invalidated++ }

    server.watcher.fire('change', path.join(cwd, 'routes', 'web.ts'))

    const g = globalThis as Record<string, unknown>
    assert.equal(g['__rudderjs_instance__'], undefined)
    assert.equal(g['__rudderjs_app__'], undefined)
    assert.equal(invalidated, 1)
    assert.deepEqual(server.hot.sent, [{ type: 'full-reload' }])
  })

  it('ignores changes outside the watched directories', async () => {
    const plugin = await findPlugin('rudderjs:routes')
    const server = makeServer()
    ;(plugin.configureServer as (s: unknown) => void)(server)

    let invalidated = 0
    server.environments.ssr.moduleGraph.invalidateAll = () => { invalidated++ }

    server.watcher.fire('change', path.join(cwd, 'node_modules', 'some-pkg', 'index.js'))
    server.watcher.fire('change', path.join(cwd, 'pages', '+Page.tsx'))
    server.watcher.fire('change', path.join(cwd, 'some-file.txt'))

    const g = globalThis as Record<string, unknown>
    assert.deepEqual(g['__rudderjs_instance__'], { stub: true }, 'singleton should NOT be cleared')
    assert.equal(invalidated, 0, 'SSR should NOT be invalidated')
    assert.deepEqual(server.hot.sent, [], 'no full-reload signal')
  })

  it('skips re-bootstrap for app/Views/** edits — Vike handles HMR natively', async () => {
    const plugin = await findPlugin('rudderjs:routes')
    const server = makeServer()
    ;(plugin.configureServer as (s: unknown) => void)(server)

    let invalidated = 0
    server.environments.ssr.moduleGraph.invalidateAll = () => { invalidated++ }

    server.watcher.fire('change', path.join(cwd, 'app', 'Views', 'Home.tsx'))
    server.watcher.fire('change', path.join(cwd, 'app', 'Views', 'Auth', 'Login.tsx'))

    const g = globalThis as Record<string, unknown>
    assert.deepEqual(g['__rudderjs_instance__'], { stub: true }, 'singleton should NOT be cleared for view edits')
    assert.deepEqual(g['__rudderjs_app__'], { stub: true }, 'app singleton should NOT be cleared for view edits')
    assert.equal(invalidated, 0, 'SSR should NOT be invalidated for view edits')
    assert.deepEqual(server.hot.sent, [], 'no full-reload — Vike component HMR handles it')
  })

  it('still re-bootstraps for non-view app/ edits (models, controllers, etc.)', async () => {
    const plugin = await findPlugin('rudderjs:routes')
    const server = makeServer()
    ;(plugin.configureServer as (s: unknown) => void)(server)

    let invalidated = 0
    server.environments.ssr.moduleGraph.invalidateAll = () => { invalidated++ }

    server.watcher.fire('change', path.join(cwd, 'app', 'Models', 'User.ts'))

    const g = globalThis as Record<string, unknown>
    assert.equal(g['__rudderjs_instance__'], undefined, 'singleton cleared for model edits')
    assert.equal(invalidated, 1)
    assert.deepEqual(server.hot.sent, [{ type: 'full-reload' }])
  })
})

// ── rudderjs:ws ───────────────────────────────────────────

describe('rudderjs:ws — buffers early upgrade requests', () => {
  const SENTINEL = '__rudderjs_http_upgrade_patched__'
  const HANDLER  = '__rudderjs_ws_upgrade__'

  beforeEach(() => {
    const g = globalThis as Record<string, unknown>
    delete g[SENTINEL]
    delete g[HANDLER]
  })

  afterEach(() => {
    const g = globalThis as Record<string, unknown>
    delete g[SENTINEL]
    delete g[HANDLER]
  })

  it('sets the dual-registration sentinel on configureServer', async () => {
    const plugin = await findPlugin('rudderjs:ws')
    const httpServer = { on: () => undefined }
    const server = makeServer(httpServer)
    ;(plugin.configureServer as (s: unknown) => void)(server)

    const g = globalThis as Record<string, unknown>
    assert.equal(g[SENTINEL], true)
  })

  it('early-returns when sentinel is already set (no duplicate listener)', async () => {
    const plugin = await findPlugin('rudderjs:ws')
    const g = globalThis as Record<string, unknown>
    g[SENTINEL] = true

    let listenerCount = 0
    const httpServer = {
      on(_event: string, _listener: unknown) { listenerCount++ },
    }
    const server = makeServer(httpServer)
    ;(plugin.configureServer as (s: unknown) => void)(server)

    assert.equal(listenerCount, 0, 'should not attach a duplicate upgrade listener')
  })
})
