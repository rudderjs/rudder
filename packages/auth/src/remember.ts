import { AsyncLocalStorage } from 'node:async_hooks'
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { bootNotice } from '@rudderjs/core'

// ─── "Remember me" persistent-login support ───────────────
//
// A remember cookie lets a user stay signed in across browser restarts even
// after the session cookie expires. The flow (Laravel parity):
//
//   - `Auth.attempt(creds, true)` / `Auth.login(user, true)` mints a random
//     token, stores it on the user's `rememberToken` column, and queues a
//     long-lived signed cookie carrying `userId:token`.
//   - On a later request with no session but a valid remember cookie,
//     `AuthMiddleware` looks the user up by id, constant-time-compares the
//     cookie token against the stored one, and (on match) re-establishes the
//     session. The token is NOT rotated per request — it changes only on a
//     fresh remember-login or on logout, so multiple devices share it and a
//     single logout invalidates them all (matches Laravel).
//   - `Auth.logout()` cycles the stored token (invalidating every outstanding
//     remember cookie) and queues a cookie deletion.

export interface RememberCookieAttrs {
  /** Cookie name. */
  cookie: string
  /** Cookie lifetime in days. */
  lifetime: number
  secure: boolean
  sameSite: 'lax' | 'strict' | 'none'
  path: string
}

export type RememberDirective =
  | { action: 'set'; userId: string; token: string }
  | { action: 'clear' }

interface RememberBag { directive: RememberDirective | null }

// globalThis-hoisted ALS, same duplicate-bundle reasoning as the auth ALS.
const ALS_KEY = '__rudderjs_auth_remember_als__'
const _alsGlobal = globalThis as Record<string, unknown>
const _als: AsyncLocalStorage<RememberBag> = (_alsGlobal[ALS_KEY] as AsyncLocalStorage<RememberBag> | undefined)
  ?? (() => { const a = new AsyncLocalStorage<RememberBag>(); _alsGlobal[ALS_KEY] = a; return a })()

/** Establish a request-scoped channel for the remember directive. */
export function runWithRemember<T>(fn: () => T): T {
  return _als.run({ directive: null }, fn)
}

/** Queue a remember directive from the guard (login/logout). No-op outside a
 *  request scope (CLI/queue) — there's no response cookie to write there. */
export function setRememberDirective(directive: RememberDirective): void {
  const bag = _als.getStore()
  if (bag) bag.directive = directive
}

/** Read and clear the queued directive (consumed by AuthMiddleware). */
export function takeRememberDirective(): RememberDirective | null {
  const bag = _als.getStore()
  if (!bag) return null
  const directive = bag.directive
  bag.directive = null
  return directive
}

/** A fresh 256-bit remember token (hex). */
export function newRememberToken(): string {
  return randomBytes(32).toString('hex')
}

/** Read a single cookie value out of a `Cookie` request header. */
export function parseCookie(header: string, name: string): string | undefined {
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim()
  }
  return undefined
}

/** Constant-time string compare, length-safe. */
export function safeStringEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

function hmac(value: string, secret: string): string {
  return createHmac('sha256', secret).update(value).digest('base64url')
}

/** Sign `userId:token` into a self-verifying cookie value. */
export function encodeRememberCookie(userId: string, token: string, secret: string): string {
  const body = Buffer.from(JSON.stringify({ id: userId, token })).toString('base64url')
  return `${body}.${hmac(body, secret)}`
}

/** Verify + parse a remember cookie. Returns null on any tampering. */
export function decodeRememberCookie(value: string, secret: string): { userId: string; token: string } | null {
  const dot = value.lastIndexOf('.')
  if (dot <= 0) return null
  const body = value.slice(0, dot)
  const sig  = value.slice(dot + 1)
  const expected = hmac(body, secret)
  // Constant-time signature check before touching the payload.
  const sigBuf = Buffer.from(sig, 'base64url')
  const expBuf = Buffer.from(expected, 'base64url')
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) return null
  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Record<string, unknown>
    const id = parsed['id']
    const token = parsed['token']
    if (typeof id !== 'string' || typeof token !== 'string' || !id || !token) return null
    return { userId: id, token }
  } catch {
    return null
  }
}

/** Build the `Set-Cookie` value for a remember cookie (or its deletion). */
export function buildRememberCookie(value: string | null, attrs: RememberCookieAttrs): string {
  const maxAge = value === null ? 0 : attrs.lifetime * 24 * 60 * 60
  const parts = [
    `${attrs.cookie}=${value ?? ''}`,
    `Path=${attrs.path}`,
    `Max-Age=${maxAge}`,
    `SameSite=${attrs.sameSite}`,
    'HttpOnly',
  ]
  // SameSite=None requires Secure (browsers drop it otherwise); same rule the
  // session driver follows.
  if (attrs.secure || attrs.sameSite === 'none') parts.push('Secure')
  return parts.join('; ')
}

/** Cookie attributes (name/lifetime/flags). Never throws — safe to call on
 *  every request to learn the cookie name without resolving the secret. */
export function rememberCookieAttrs(overrides: Partial<RememberCookieAttrs> = {}): RememberCookieAttrs {
  return {
    cookie:   overrides.cookie   ?? 'rudderjs_remember',
    lifetime: overrides.lifetime ?? 400, // days; browsers cap persistent cookies at ~400d
    secure:   overrides.secure   ?? (process.env['NODE_ENV'] === 'production'),
    sameSite: overrides.sameSite ?? 'lax',
    path:     overrides.path     ?? '/',
  }
}

let _devSecretWarned = false

/** Resolve the HMAC secret used to sign remember cookies. Mirrors the
 *  PasswordBroker posture: throws in production when `AUTH_SECRET` is unset,
 *  falls back to a dev placeholder (with a one-time notice) otherwise. Only
 *  called when a remember cookie is actually being signed or verified, so an
 *  app that never uses remember-me is never forced to set the secret. */
export function resolveRememberSecret(override?: string): string {
  if (override) return override
  const envSecret = process.env['AUTH_SECRET']
  if (envSecret) return envSecret
  if (process.env['NODE_ENV'] === 'production') {
    throw new Error(
      '[RudderJS Auth] "remember me" requires AUTH_SECRET in production so the ' +
      'remember cookie can be signed. Set AUTH_SECRET (>= 32 chars) in .env.',
    )
  }
  if (!_devSecretWarned) {
    bootNotice('auth', 'using a dev remember-me secret, set AUTH_SECRET (>= 32 chars) for production')
    _devSecretWarned = true
  }
  return 'rudderjs-dev-remember-secret'
}
