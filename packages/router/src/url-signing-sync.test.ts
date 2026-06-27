import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { Url } from './url-signing.js'

// Regression for #1422 — node:crypto must be available on the FIRST synchronous
// call, with no awaited tick in between to let an async import resolve.
//
// We sign here at module-evaluation time (before any microtask has run), which
// reproduces a `Url.sign()` firing on the very first request / a bootstrap hook
// that runs immediately after `router.mount()`. The old fire-and-forget
// `import('node:crypto')` left `_crypto` undefined at this point and threw
// "[Rudder Router] node:crypto not available". The synchronous
// `process.getBuiltinModule` lookup removes the race. `node --test` runs each
// file in its own process, so this module graph is fresh — no prior warmup.
Url.setKey('sync-race-key')
let signedAtEval: string | undefined
let evalError: unknown
try {
  signedAtEval = Url.sign('/invoice/42')
} catch (e) {
  evalError = e
}

describe('Url — crypto resolved synchronously (no startup race, #1422)', () => {
  it('signs on the first synchronous call without awaiting an import', () => {
    assert.equal(evalError, undefined)
    assert.match(signedAtEval ?? '', /^\/invoice\/42\?signature=[a-f0-9]+$/)
  })

  it('that synchronously-produced signature verifies', () => {
    const u = new URL(signedAtEval ?? '', 'http://placeholder.local')
    const req = {
      method: 'GET', url: signedAtEval, path: u.pathname,
      query: Object.fromEntries(u.searchParams.entries()),
      params: {}, headers: {}, body: null, raw: null,
    } as unknown as import('@rudderjs/contracts').AppRequest
    assert.equal(Url.isValidSignature(req), true)
  })
})
