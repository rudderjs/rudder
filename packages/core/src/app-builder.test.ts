import 'reflect-metadata'
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import type { ServerAdapter, ServerAdapterProvider } from '@rudderjs/contracts'
import {
  Application,
  ServiceProvider,
  container,
  rudder,
  resetGroupMiddleware,
} from './index.js'

// ─── Application.configure() — server adapter resolution ────────────────────
//
// `server:` is optional: when omitted, core auto-resolves @rudderjs/server-hono
// at first handleRequest() and constructs it with config('server'). These tests
// pin the three contracts of that behavior:
//   1. An explicit `server:` is used verbatim (no auto-resolution).
//   2. Omitted `server:` + package not installed → handleRequest() rejects with
//      a clear install-hint error, while boot() (the CLI path, which never
//      needs an HTTP server) still succeeds.
//   3. Resolution is memoized — one resolution per instance.
//
// The happy auto-resolve path (server-hono actually installed) is exercised
// end-to-end by the playground apps and the create-rudder CI smoke; it cannot
// run here because @rudderjs/server-hono is deliberately not a dependency of
// core (same no-cycle rule as @rudderjs/router).

const G = globalThis as Record<string, unknown>

function freshState(): void {
  delete G['__rudderjs_instance__']
  delete G['__rudderjs_boot__']
  delete G['__rudderjs_inflight__']
  Application.resetForTesting()
  container.reset()
  resetGroupMiddleware()
  rudder.reset()
}

class NoopProvider extends ServiceProvider {
  register(): void {}
}

/** A fake adapter provider that records createFetchHandler calls. */
function fakeServer(calls: { fetchHandler: number }): ServerAdapterProvider {
  return {
    type: 'fake',
    create: () => ({} as ServerAdapter),
    createApp: () => ({}),
    async createFetchHandler(setup?: (adapter: ServerAdapter) => void): Promise<(req: Request) => Promise<Response>> {
      calls.fetchHandler++
      const adapter = {
        registerRoute() {},
        applyMiddleware() {},
        applyGroupMiddleware() {},
        setErrorHandler() {},
        listen() {},
        getNativeServer() { return {} },
      } as unknown as ServerAdapter
      setup?.(adapter)
      return async (_req: Request) => new Response('ok')
    },
  }
}

describe('Application.configure() — server adapter resolution', () => {
  beforeEach(freshState)

  it('uses an explicit server: verbatim', async () => {
    const calls = { fetchHandler: 0 }
    const instance = Application.configure({ server: fakeServer(calls), providers: [NoopProvider] })
      .withRouting({})
      .create()

    const res = await instance.handleRequest(new Request('http://localhost/'))
    assert.equal(await res.text(), 'ok')
    assert.equal(calls.fetchHandler, 1, 'the configured adapter built the handler')
  })

  it('omitted server: + @rudderjs/server-hono not installed → clear error on handleRequest', async () => {
    const instance = Application.configure({ providers: [NoopProvider] })
      .withRouting({})
      .create()

    await assert.rejects(
      () => instance.handleRequest(new Request('http://localhost/')),
      (err: Error) => {
        assert.match(err.message, /No server adapter configured/)
        assert.match(err.message, /@rudderjs\/server-hono/)
        assert.match(err.message, /server: hono\(config\.server\)/)
        return true
      },
    )
  })

  it('omitted server: never blocks the CLI path — boot() succeeds without an HTTP server', async () => {
    const instance = Application.configure({ providers: [NoopProvider] })
      .withRouting({})
      .create()

    await instance.boot() // providers only — must not attempt server resolution
  })

  it('memoizes server resolution per instance', async () => {
    const instance = Application.configure({ providers: [NoopProvider] })
      .withRouting({})
      .create()

    type HasResolve = { _resolveServer(): Promise<ServerAdapterProvider> }
    const first = (instance as unknown as HasResolve)._resolveServer()
    const second = (instance as unknown as HasResolve)._resolveServer()
    assert.strictEqual(first, second, 'same in-flight promise returned')
    await first.catch(() => { /* unresolvable here — rejection is expected */ })
  })

  it('explicit server: resolves without touching auto-resolution', async () => {
    const calls = { fetchHandler: 0 }
    const instance = Application.configure({ server: fakeServer(calls), providers: [NoopProvider] })
      .withRouting({})
      .create()

    type HasResolve = { _resolveServer(): Promise<ServerAdapterProvider>; _autoServer: unknown }
    const resolved = await (instance as unknown as HasResolve)._resolveServer()
    assert.equal(resolved.type, 'fake')
    assert.equal((instance as unknown as HasResolve)._autoServer, null, 'no auto-resolution kicked off')
  })
})
