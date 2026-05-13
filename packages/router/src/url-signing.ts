import type { AppRequest, MiddlewareHandler } from '@rudderjs/contracts'
import { route } from './index.js'

// ─── node:crypto lazy load ─────────────────────────────────
//
// Lazy-load node:crypto to avoid bundling it into the client. Only used by
// Url (signed URLs) and ValidateSignature — server-only features. The
// fire-and-forget import preloads on server and is a no-op in the browser
// where `globalThis.process` is undefined.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _crypto: { createHmac: any; timingSafeEqual: any } | undefined
if (typeof globalThis.process !== 'undefined') {
  import(/* @vite-ignore */ 'node:crypto').then(m => { _crypto = m }).catch(() => {})
}

// ─── Signing key + helpers ─────────────────────────────────

let _urlKey = ''

function _getSigningKey(): string {
  const key = _urlKey || process.env['APP_KEY'] || ''
  if (!key) throw new Error('[RudderJS] No signing key configured. Set APP_KEY in your .env or call Url.setKey().')
  return key
}

function _splitPath(path: string): [string, string] {
  const idx = path.indexOf('?')
  return idx === -1 ? [path, ''] : [path.slice(0, idx), path.slice(idx + 1)]
}

function _computeSignature(pathname: string, params: URLSearchParams): string {
  // Sort params for deterministic signing (exclude 'signature' itself)
  const sorted = new URLSearchParams(
    [...params.entries()]
      .filter(([k]) => k !== 'signature')
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
  )
  const toSign = sorted.size > 0 ? `${pathname}?${sorted.toString()}` : pathname
  if (!_crypto) throw new Error('[RudderJS Router] node:crypto not available — Url signing requires a server environment.')
  return _crypto.createHmac('sha256', _getSigningKey()).update(toSign).digest('hex')
}

// ─── Url ───────────────────────────────────────────────────

export class Url {
  /**
   * Override the HMAC signing key used for signed URLs.
   * Falls back to `process.env.APP_KEY`.
   */
  static setKey(key: string): void {
    _urlKey = key
  }

  /** The full URL of the current request. */
  static current(req: AppRequest): string {
    return req.url
  }

  /** The previous URL from the `Referer` header, or `fallback`. */
  static previous(req: AppRequest, fallback = '/'): string {
    return req.headers['referer'] ?? fallback
  }

  /**
   * Generate a signed URL for a named route.
   *
   * @example
   * Url.signedRoute('invoice.download', { id: 42 })
   * // → '/invoice/42?signature=abc123'
   */
  static signedRoute(
    name: string,
    params: Record<string, string | number> = {},
    expiresAt?: Date,
  ): string {
    return Url.sign(route(name, params), expiresAt)
  }

  /**
   * Generate a signed URL that expires after `seconds` seconds.
   *
   * @example
   * Url.temporarySignedRoute('invoice.download', 3600, { id: 42 })
   * // → '/invoice/42?expires=1234567890&signature=abc123'
   */
  static temporarySignedRoute(
    name: string,
    seconds: number,
    params: Record<string, string | number> = {},
  ): string {
    return Url.signedRoute(name, params, new Date(Date.now() + seconds * 1000))
  }

  /**
   * Sign an arbitrary path string.
   * Appends `?signature=...` (and `?expires=...` if `expiresAt` given).
   */
  static sign(path: string, expiresAt?: Date): string {
    const [pathname, search] = _splitPath(path)
    const params = new URLSearchParams(search)

    if (expiresAt) {
      params.set('expires', String(Math.floor(expiresAt.getTime() / 1000)))
    }

    const sig = _computeSignature(pathname, params)
    params.set('signature', sig)

    return `${pathname}?${params.toString()}`
  }

  /**
   * Return `true` if the request has a valid (and non-expired) signature.
   */
  static isValidSignature(req: AppRequest): boolean {
    // `req.url` may be a full URL (Hono adapter populates protocol+host+path+query)
    // or a bare path. `Url.sign(path)` only ever signs the pathname, so verification
    // must hash the same shape. Use the URL parser so both forms collapse to a
    // pathname + searchParams pair.
    const u = new URL(req.url, 'http://placeholder.local')
    const pathname = u.pathname
    const params = u.searchParams

    const signature = params.get('signature')
    if (!signature) return false

    // Check expiry before touching the signature
    const expires = params.get('expires')
    if (expires !== null) {
      const expiry = parseInt(expires, 10)
      if (isNaN(expiry) || Date.now() / 1000 > expiry) return false
    }

    const expected = _computeSignature(pathname, params)

    if (!_crypto) return signature === expected
    const sigBuf = Buffer.from(signature)
    const expBuf = Buffer.from(expected)
    if (sigBuf.length !== expBuf.length) return false
    return _crypto.timingSafeEqual(sigBuf, expBuf)
  }
}

// ─── ValidateSignature middleware ───────────────────────────

/**
 * Middleware that verifies a signed URL signature.
 * Responds with 403 if the signature is missing, invalid, or expired.
 *
 * @example
 * router.get('/invoice/:id/download', handler, [ValidateSignature()])
 */
export function ValidateSignature(): MiddlewareHandler {
  return async (req, res, next) => {
    if (!Url.isValidSignature(req)) {
      return res.status(403).json({ message: 'Invalid or expired URL signature.' })
    }
    await next()
  }
}
