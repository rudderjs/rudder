/**
 * Maintenance mode — Laravel's `artisan down` / `artisan up`.
 *
 * A JSON flag file at `storage/framework/down` marks the app as down. While it
 * exists, the kernel {@link maintenanceMiddleware} (auto-installed first in the
 * request pipeline by `app-builder`'s `_createHandler`) returns `503` with a
 * `Retry-After` header for every request — except requests that match the
 * allow-list or carry the bypass secret.
 *
 * **Node-only.** This module statically imports `node:fs`/`node:path` and is
 * exported only from `@rudderjs/core`'s main entry, never from
 * `@rudderjs/core/client`. `app-builder` reaches it via a lazy
 * `await import('./maintenance.js')` inside `_createHandler` (server-only).
 *
 * It must stay **client-eval-safe**: the main entry is Node-only but survives
 * browser bundles by being tree-shaken, so this module must have **no
 * module-top-level `fs`/`path` access** (the static imports bind to access-
 * throwing stubs under Vite, which is fine — only an actual `.join()`/
 * `.existsSync()` at eval crashes). Keep every `node:*` call inside a function.
 */

import fs from 'node:fs'
import path from 'node:path'
import type { AppRequest, AppResponse, MiddlewareHandler } from '@rudderjs/contracts'
import { parseCookies } from '@rudderjs/support'

/** Shape of the `storage/framework/down` flag file. */
export interface MaintenanceData {
  /** Epoch ms the app was taken down — informational. */
  time:     number
  /** Message shown in the 503 body. */
  message?: string
  /** Seconds for the `Retry-After` header. */
  retry?:   number
  /** Bypass token — a request with `?secret=<token>` is let through and gets a cookie. */
  secret?:  string
  /** Extra paths let through while down (supports a trailing `*` wildcard). */
  allow?:   string[]
}

/** Cookie name carrying the bypass secret on subsequent requests. */
export const MAINTENANCE_BYPASS_COOKIE = 'rudder_maintenance_bypass'

/**
 * Absolute path to the maintenance flag file. Joined lazily (never at module
 * top level) so this module evaluates harmlessly if it lands in a client graph.
 */
function downPath(cwd: string): string {
  return path.join(cwd, 'storage', 'framework', 'down')
}

/** `true` when the app is in maintenance mode (the flag file exists). */
export function isDownForMaintenance(cwd: string = process.cwd()): boolean {
  return fs.existsSync(downPath(cwd))
}

/** Read the maintenance flag file, or `null` when up / unreadable / malformed. */
export function maintenanceData(cwd: string = process.cwd()): MaintenanceData | null {
  try {
    return JSON.parse(fs.readFileSync(downPath(cwd), 'utf8')) as MaintenanceData
  } catch {
    return null
  }
}

/** Put the app into maintenance mode — writes the flag file (creating dirs). */
export function down(data: MaintenanceData, cwd: string = process.cwd()): void {
  const file = downPath(cwd)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(data, null, 2))
}

/** Bring the app back up — removes the flag file. Returns `false` if already up. */
export function up(cwd: string = process.cwd()): boolean {
  const file = downPath(cwd)
  if (!fs.existsSync(file)) return false
  fs.rmSync(file, { force: true })
  return true
}

// ─── Middleware ────────────────────────────────────────────


/** Path matches an allow-list entry (exact, or prefix when it ends with `*`). */
function matches(path: string, patterns: string[]): boolean {
  return patterns.some(p => (p.endsWith('*') ? path.startsWith(p.slice(0, -1)) : path === p))
}

/**
 * Static-asset file extensions let through while down so the dev overlay, HMR
 * socket, and built assets keep loading. Deliberately excludes data-ish
 * extensions (`.json`, `.csv`, `.xml`, …): gating on "last segment contains a
 * dot" let any path bypass the 503 just by ending in one (e.g.
 * `/api/users.json`, `/admin.x`, `/internal/export.csv`).
 */
const ASSET_EXTENSIONS = new Set([
  'js', 'mjs', 'cjs', 'css', 'map',
  'png', 'jpg', 'jpeg', 'gif', 'svg', 'ico', 'webp', 'avif', 'bmp',
  'woff', 'woff2', 'ttf', 'eot', 'otf',
  'wasm', 'txt', 'webmanifest',
  'mp4', 'webm', 'ogg', 'mp3', 'wav', 'pdf',
])

/** `true` for paths that look like a static asset by file extension. */
function isAssetPath(reqPath: string): boolean {
  const last = reqPath.split('/').pop() ?? ''
  const dot  = last.lastIndexOf('.')
  if (dot < 0) return false
  return ASSET_EXTENSIONS.has(last.slice(dot + 1).toLowerCase())
}

export interface MaintenanceMiddlewareOptions {
  /**
   * Paths always let through while down (in addition to any `allow` list stored
   * in the flag file). Supports a trailing `*` wildcard.
   */
  except?: string[]
}

/**
 * Kernel middleware that short-circuits every request with `503` while the app
 * is down. A pure `existsSync` no-op when the app is up, so it's cheap to keep
 * installed globally and first (Laravel's `PreventRequestsDuringMaintenance`).
 *
 * Let through while down:
 * - requests whose path matches the allow-list (`options.except` ∪ the flag
 *   file's `allow`),
 * - requests carrying the bypass secret via `?secret=<token>` (a bypass cookie
 *   is set so subsequent requests pass) or an already-set bypass cookie.
 */
export function maintenanceMiddleware(options: MaintenanceMiddlewareOptions = {}): MiddlewareHandler {
  return (req: AppRequest, res: AppResponse, next: () => Promise<void>): unknown => {
    if (!isDownForMaintenance()) return next()

    // Never gate Vite internals / static assets — keeps the dev overlay and
    // HMR socket alive even if someone runs `rudder down` in dev. Matched by a
    // known-extension allow-list, not "any dot", so app/API routes that happen
    // to contain a period (e.g. `/api/users.json`) stay gated.
    if (req.path.startsWith('/@') || isAssetPath(req.path)) {
      return next()
    }

    const data  = maintenanceData() ?? { time: 0 }
    const allow = [...(options.except ?? []), ...(data.allow ?? [])]
    if (matches(req.path, allow)) return next()

    // Bypass secret — via cookie (already bypassed) or `?secret=` (set cookie).
    if (data.secret) {
      const cookies = parseCookies(req.headers['cookie'] ?? '')
      if (cookies[MAINTENANCE_BYPASS_COOKIE] === data.secret) return next()
      if (req.query['secret'] === data.secret) {
        res.header('Set-Cookie', `${MAINTENANCE_BYPASS_COOKIE}=${data.secret}; Path=/; HttpOnly; SameSite=Strict`)
        return next()
      }
    }

    if (typeof data.retry === 'number' && data.retry > 0) {
      res.header('Retry-After', String(data.retry))
    }
    res.status(503).json({ message: data.message ?? 'Service Unavailable' })
    return Promise.resolve()
  }
}
