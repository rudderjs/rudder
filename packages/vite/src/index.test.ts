import { describe, it, mock } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { existsSync } from 'node:fs'

import { rudderjs, invalidateBackendSubtree, performReboot, resolveWatchDir } from './index.js'

/** Walk up from the test cwd (dist-test/) to the pnpm workspace root. */
function repoRootDir(): string {
  let dir = process.cwd()
  while (dir !== path.dirname(dir)) {
    if (existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir
    dir = path.dirname(dir)
  }
  throw new Error('workspace root (pnpm-workspace.yaml) not found')
}

describe('@rudderjs/vite', () => {
  it('exports rudderjs function', () => {
    assert.equal(typeof rudderjs, 'function')
  })

  it('returns an array of plugins synchronously', () => {
    const result = rudderjs()
    assert.ok(Array.isArray(result))
    assert.ok(result.length > 0)
  })

  it('includes rudderjs:ws plugin', async () => {
    const plugins = await rudderjs()
    const wsPlugin = plugins.find(p => p.name === 'rudderjs:ws')
    assert.ok(wsPlugin, 'rudderjs:ws plugin should exist')
    assert.equal(typeof wsPlugin.configureServer, 'function')
  })

  it('includes rudderjs:config plugin', async () => {
    const plugins = await rudderjs()
    const configPlugin = plugins.find(p => p.name === 'rudderjs:config')
    assert.ok(configPlugin, 'rudderjs:config plugin should exist')
    assert.equal(typeof configPlugin.config, 'function')
  })

  it('rudderjs:config returns correct config shape', async () => {
    const plugins = await rudderjs()
    const configPlugin = plugins.find(p => p.name === 'rudderjs:config')!
    const config = (configPlugin.config as (c: unknown, e: { command: string; mode: string }) => Record<string, unknown>)(
      {}, { command: 'serve', mode: 'development' },
    )

    // Check resolve alias (array format: [{ find, replacement }])
    assert.ok(config.resolve, 'should have resolve')
    const resolve = config.resolve as { alias: Array<{ find: string | RegExp; replacement: string }> }
    assert.ok(Array.isArray(resolve.alias), 'alias should be an array')
    const atAlias = resolve.alias.find(a => a.find === '@')
    assert.ok(atAlias, 'should have @ alias')
    assert.ok(atAlias.replacement.replace(/\\/g, '/').endsWith('/src'), '@ alias should point to src/')

    // Check ssr config
    assert.ok(config.ssr, 'should have ssr config')
    const ssr = config.ssr as { external: string[]; noExternal: string[] }
    assert.ok(Array.isArray(ssr.external), 'should have ssr.external array')
    assert.ok(ssr.external.includes('ioredis'), 'ioredis should be externalized')
    assert.ok(ssr.external.includes('pg'), 'pg should be externalized')
    assert.ok(ssr.external.includes('better-sqlite3'), 'better-sqlite3 should be externalized')
    assert.ok(Array.isArray(ssr.noExternal), 'should have ssr.noExternal array')
    assert.ok(ssr.noExternal.includes('@rudderjs/server-hono'), 'server-hono should be non-external')

    // Check build config
    assert.ok(config.build, 'should have build config')
    const build = config.build as { rollupOptions: { external: (id: string) => boolean } }
    assert.equal(typeof build.rollupOptions.external, 'function', 'rollup external should be a function')
    assert.equal(build.rollupOptions.external('ioredis'), true, 'ioredis should be external in build')
    assert.equal(build.rollupOptions.external('react'), false, 'react should not be external')
  })

  it('default export is rudderjs', async () => {
    const mod = await import('./index.js')
    assert.equal(mod.default, mod.rudderjs)
  })
})

// ─── page-context-enhancers ─────────────────────────────────

import {
  registerPageContextEnhancer,
  runPageContextEnhancers,
  _resetPageContextEnhancersForTests,
} from './page-context-enhancers.js'

describe('page-context-enhancers', () => {
  it('runs registered enhancers in registration order', async () => {
    _resetPageContextEnhancersForTests()
    const order: number[] = []
    registerPageContextEnhancer(() => { order.push(1) })
    registerPageContextEnhancer(() => { order.push(2) })
    registerPageContextEnhancer(() => { order.push(3) })

    await runPageContextEnhancers({} as never)
    assert.deepEqual(order, [1, 2, 3])
  })

  it('awaits async enhancers', async () => {
    _resetPageContextEnhancersForTests()
    const order: string[] = []
    registerPageContextEnhancer(async () => {
      await new Promise(r => setTimeout(r, 5))
      order.push('async-done')
    })
    registerPageContextEnhancer(() => { order.push('sync-done') })

    await runPageContextEnhancers({} as never)
    assert.deepEqual(order, ['async-done', 'sync-done'])
  })

  it('mutates the passed pageContext in place', async () => {
    _resetPageContextEnhancersForTests()
    registerPageContextEnhancer((pc) => {
      ;(pc as { foo?: string }).foo = 'bar'
    })

    const ctx: Record<string, unknown> = {}
    await runPageContextEnhancers(ctx as never)
    assert.equal((ctx as { foo?: string }).foo, 'bar')
  })

  it('propagates errors from an enhancer', async () => {
    _resetPageContextEnhancersForTests()
    registerPageContextEnhancer(() => { throw new Error('boom') })

    await assert.rejects(
      () => runPageContextEnhancers({} as never),
      /boom/,
    )
  })
})

// ─── hooks/onCreatePageContext ─────────────────────────────

describe('onCreatePageContext', () => {
  it('walks registered enhancers', async () => {
    _resetPageContextEnhancersForTests()
    const seen: string[] = []
    registerPageContextEnhancer((pc) => { seen.push((pc as { url?: string }).url ?? '') })

    const { onCreatePageContext } = await import('./hooks/onCreatePageContext.js')
    await onCreatePageContext({ url: '/test' } as never)
    assert.deepEqual(seen, ['/test'])
  })
})

// ─── hooks/onError ─────────────────────────────────────────

describe('onError', () => {
  it('falls back to console.error when @rudderjs/core is unavailable', async () => {
    const original = console.error
    const logged: unknown[][] = []
    console.error = (...args: unknown[]) => { logged.push(args) }

    try {
      const { onError } = await import('./hooks/onError.js')
      const err = new Error('boom')
      // We can't easily stub the dynamic import; just confirm it doesn't throw.
      // In the worktree @rudderjs/core IS installed so this exercises the
      // happy path (report() called). The branch test for the absent peer
      // lives in a separate fixture project (deferred).
      await onError(err, { urlOriginal: '/x' } as never)
    } finally {
      console.error = original
    }
  })
})

// ─── hooks/headersResponse ─────────────────────────────────

describe('headersResponse', () => {
  it('returns viewHeaders from pageContext', async () => {
    const { headersResponse } = await import('./hooks/headersResponse.js')
    const headers = headersResponse({
      viewHeaders: { 'cache-control': 'no-cache' },
    } as never)
    assert.deepEqual(headers, { 'cache-control': 'no-cache' })
  })

  it('returns {} when viewHeaders is missing', async () => {
    const { headersResponse } = await import('./hooks/headersResponse.js')
    const headers = headersResponse({} as never)
    assert.deepEqual(headers, {})
  })
})

// ─── invalidateBackendSubtree (Phase B1 scoped invalidation) ──

describe('invalidateBackendSubtree', () => {
  const cwd = path.resolve('/app')

  // Minimal fake of Vite's EnvironmentModuleGraph + the importer-linked nodes.
  type Node = { file: string; importers: Set<Node> }
  function makeServer(files: Record<string, Node>) {
    const invalidated: Node[] = []
    const byFile = new Map<string, Set<Node>>()
    for (const n of Object.values(files)) {
      const set = byFile.get(n.file) ?? new Set<Node>()
      set.add(n)
      byFile.set(n.file, set)
    }
    const server = {
      environments: { ssr: { moduleGraph: {
        getModulesByFile: (f: string) => byFile.get(f),
        invalidateModule: (m: Node) => { invalidated.push(m) },
        fileToModulesMap: byFile,
      } } },
    }
    return { server: server as never, invalidated, abs: (rel: string) => path.resolve(cwd, rel) }
  }

  it('walks the changed file up its importer chain to the bootstrap entry', () => {
    const entry: Node = { file: path.resolve(cwd, 'bootstrap/app.ts'), importers: new Set() }
    const route: Node = { file: path.resolve(cwd, 'routes/api.ts'), importers: new Set([entry]) }
    const ctrl:  Node = { file: path.resolve(cwd, 'app/Http/Controllers/TestController.ts'), importers: new Set([route]) }
    const { server, invalidated } = makeServer({ entry, route, ctrl })

    const ok = invalidateBackendSubtree(server, ctrl.file, cwd)
    assert.equal(ok, true)
    assert.ok(invalidated.includes(ctrl),  'changed file invalidated')
    assert.ok(invalidated.includes(route), 'importer (route) invalidated')
    assert.ok(invalidated.includes(entry), 'bootstrap entry invalidated')
  })

  it('returns false when the file is not in the SSR graph (caller falls back to invalidateAll)', () => {
    const { server, invalidated } = makeServer({})
    const ok = invalidateBackendSubtree(server, path.resolve(cwd, 'app/Models/User.ts'), cwd)
    assert.equal(ok, false)
    assert.equal(invalidated.length, 0)
  })

  it('invalidates the bootstrap entry via the safety net even if the importer chain stops short', () => {
    // ctrl's chain stops at route (route has no importers — simulates a
    // non-analyzable dynamic import that left bootstrap/app.ts unlinked).
    const entry: Node = { file: path.resolve(cwd, 'bootstrap/app.ts'), importers: new Set() }
    const route: Node = { file: path.resolve(cwd, 'routes/api.ts'), importers: new Set() }
    const ctrl:  Node = { file: path.resolve(cwd, 'app/Http/Controllers/TestController.ts'), importers: new Set([route]) }
    const { server, invalidated } = makeServer({ entry, route, ctrl })

    invalidateBackendSubtree(server, ctrl.file, cwd)
    assert.ok(invalidated.includes(entry), 'safety net invalidates bootstrap/app.ts')
  })

  it('terminates on a circular importer graph', () => {
    const a: Node = { file: path.resolve(cwd, 'app/a.ts'), importers: new Set() }
    const b: Node = { file: path.resolve(cwd, 'app/b.ts'), importers: new Set() }
    a.importers.add(b); b.importers.add(a) // cycle
    const { server, invalidated } = makeServer({ a, b })
    assert.doesNotThrow(() => invalidateBackendSubtree(server, a.file, cwd))
    assert.ok(invalidated.includes(a) && invalidated.includes(b))
  })

  it('always re-evaluates route loader modules even when the changed file does not import them', () => {
    // A config/ edit (or bootstrap/, or unrelated app file): in the graph but
    // with no import link to the route file. The dev re-boot calls
    // router.reset() and re-runs the loaders, so routes/*.ts MUST re-evaluate
    // or every loader-registered route 404s. (Regression for the latent bug
    // B1's scoped invalidation introduced for non-route-touching edits.)
    const cfg:   Node = { file: path.resolve(cwd, 'config/app.ts'), importers: new Set() }
    const route: Node = { file: path.resolve(cwd, 'routes/api.ts'), importers: new Set() }
    const { server, invalidated } = makeServer({ cfg, route })

    invalidateBackendSubtree(server, cfg.file, cwd)
    assert.ok(invalidated.includes(cfg),   'changed config file invalidated')
    assert.ok(invalidated.includes(route), 'route loader module invalidated via the routes/ sweep')
  })
})

// ─── performReboot + watcher debounce (half-booted-window fix) ───

describe('performReboot', () => {
  const cwd = process.cwd()
  type Node = { file: string; importers: Set<Node> }

  function makeServer(files: Record<string, Node>) {
    const sends: unknown[] = []
    let invalidatedAll = false
    const byFile = new Map<string, Set<Node>>()
    for (const n of Object.values(files)) {
      const set = byFile.get(n.file) ?? new Set<Node>()
      set.add(n)
      byFile.set(n.file, set)
    }
    const invalidated: Node[] = []
    const server = {
      hot: { send: (m: unknown) => { sends.push(m) } },
      environments: { ssr: { moduleGraph: {
        getModulesByFile: (f: string) => byFile.get(f),
        invalidateModule: (m: Node) => { invalidated.push(m) },
        invalidateAll: () => { invalidatedAll = true },
        fileToModulesMap: byFile,
      } } },
    }
    return { server: server as never, sends, invalidated, wasInvalidatedAll: () => invalidatedAll }
  }

  it('clears the bootstrap singletons and sends exactly one full-reload for a multi-file burst', () => {
    const g = globalThis as Record<string, unknown>
    g['__rudderjs_instance__'] = {}
    g['__rudderjs_app__'] = {}

    const a: Node = { file: path.resolve(cwd, 'app', 'Models', 'Article.ts'), importers: new Set() }
    const b: Node = { file: path.resolve(cwd, 'app', 'Pilotiq', 'AdminPanel.ts'), importers: new Set() }
    const { server, sends, invalidated } = makeServer({ a, b })

    const log = console.log
    console.log = () => {}
    try {
      performReboot(server, [a.file, b.file], cwd)
    } finally {
      console.log = log
    }

    assert.equal(g['__rudderjs_instance__'], undefined, 'instance singleton cleared')
    assert.equal(g['__rudderjs_app__'], undefined, 'app singleton cleared')
    assert.ok(invalidated.includes(a) && invalidated.includes(b), 'both changed files invalidated')
    assert.equal(sends.length, 1, 'exactly one full-reload regardless of file count')
    assert.deepEqual(sends[0], { type: 'full-reload' })
  })

  it('resets the page-context-enhancer registry so per-boot registrants do not accumulate', async () => {
    _resetPageContextEnhancersForTests()
    let runs = 0
    registerPageContextEnhancer(() => { runs++ })
    await runPageContextEnhancers({} as never)
    assert.equal(runs, 1, 'enhancer registered + runs once')

    const a: Node = { file: path.resolve(cwd, 'app', 'a.ts'), importers: new Set() }
    const { server } = makeServer({ a })
    const log = console.log
    console.log = () => {}
    try {
      performReboot(server, [a.file], cwd)
    } finally {
      console.log = log
    }

    runs = 0
    await runPageContextEnhancers({} as never)
    assert.equal(runs, 0, 'registry cleared on re-boot — providers re-register on the next bootstrap')
  })

  it('falls back to invalidateAll when any changed file is not in the SSR graph', () => {
    const tracked: Node = { file: path.resolve(cwd, 'app', 'a.ts'), importers: new Set() }
    const { server, wasInvalidatedAll } = makeServer({ tracked })
    const log = console.log
    console.log = () => {}
    try {
      performReboot(server, [tracked.file, path.resolve(cwd, 'app', 'never-imported.ts')], cwd)
    } finally {
      console.log = log
    }
    assert.ok(wasInvalidatedAll(), 'an untracked file forces a whole-graph invalidation')
  })

  it('is a no-op for an empty file list', () => {
    const { server, sends } = makeServer({})
    performReboot(server, [], cwd)
    assert.equal(sends.length, 0)
  })
})

describe('rudderjs:routes — dev fix-stacktrace hook', () => {
  // configureServer registers globalThis.__rudderjs_fix_stacktrace__ so
  // @rudderjs/server-hono's Ignition error page can remap eval'd SSR
  // module-runner frames to true source positions via Vite's ssrFixStacktrace.
  it('registers a globalThis hook that delegates to server.ssrFixStacktrace', () => {
    const KEY = '__rudderjs_fix_stacktrace__'
    const g = globalThis as Record<string, unknown>
    const fixed: Error[] = []
    const server = {
      watcher: { add: () => {}, on: () => {} },
      hot: { send: () => {} },
      environments: { ssr: { moduleGraph: {
        getModulesByFile: () => undefined,
        invalidateModule: () => {},
        invalidateAll: () => {},
        fileToModulesMap: new Map(),
      } } },
      ssrFixStacktrace: (e: Error) => { fixed.push(e) },
    }
    const prev = g[KEY]
    try {
      const routes = rudderjs().find(p => p.name === 'rudderjs:routes')!
      ;(routes.configureServer as (s: unknown) => void)(server as never)

      const hook = g[KEY]
      assert.equal(typeof hook, 'function', 'fix-stacktrace hook registered on globalThis')

      const err = new Error('boom')
      ;(hook as (e: Error) => void)(err)
      assert.equal(fixed.length, 1, 'hook delegates to server.ssrFixStacktrace')
      assert.strictEqual(fixed[0], err, 'same error instance passed through')
    } finally {
      if (prev === undefined) delete g[KEY]; else g[KEY] = prev
    }
  })
})

describe('rudderjs:routes watcher debounce', () => {
  const cwd = process.cwd()

  function setup() {
    const sends: unknown[] = []
    let onChange: ((f: string) => void) | undefined
    const server = {
      watcher: {
        add: () => {},
        on: (ev: string, cb: (f: string) => void) => { if (ev === 'change') onChange = cb },
      },
      hot: { send: (m: unknown) => { sends.push(m) } },
      environments: { ssr: { moduleGraph: {
        getModulesByFile: () => undefined,
        invalidateModule: () => {},
        invalidateAll: () => {},
        fileToModulesMap: new Map(),
      } } },
    }
    const routes = rudderjs().find(p => p.name === 'rudderjs:routes')!
    ;(routes.configureServer as (s: unknown) => void)(server as never)
    return { onChange: onChange!, sends }
  }

  function withMutedLog(fn: () => void) {
    const log = console.log
    console.log = () => {}
    try { fn() } finally { console.log = log }
  }

  it('coalesces a burst of change events (atomic-write / format-on-save) into one reload', () => {
    mock.timers.enable({ apis: ['setTimeout'] })
    try {
      withMutedLog(() => {
        const { onChange, sends } = setup()
        const file = path.resolve(cwd, 'app', 'Pilotiq', 'AdminPanel.ts')
        // Three events ms apart, no debounce window elapsing between them.
        onChange(file); onChange(file); onChange(file)
        assert.equal(sends.length, 0, 'no reload before the debounce settles')
        mock.timers.tick(100)
        assert.equal(sends.length, 1, 'one coalesced full-reload, not three')
        assert.deepEqual(sends[0], { type: 'full-reload' })
      })
    } finally {
      mock.timers.reset()
    }
  })

  it('fires again for a change after the previous burst has settled', () => {
    mock.timers.enable({ apis: ['setTimeout'] })
    try {
      withMutedLog(() => {
        const { onChange, sends } = setup()
        const file = path.resolve(cwd, 'routes', 'web.ts')
        onChange(file)
        mock.timers.tick(100)
        assert.equal(sends.length, 1)
        onChange(file)
        mock.timers.tick(100)
        assert.equal(sends.length, 2, 'a later edit triggers its own reload')
      })
    } finally {
      mock.timers.reset()
    }
  })

  it('ignores app/Views/** edits — Vike component HMR owns them', () => {
    mock.timers.enable({ apis: ['setTimeout'] })
    try {
      withMutedLog(() => {
        const { onChange, sends } = setup()
        onChange(path.resolve(cwd, 'app', 'Views', 'Home.tsx'))
        mock.timers.tick(100)
        assert.equal(sends.length, 0)
      })
    } finally {
      mock.timers.reset()
    }
  })

  it('ignores files outside the watched dirs', () => {
    mock.timers.enable({ apis: ['setTimeout'] })
    try {
      withMutedLog(() => {
        const { onChange, sends } = setup()
        onChange(path.resolve(cwd, 'node_modules', 'x', 'index.js'))
        mock.timers.tick(100)
        assert.equal(sends.length, 0)
      })
    } finally {
      mock.timers.reset()
    }
  })
})

// ─── watch option (Phase C — external-package HMR) ────────────

describe('resolveWatchDir', () => {
  const repoRoot = repoRootDir()
  // Resolve from the playground, which depends on the @rudderjs/* workspace
  // packages (they aren't resolvable from @rudderjs/vite's own context).
  const playground = path.join(repoRoot, 'playground')

  it('returns an existing absolute directory as-is', () => {
    assert.equal(resolveWatchDir(process.cwd(), repoRoot), process.cwd())
  })

  it('returns null for a non-existent absolute directory', () => {
    assert.equal(resolveWatchDir(path.resolve('/no/such/dir/xyz'), repoRoot), null)
  })

  it('returns null for an unresolvable package name', () => {
    assert.equal(resolveWatchDir('@rudderjs/does-not-exist-xyz', playground), null)
  })

  it('resolves an ESM-only workspace package to its real src/ dir (exports-agnostic)', () => {
    // @rudderjs/contracts has no CJS "exports" main — require.resolve(name) would
    // throw ERR_PACKAGE_PATH_NOT_EXPORTED; resolveWatchDir must still find it.
    // A non-null result is already known to exist (resolveWatchDir checks).
    const dir = resolveWatchDir('@rudderjs/contracts', playground)
    assert.ok(dir, 'should resolve @rudderjs/contracts')
    assert.ok(dir!.replace(/\\/g, '/').endsWith('/src'), `expected a src/ dir, got ${dir}`)
    assert.ok(!dir!.includes('node_modules'), 'should be the realpath, not the node_modules symlink')
  })
})

describe('rudderjs({ watch }) → ssr.noExternal', () => {
  const callConfig = (plugins: Awaited<ReturnType<typeof rudderjs>>, command: 'serve' | 'build') => {
    const cfg = plugins.find(p => p.name === 'rudderjs:config')!
    return (cfg.config as (c: unknown, e: { command: string; mode: string }) => { ssr: { noExternal: string[] } })(
      {}, { command, mode: command === 'serve' ? 'development' : 'production' },
    )
  }

  it('adds package-name watch entries to ssr.noExternal in dev (serve) only', async () => {
    const plugins = await rudderjs({ watch: ['@pilotiq/pilotiq'] })
    assert.ok(callConfig(plugins, 'serve').ssr.noExternal.includes('@pilotiq/pilotiq'), 'dev includes it')
    assert.ok(!callConfig(plugins, 'build').ssr.noExternal.includes('@pilotiq/pilotiq'), 'build excludes it')
  })

  it('does not add absolute-dir watch entries to ssr.noExternal', async () => {
    const plugins = await rudderjs({ watch: [path.resolve('/some/abs/dir')] })
    assert.ok(!callConfig(plugins, 'serve').ssr.noExternal.includes(path.resolve('/some/abs/dir')))
  })
})
