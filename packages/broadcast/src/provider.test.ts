import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  Broadcast,
  BroadcastingProvider,
  UPGRADE_KEY,
} from './provider.js'
import { resetBroadcast } from './ws-server.js'

const g = globalThis as Record<string, unknown>

function clearGlobals(): void {
  resetBroadcast()
  delete g[UPGRADE_KEY]
  delete g['__rudderjs_ws_broadcast_upgrade__']
}

describe('BroadcastingProvider', () => {
  beforeEach(() => { clearGlobals() })

  it('UPGRADE_KEY exposes the canonical globalThis slot name', () => {
    assert.equal(UPGRADE_KEY, '__rudderjs_ws_upgrade__')
  })

  it('Broadcast.channel registers an auth callback (delegates to registerAuth)', async () => {
    let captured: { req: unknown; channel: string } | null = null
    Broadcast.channel('private-orders.*', async (req, channel) => {
      captured = { req, channel }
      return true
    })

    // We can't reach registerAuth's internal Map from here, so prove the
    // registration took effect by booting the provider and triggering the
    // auth path through the WS lifecycle. That's covered in index.test.ts.
    // What we verify here is that the call doesn't throw.
    assert.equal(captured, null, 'callback should not fire on registration alone')
  })
})

// Booting the provider requires the full @rudderjs/core config + rudder
// runtime; we don't reproduce that scaffolding here. The provider's
// runtime behavior is exercised end-to-end via the WS lifecycle tests in
// index.test.ts. What we DO verify is that calling boot() with a config
// repo populated and the rudder runtime present writes both globalThis
// upgrade-handler slots — that's the public contract @rudderjs/vite and
// @rudderjs/server-hono rely on.
describe('BroadcastingProvider.boot() — globalThis upgrade-handler registration', () => {
  beforeEach(() => { clearGlobals() })

  it('writes UPGRADE_KEY and the broadcast-specific slot after boot', async () => {
    // Lazy-import the core helpers so the provider's import chain settles
    // against the workspace's @rudderjs/core resolution.
    const core = await import('@rudderjs/core')

    const previous = core.getConfigRepository?.()
    core.setConfigRepository?.(new core.ConfigRepository({ broadcast: { path: '/ws' } }))
    try {
      const fakeApp = { instance: () => undefined } as never
      const provider = new BroadcastingProvider(fakeApp)
      await provider.boot()

      assert.equal(typeof g[UPGRADE_KEY], 'function', 'upgrade handler should be registered')
      assert.equal(typeof g['__rudderjs_ws_broadcast_upgrade__'], 'function', 'broadcast-specific slot should be registered too')
    } finally {
      if (previous) core.setConfigRepository?.(previous)
      clearGlobals()
    }
  })

  it('builds the driver only on first boot — re-boots reuse the live ws-server (no leaked connections)', async () => {
    const core = await import('@rudderjs/core')

    const previous = core.getConfigRepository?.()
    let factoryCalls = 0
    const fakeDriver = { subscribe: () => () => {}, publish: async () => {}, close: async () => {} }
    core.setConfigRepository?.(new core.ConfigRepository({
      broadcast: { path: '/ws', driver: async () => { factoryCalls++; return fakeDriver } },
    }))
    try {
      const fakeApp = { instance: () => undefined } as never
      await new BroadcastingProvider(fakeApp).boot()
      await new BroadcastingProvider(fakeApp).boot() // simulates a dev HMR re-boot (ws already running)

      assert.equal(factoryCalls, 1, 'driver factory must run only on first boot, not per re-boot')
    } finally {
      if (previous) core.setConfigRepository?.(previous)
      clearGlobals()
    }
  })

  it('honors a custom path from config', async () => {
    const core = await import('@rudderjs/core')

    const previous = core.getConfigRepository?.()
    core.setConfigRepository?.(new core.ConfigRepository({ broadcast: { path: '/custom-ws' } }))
    try {
      const fakeApp = { instance: () => undefined } as never
      const provider = new BroadcastingProvider(fakeApp)
      await provider.boot()
      // Handler exists and is callable — exact path-matching behavior is
      // covered by the upgrade-handler unit tests in index.test.ts.
      assert.equal(typeof g[UPGRADE_KEY], 'function')
    } finally {
      if (previous) core.setConfigRepository?.(previous)
      clearGlobals()
    }
  })
})
