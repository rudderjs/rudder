/**
 * Maintenance mode — Laravel's `artisan down` / `artisan up`.
 *
 * A JSON flag file at `storage/framework/down` marks the app as down. While it
 * exists, the kernel {@link maintenanceMiddleware} (auto-installed first in the
 * request pipeline by `app-builder`'s `_createHandler`) returns `503` with a
 * `Retry-After` header for every request — except requests that match the
 * allow-list or carry the bypass secret.
 *
 * **Node-only.** This module statically imports `node:fs`/`node:path`, so it is
 * exported only from `@rudderjs/core`'s main entry, never from
 * `@rudderjs/core/client`. `app-builder` reaches it via a lazy
 * `await import('./maintenance.js')` inside `_createHandler` (server-only), so
 * the client bundle never evaluates it.
 */

import fs from 'node:fs'
import path from 'node:path'
import type { AppRequest, AppResponse, MiddlewareHandler } from '@rudderjs/contracts'

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

/** App-relative path to the maintenance flag file. */
const DOWN_FILE = path.join('storage', 'framework', 'down')

/** Cookie name carrying the bypass secret on subsequent requests. */
export const MAINTENANCE_BYPASS_COOKIE = 'rudder_maintenance_bypass'

function downPath(cwd: string): string {
  return path.join(cwd, DOWN_FILE)
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

function parseCookies(header: string): Record<string, string> {
  return Object.fromEntries(
    header.split(';')
      .map(c => c.trim().split('='))
      .filter(([k]) => k?.trim())
      .map(([k, ...v]) => [(k ?? '').trim(), v.join('=')]),
  )
}

/** Path matches an allow-list entry (exact, or prefix when it ends with `*`). */
function matches(path: string, patterns: string[]): boolean {
  return patterns.some(p => (p.endsWith('*') ? path.startsWith(p.slice(0, -1)) : path === p))
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
    // HMR socket alive even if someone runs `rudder down` in dev.
    if (req.path.startsWith('/@') || (req.path.split('/').pop() ?? '').includes('.')) {
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
