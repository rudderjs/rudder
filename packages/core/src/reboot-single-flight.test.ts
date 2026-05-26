import 'reflect-metadata'
import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import type { ServerAdapter, ServerAdapterProvider } from '@rudderjs/contracts'
import {
  Application,
  ServiceProvider,
  container,
  rudder,
  resetGroupMiddleware,
} from './index.js'

// ─── Dev HMR re-boot: single-flight + request gate ──────────
//
// Regression for the "half-booted response" race
// (docs/plans/2026-05-24-hmr-reboot-window-serves-half-booted-responses.md).
//
// In dev, the @rudderjs/vite watcher clears __rudderjs_instance__ +
// __rudderjs_app__ and tells the browser to full-reload. The next request
// re-evaluates bootstrap/app.ts → a fresh RudderJS whose constructor begins an
// async re-boot (router.reset() → provider boot → ModelRegistry.set() →
// re-run loaders). If a SECOND re-boot is triggered (atomic-write double-fire,
// or any concurrent trigger) it used to start a *parallel* boot that interleaved
// its reset + re-registration with the first — and a request served in that
// window observed half-booted shared state (empty ORM data, dropped routes).
//
// These tests pin the two invariants of the fix, modelled deterministically
// with gated provider boots (no Vite/DB needed):
//   1. Single-flight — a re-boot started while another is in flight runs AFTER
//      it, never interleaved.
//   2. Request gate — handleRequest() blocks on the latest in-flight re-boot
//      before invoking the route handler.

const G = globalThis as Record<string, unknown>

/** A deferred gate so a provider's boot() pauses until the test releases it. */
function gate() {
  let release!: () => void
  const promise = new Promise<void>((r) => { release = r })
  return { promise, release }
}

/** A provider whose boot() logs start/end and blocks on a gate in between. */
function gatedProvider(label: string, log: string[], g: { promise: Promise<void> }) {
  return class extends ServiceProvider {
    register(): void {}
    async boot(): Promise<void> {
      log.push(`${label}:start`)
      await g.promise
      log.push(`${label}:end`)
    }
  }
}

/** Flush the microtask queue (+ a macrotask) so pending boot chains settle. */
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

const bootOf = (i: unknown): Promise<void> => (i as { _providerBoot: Promise<void> })._providerBoot

/**
 * Simulate the @rudderjs/vite watcher firing a reload: it clears ONLY the two
 * top-level singletons (it has no knowledge of core's internal boot promise),
 * so the next create() builds a fresh RudderJS + Application pair.
 */
function simulateWatcherClear(): void {
  delete G['__rudderjs_instance__']
  Application.resetForTesting() // clears Application.instance + __rudderjs_app__
}

function freshState(): void {
  delete G['__rudderjs_instance__']
  delete G['__rudderjs_boot__']
  delete G['__rudderjs_hmr_t0__']
  delete G['__rudderjs_inflight__']
  Application.resetForTesting()
  container.reset()
  resetGroupMiddleware()
  rudder.reset()
}

/** Poll the microtask/macrotask queue until `cond()` or `tries` exhausted. */
async function until(cond: () => boolean, tries = 30): Promise<void> {
  for (let i = 0; i < tries && !cond(); i++) await settle()
}

describe('dev HMR re-boot — single-flight', () => {
  beforeEach(freshState)

  it('a re-boot triggered while another is in flight does NOT start until the first completes', async () => {
    const log: string[] = []
    const gateA = gate()
    const gateB = gate()

    // First re-boot (instance A) — boot blocks on gateA.
    Application.configure({ server: {} as never, providers: [gatedProvider('A', log, gateA)] })
      .withRouting({})
      .create()
    await settle()
    assert.deepEqual(log, ['A:start'], 'A boots and parks on its gate')

    // Watcher fires again mid-boot → a second re-boot (instance B) is created.
    simulateWatcherClear()
    const b = Application.configure({ server: {} as never, providers: [gatedProvider('B', log, gateB)] })
      .withRouting({})
      .create()
    await settle()
    // THE FIX: B must wait for A. Without single-flight, B:start appears here
    // (two concurrent boots interleaving their reset + re-registration).
    assert.deepEqual(log, ['A:start'], 'B must not begin its re-boot while A is still booting')

    gateA.release()
    // B's re-boot resets shared state first (drain + `await import('@rudderjs/router')`
    // + router.reset()), so B:start lands a tick after A:end rather than in the same
    // settle() — poll for it. The invariant under test is the ORDER (B strictly after A).
    await until(() => log.includes('B:start'))
    assert.deepEqual(log, ['A:start', 'A:end', 'B:start'], 'B begins only after A finishes')

    gateB.release()
    await bootOf(b)
    assert.deepEqual(log, ['A:start', 'A:end', 'B:start', 'B:end'])
  })

  it('publishes its own boot promise as the latest on globalThis', async () => {
    const gateA = gate()
    const a = Application.configure({ server: {} as never, providers: [gatedProvider('A', [], gateA)] })
      .withRouting({})
      .create()
    assert.strictEqual(G['__rudderjs_boot__'], bootOf(a), 'latest boot is observable on globalThis')
    gateA.release()
    await bootOf(a)
  })
})

describe('dev HMR re-boot — request gate', () => {
  beforeEach(freshState)

  function fakeServer(onHandle: () => void): ServerAdapterProvider {
    return {
      type: 'fake',
      create: () => ({} as ServerAdapter),
      createApp: () => ({}),
      async createFetchHandler(setup?: (adapter: ServerAdapter) => void): Promise<(req: Request) => Promise<Response>> {
        const adapter = {
          registerRoute() {},
          applyMiddleware() {},
          applyGroupMiddleware() {},
          setErrorHandler() {},
          listen() {},
          getNativeServer() { return {} },
        } as unknown as ServerAdapter
        setup?.(adapter) // runs router.mount(adapter) — no routes registered here
        return async (_req: Request) => { onHandle(); return new Response('ok') }
      },
    }
  }

  it('handleRequest blocks until the latest in-flight re-boot completes', async () => {
    const log: string[] = []
    let handled = 0
    const server = fakeServer(() => { handled++ })

    // Instance A boots fully (no gate).
    class QuickProvider extends ServiceProvider {
      register(): void {}
      async boot(): Promise<void> { log.push('A:boot') }
    }
    const a = Application.configure({ server, providers: [QuickProvider] }).withRouting({}).create()
    await bootOf(a)

    // Warm A's request handler first, so the only thing that can defer the next
    // request is the boot gate — not the one-time lazy handler init (which does
    // an async `import('@rudderjs/router')` + createFetchHandler). Without this
    // warm-up the test would pass for the wrong reason on the unfixed code.
    await a.handleRequest(new Request('http://localhost/warm'))
    assert.equal(handled, 1, 'handler warmed')
    handled = 0

    // Watcher fires → a slow re-boot (instance B) starts and parks on its gate.
    const gateB = gate()
    simulateWatcherClear()
    Application.configure({ server, providers: [gatedProvider('B', log, gateB)] }).withRouting({}).create()
    await settle()
    assert.deepEqual(log, ['A:boot', 'B:start'], 'B is mid-boot')

    // A request lands in the re-boot window. Even though A's handler is fully
    // built, it must NOT be served against the half-booted state — it blocks on
    // the latest re-boot (B).
    let served = false
    const req = a.handleRequest(new Request('http://localhost/')).then(() => { served = true })
    await settle()
    assert.equal(handled, 0, 'route handler must not run during the re-boot window')
    assert.equal(served, false)

    gateB.release()
    await req
    assert.equal(served, true, 'request is served once the latest re-boot finishes')
    assert.equal(handled, 1)
  })
})

// ─── Dev HMR re-boot: quiesce barrier (drain in-flight renders) ──────────────
//
// Regression for REOPEN #2: a request that already passed the gate can be
// MID-RENDER when the next re-boot stomps shared state in place (router.reset()
// + provider boots repopulating registries), so the render observes a
// half-booted graph (e.g. a resource schema missing its `table` element → empty
// render, no error). The fix makes the re-boot DRAIN in-flight renders before it
// mutates. Modelled with a handler that blocks until released; asserts the
// re-boot's provider boot does not start until the in-flight render drains.
// Dev-only — gated on APP_ENV.
describe('dev HMR re-boot — quiesce barrier', () => {
  let prevEnv: string | undefined
  beforeEach(() => { prevEnv = process.env['APP_ENV']; process.env['APP_ENV'] = 'development'; freshState() })
  afterEach(() => { if (prevEnv === undefined) delete process.env['APP_ENV']; else process.env['APP_ENV'] = prevEnv })

  /** A fake server whose request handler is supplied by the test (so it can block). */
  function blockingServer(handler: (req: Request) => Promise<Response>): ServerAdapterProvider {
    return {
      type: 'fake',
      create: () => ({} as ServerAdapter),
      createApp: () => ({}),
      async createFetchHandler(setup?: (adapter: ServerAdapter) => void): Promise<(req: Request) => Promise<Response>> {
        const adapter = {
          registerRoute() {}, applyMiddleware() {}, applyGroupMiddleware() {},
          setErrorHandler() {}, listen() {}, getNativeServer() { return {} },
        } as unknown as ServerAdapter
        setup?.(adapter)
        return handler
      },
    }
  }

  it('a re-boot drains an in-flight render before mutating shared state', async () => {
    const log: string[] = []
    const handlerGate = gate()
    let handling = false
    const server = blockingServer(async () => { handling = true; await handlerGate.promise; return new Response('ok') })

    // Instance A boots fully (no gate), warm its handler is implicit on first request.
    class QuickProvider extends ServiceProvider { register(): void {} async boot(): Promise<void> { log.push('A:boot') } }
    const a = Application.configure({ server, providers: [QuickProvider] }).withRouting({}).create()
    await bootOf(a)

    // Fire a request — it passes the gate and parks INSIDE the handler (in-flight).
    // Fire-and-forget: we observe progress via `handling` / `served`, not the promise.
    let served = false
    void a.handleRequest(new Request('http://localhost/')).then(() => { served = true })
    await until(() => handling)
    assert.equal(handling, true, 'request entered the handler (in-flight render)')
    assert.equal(served, false)

    // Watcher fires → re-boot B with a provider that logs when its boot runs.
    const gateB = gate()
    simulateWatcherClear()
    const b = Application.configure({ server, providers: [gatedProvider('B', log, gateB)] }).withRouting({}).create()
    await settle()

    // THE FIX: B must DRAIN the in-flight render first — its provider boot (and
    // the router.reset() that precedes it) must NOT run while a render is live.
    assert.equal(log.includes('B:start'), false, 'B must not mutate/boot while a render is in flight')

    // Release the in-flight render → it drains → B's re-boot proceeds.
    handlerGate.release()
    await until(() => served)
    assert.equal(served, true, 'in-flight render completed')
    await until(() => log.includes('B:start'))
    assert.equal(log.includes('B:start'), true, 'B boots only after the in-flight render drained')

    gateB.release()
    await bootOf(b)
  })
})

// ─── Dev HMR re-boot: reset is env-independent (gated on "is re-boot") ────────
//
// Regression: the re-boot reset (router.reset() + rudder.reset() +
// resetGroupMiddleware()) used to be gated on `isDevelopment()`, which reads
// APP_ENV (default 'production'). A `vike dev` server whose APP_ENV isn't
// 'development' (no .env, or APP_ENV=production) still re-boots on every file
// edit — but the reset was skipped, so the router stayed mounted from the first
// boot. A provider that registers routes in boot() (e.g. @rudderjs/horizon's
// registerHorizonRoutes → router.get()) then threw
// "get() called after router.mount()" on the 2nd edit, wedging the dev server.
// The fix gates the reset on "is this a re-boot" (a previous boot exists) rather
// than the environment, so the router is reset before every re-boot regardless
// of APP_ENV. Modelled at APP_ENV=production with a route-registering provider.
describe('dev HMR re-boot — reset is env-independent', () => {
  let prevEnv: string | undefined
  beforeEach(() => { prevEnv = process.env['APP_ENV']; process.env['APP_ENV'] = 'production'; freshState() })
  afterEach(() => { if (prevEnv === undefined) delete process.env['APP_ENV']; else process.env['APP_ENV'] = prevEnv })

  /** Fake server whose handler setup mounts the real router (the state that makes a 2nd registration throw). */
  function mountingServer(): ServerAdapterProvider {
    return {
      type: 'fake',
      create: () => ({} as ServerAdapter),
      createApp: () => ({}),
      async createFetchHandler(setup?: (adapter: ServerAdapter) => void): Promise<(req: Request) => Promise<Response>> {
        const adapter = {
          registerRoute() {}, applyMiddleware() {}, applyGroupMiddleware() {},
          setErrorHandler() {}, listen() {}, getNativeServer() { return {} },
        } as unknown as ServerAdapter
        setup?.(adapter) // runs router.mount(adapter)
        return async () => new Response('ok')
      },
    }
  }

  /** Models @rudderjs/horizon: registers a route inside boot() via the real router. */
  class RouteRegisteringProvider extends ServiceProvider {
    register(): void {}
    async boot(): Promise<void> {
      const { router } = await import('@rudderjs/router') as { router: { get(path: string, h: unknown): unknown } }
      router.get('/reboot-probe', (() => new Response('ok')) as never)
    }
  }

  it('re-boots cleanly at APP_ENV=production — router.reset() runs so boot()-time route registration does not throw "after router.mount()"', async () => {
    const { router } = await import('@rudderjs/router') as { router: { reset(): void } }
    router.reset() // isolate from any mount state leaked by a prior test

    // Instance A registers /reboot-probe in boot(); warming the handler mounts the router.
    const a = Application.configure({ server: mountingServer(), providers: [RouteRegisteringProvider] }).withRouting({}).create()
    await bootOf(a)
    await a.handleRequest(new Request('http://localhost/')) // → router.mount(adapter)

    // Watcher fires → re-boot B re-registers /reboot-probe in boot(). On the
    // unfixed code (env=production → reset skipped) the router is still mounted
    // and this rejects with the mount-guard error; the fix resets first.
    simulateWatcherClear()
    const b = Application.configure({ server: mountingServer(), providers: [RouteRegisteringProvider] }).withRouting({}).create()
    await assert.doesNotReject(bootOf(b))
  })
})
