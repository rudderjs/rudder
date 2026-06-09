import 'reflect-metadata'
import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import type { IncomingMessage } from 'node:http'

import { Application, createWsContextRunner } from '@rudderjs/core'
import { sessionMiddleware, Session, type SessionConfig } from '@rudderjs/session'
import { REQUEST_CONTEXT } from '@rudderjs/contracts'
import type { AppRequest, AppResponse } from '@rudderjs/contracts'
import { AuthManager, Auth, AuthMiddleware, type AuthConfig } from './index.js'

// End-to-end check of the WS-upgrade context runner: it runs the REAL
// `sessionMiddleware` + `AuthMiddleware` (resolved as the web group's
// REQUEST_CONTEXT-tagged handlers) around a callback, so `Auth.user()` resolves
// from a session cookie exactly as it would in an HTTP handler — the whole point
// of the #1011 follow-up. We do NOT reimplement session/auth here.

// ─── Fixtures ──────────────────────────────────────────────

function fakeUser(overrides?: Record<string, unknown>): Record<string, unknown> {
  return { id: '1', name: 'John', email: 'john@example.com', password: '$2b$04$x', rememberToken: null, ...overrides }
}

function fakeModel(users: Record<string, unknown>[]) {
  return {
    find: async (id: string | number) => users.find(u => u['id'] === String(id)) ?? null,
    query: () => {
      const filters: Record<string, unknown> = {}
      const builder = {
        where(col: string, val: unknown) { filters[col] = val; return builder },
        async first() {
          return users.find(u => Object.entries(filters).every(([k, v]) => u[k] === v)) ?? null
        },
      }
      return builder
    },
  }
}

function makeAuthConfig(model: unknown): AuthConfig {
  return {
    defaults:  { guard: 'web' },
    guards:    { web: { driver: 'session', provider: 'users' } },
    providers: { users: { driver: 'eloquent', model } },
  }
}

const sessionConfig: SessionConfig = {
  driver:   'cookie',
  lifetime: 120,
  secret:   'test-secret-32-chars-exactly!!xx',
  cookie:   { name: 'rjs_sess', secure: false, httpOnly: true, sameSite: 'lax', path: '/' },
}

/** Mint a real session cookie carrying `auth_user_id` by running the actual
 *  `sessionMiddleware` once and capturing its Set-Cookie value. */
async function mintSessionCookie(authUserId: string): Promise<string> {
  const mw = sessionMiddleware(sessionConfig)
  let setCookie: string | undefined
  const req = { headers: { cookie: '' }, raw: {} } as unknown as AppRequest
  const res = { raw: { header: (_k: string, v: string) => { setCookie = v } } } as unknown as AppResponse
  await mw(req, res, async () => { Session.put('auth_user_id', authUserId) })
  const value = setCookie!.match(/^rjs_sess=([^;]+)/)![1]!
  return `rjs_sess=${value}`
}

function fakeIncoming(cookieHeader?: string): IncomingMessage {
  const headers: Record<string, string> = { host: 'localhost' }
  if (cookieHeader) headers['cookie'] = cookieHeader
  return { url: '/ws-sync/room', headers, socket: { remoteAddress: '127.0.0.1' } } as unknown as IncomingMessage
}

/** Build the runner over the real session + auth context middleware. */
function buildRunner() {
  return createWsContextRunner(() => [sessionMiddleware(sessionConfig), AuthMiddleware()])
}

// ─── Tests ─────────────────────────────────────────────────

describe('WS-upgrade context runner — real session + auth', () => {
  beforeEach(() => {
    Application.resetForTesting()
    Application.create()
    const manager = new AuthManager(makeAuthConfig(fakeModel([fakeUser()])), async () => true, () => Session)
    Application.getInstance().instance('auth.manager', manager)
  })

  afterEach(() => Application.resetForTesting())

  it('resolves Auth.user() to the cookie-backed user inside the callback', async () => {
    const cookie = await mintSessionCookie('1')
    const runner = buildRunner()

    const user = await runner(fakeIncoming(cookie), async () => {
      const u = await Auth.user()
      return u ? { id: u.getAuthIdentifier(), email: (u as unknown as Record<string, unknown>)['email'] } : null
    })

    assert.ok(user, 'expected the callback to resolve a user from the session cookie')
    assert.equal(user.id, '1')
    assert.equal(user.email, 'john@example.com')
  })

  it('resolves Auth.user() to null when no cookie is present', async () => {
    const runner = buildRunner()
    const user = await runner(fakeIncoming(undefined), async () => await Auth.user())
    assert.equal(user, null)
  })

  it('resolves Auth.user() to null for an invalid/tampered cookie', async () => {
    const runner = buildRunner()
    const user = await runner(fakeIncoming('rjs_sess=not-a-valid-signed-value'), async () => await Auth.user())
    assert.equal(user, null)
  })

  it('rejects when a real context middleware throws (caller fails closed)', async () => {
    // AuthMiddleware resolves `auth.manager` from DI; rebind it to a shape that
    // throws when read, so the real middleware throws mid-run.
    Application.getInstance().instance('auth.manager', null as never)
    const runner = createWsContextRunner(() => [AuthMiddleware()])
    const incoming = fakeIncoming(await mintSessionCookie('1'))
    await assert.rejects(() => runner(incoming, async () => true))
  })
})

describe('AuthMiddleware — REQUEST_CONTEXT marker', () => {
  it('tags the returned middleware so the WS-upgrade runner runs it', () => {
    const mw = AuthMiddleware()
    assert.equal((mw as unknown as Record<symbol, unknown>)[REQUEST_CONTEXT], true)
  })
})
