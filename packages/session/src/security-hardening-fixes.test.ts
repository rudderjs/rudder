import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import type { AppRequest, AppResponse } from '@rudderjs/contracts'
import {
  SessionInstance,
  sessionMiddleware,
  resolveSessionSecret,
  type SessionConfig,
} from './index.js'

// ─── Secret resolution: never sign with the public placeholder ────────────────

describe('resolveSessionSecret — APP_KEY fallback, never the public placeholder', () => {
  const PLACEHOLDER = 'change-me-in-production'
  let savedAppKey: string | undefined

  beforeEach(() => { savedAppKey = process.env['APP_KEY'] })
  afterEach(() => {
    if (savedAppKey === undefined) delete process.env['APP_KEY']
    else process.env['APP_KEY'] = savedAppKey
  })

  it('returns a real configured secret unchanged', () => {
    delete process.env['APP_KEY']
    assert.equal(resolveSessionSecret('a-genuinely-random-session-secret'), 'a-genuinely-random-session-secret')
  })

  it('falls back to APP_KEY when the secret is the public placeholder', () => {
    process.env['APP_KEY'] = 'real-app-key-value'
    assert.equal(resolveSessionSecret(PLACEHOLDER), 'real-app-key-value')
  })

  it('falls back to APP_KEY when the secret is empty', () => {
    process.env['APP_KEY'] = 'real-app-key-value'
    assert.equal(resolveSessionSecret(''), 'real-app-key-value')
    assert.equal(resolveSessionSecret(undefined), 'real-app-key-value')
  })

  it('strips the base64: prefix the scaffolder emits on APP_KEY', () => {
    process.env['APP_KEY'] = 'base64:Zm9vYmFy'
    assert.equal(resolveSessionSecret(PLACEHOLDER), 'Zm9vYmFy')
  })

  it('only keeps the placeholder when there is no APP_KEY to fall back to', () => {
    delete process.env['APP_KEY']
    // Last-resort: returns the placeholder (and warns) rather than throwing —
    // session boots transitively in apps that never serve sessions.
    assert.equal(resolveSessionSecret(PLACEHOLDER), PLACEHOLDER)
    assert.equal(resolveSessionSecret(''), PLACEHOLDER)
  })
})

// ─── Behavioral: a placeholder-config app actually signs with APP_KEY ──────────

function makeReqRes(cookieHeader = ''): { req: AppRequest; res: AppResponse; setCookies: string[] } {
  const setCookies: string[] = []
  const req = { headers: { cookie: cookieHeader }, raw: {} } as unknown as AppRequest
  const res = { raw: { header: (_k: string, v: string) => { setCookies.push(v) } } } as unknown as AppResponse
  return { req, res, setCookies }
}

function cfg(secret: string): SessionConfig {
  return {
    driver: 'cookie',
    lifetime: 120,
    secret,
    cookie: { name: 'rjs_sess', secure: false, httpOnly: true, sameSite: 'lax', path: '/' },
  }
}

async function run(config: SessionConfig, cookieHeader: string, fn: (s: SessionInstance) => void): Promise<string | undefined> {
  const mw = sessionMiddleware(config)
  const { req, res, setCookies } = makeReqRes(cookieHeader)
  await mw(req, res, async () => { fn((req.raw as Record<string, unknown>)['__rjs_session'] as SessionInstance) })
  return setCookies[0]
}

describe('sessionMiddleware — placeholder config signs with APP_KEY (cross-readable)', () => {
  let savedAppKey: string | undefined
  beforeEach(() => { savedAppKey = process.env['APP_KEY']; process.env['APP_KEY'] = 'the-real-random-app-key' })
  afterEach(() => {
    if (savedAppKey === undefined) delete process.env['APP_KEY']
    else process.env['APP_KEY'] = savedAppKey
  })

  it('a cookie minted under the placeholder secret verifies under an explicit APP_KEY secret', async () => {
    // App A is configured with the (public) placeholder, but APP_KEY is set, so
    // the resolver makes it sign with APP_KEY instead of the world-known literal.
    const setCookie = await run(cfg('change-me-in-production'), '', (s) => s.put('uid', '42'))
    assert.ok(setCookie, 'placeholder-config request must set a cookie')
    const value = setCookie.match(/^rjs_sess=([^;]+)/)![1]!

    // App B signs explicitly with the APP_KEY value. If A had signed with the
    // placeholder, B could not verify it and would see an empty session.
    let seen: string | undefined
    await run(cfg('the-real-random-app-key'), `rjs_sess=${value}`, (s) => { seen = s.get('uid') })
    assert.equal(seen, '42', 'placeholder-config app must sign with APP_KEY, not the public placeholder')
  })
})

// ─── SessionInstance.has/get: own-property only (no prototype-chain leak) ──────

describe('SessionInstance — has()/get() ignore inherited Object.prototype members', () => {
  let session: SessionInstance
  beforeEach(async () => {
    const mw = sessionMiddleware(cfg('a-real-secret-for-the-has-tests'))
    const { req, res } = makeReqRes('')
    await mw(req, res, async () => { session = (req.raw as Record<string, unknown>)['__rjs_session'] as SessionInstance })
  })

  for (const proto of ['toString', 'constructor', 'hasOwnProperty', 'valueOf', 'isPrototypeOf', '__proto__']) {
    it(`has('${proto}') is false when never set`, () => {
      assert.strictEqual(session.has(proto), false)
    })
    it(`get('${proto}') returns the fallback, not the inherited member`, () => {
      assert.strictEqual(session.get(proto, 'fallback'), 'fallback')
    })
  }

  it('still reads genuinely-set keys (regression guard)', () => {
    session.put('toString', 'i-set-this')
    assert.strictEqual(session.has('toString'), true)
    assert.strictEqual(session.get('toString'), 'i-set-this')
  })
})
