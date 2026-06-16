import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { ServerAdapter, AppRequest, AppResponse } from '@rudderjs/contracts'
import { hono } from './index.js'

// `req.spaNavUrl` / `req.isPageContextRequest` expose the adapter's SPA-nav
// signal (the original `/<path>/index.pageContext.json` URL it rewrote into a
// controller call), backed by the per-request `spaNavUrlStore` ALS — NOT a
// client header — so they're unforgeable. This is the supported replacement
// for the removed `x-rudder-original-url` header.

async function handlerExposingSpaNav() {
  const provider = hono()
  return provider.createFetchHandler((adapter: ServerAdapter) => {
    adapter.registerRoute({
      method:     'GET',
      path:       '/admin',
      middleware: [],
      handler: (req: AppRequest, res: AppResponse) => res.json({
        spaNavUrl:            req.spaNavUrl ?? null,
        isPageContextRequest: req.isPageContextRequest === true,
      }),
    })
  })
}

describe('req.spaNavUrl / req.isPageContextRequest', () => {
  it('is populated for a rewritten controller-view pageContext request', async () => {
    const handler = await handlerExposingSpaNav()
    const res = await handler(new Request('http://localhost/admin/index.pageContext.json'))
    assert.strictEqual(res.status, 200)
    assert.deepStrictEqual(await res.json(), {
      spaNavUrl:            'http://localhost/admin/index.pageContext.json',
      isPageContextRequest: true,
    })
  })

  it('is undefined/false for a direct (non-rewritten) request', async () => {
    const handler = await handlerExposingSpaNav()
    const res = await handler(new Request('http://localhost/admin'))
    assert.strictEqual(res.status, 200)
    assert.deepStrictEqual(await res.json(), {
      spaNavUrl:            null,
      isPageContextRequest: false,
    })
  })

  it('cannot be forged via a client header', async () => {
    const handler = await handlerExposingSpaNav()
    // A direct request that tries to inject the old header gets no SPA-nav
    // signal — the value comes from the ALS the adapter controls, not headers.
    const res = await handler(new Request('http://localhost/admin', {
      headers: { 'x-rudder-original-url': 'http://localhost/evil/index.pageContext.json' },
    }))
    assert.strictEqual(res.status, 200)
    assert.deepStrictEqual(await res.json(), {
      spaNavUrl:            null,
      isPageContextRequest: false,
    })
  })
})
