import { fileURLToPath } from 'node:url'
import { ServiceProvider, rudder, config } from '@rudderjs/core'
import {
  initWsServer,
  isWsServerRunning,
  getUpgradeHandler,
  registerAuth,
  registerConnectionAuth,
  broadcastStats,
  type AuthCallback,
  type ConnectionAuthCallback,
} from './ws-server.js'
import type { BroadcastDriver } from './driver.js'

// ─── Config ─────────────────────────────────────────────────

export interface BroadcastConfig {
  /** URL path the WebSocket server listens on (default: `/ws`) */
  path?: string
  /**
   * Origin allowlist for WebSocket upgrade requests. When set, the
   * `Origin` header is compared against this list and mismatches receive
   * HTTP 403. When unset, all origins are accepted (with a one-time
   * startup warning). Set this in production to close the CSRF-style
   * cross-origin attack window on cookie-auth'd channels.
   */
  allowedOrigins?: string[]
  /**
   * Per-IP connection cap. Rejects upgrades from an IP that already has
   * this many open connections with HTTP 429. `undefined` / `0` disables.
   */
  maxConnectionsPerIp?: number
  /**
   * Server-side heartbeat. The server sends a WebSocket PING every
   * `interval` ms; if no PONG arrives within `timeout` ms the socket is
   * terminated. Pass `false` to disable. Default: `{ interval: 30000, timeout: 60000 }`.
   */
  heartbeat?: { interval: number; timeout: number } | false
  /**
   * Cross-instance pub/sub driver factory. Returns a {@link BroadcastDriver}
   * (sync or async). When unset, the broadcast layer uses the in-process
   * `LocalDriver` — fine for single-instance deployments. Set this to a
   * `RedisDriver` (or similar) factory for multi-instance fan-out.
   *
   * @example
   * import { RedisDriver } from '@rudderjs/broadcast-redis'
   * import Redis from 'ioredis'
   *
   * export default {
   *   driver: () => new RedisDriver({ redis: process.env.REDIS_URL! }),
   * }
   */
  driver?: () => BroadcastDriver | Promise<BroadcastDriver>
}

// ─── globalThis key for the upgrade handler ─────────────────

export const UPGRADE_KEY = '__rudderjs_ws_upgrade__'

// ─── Broadcast facade ────────────────────────────────────────

/**
 * Broadcast facade — register channel auth callbacks.
 *
 * @example
 * // routes/channels.ts
 * import { Broadcast } from '@rudderjs/broadcast'
 *
 * Broadcast.channel('private-orders.*', async (req, channel) => {
 *   return req.token === 'valid'
 * })
 *
 * Broadcast.channel('presence-room.*', async (req) => {
 *   return { id: 'user-1', name: 'Alice' }  // member info
 * })
 */
export const Broadcast = {
  /**
   * Register a channel auth callback.
   *
   * Pattern supports `*` as a single-segment wildcard:
   *   `'private-orders.*'` matches `'private-orders.123'`
   *
   * Return `true`/`false` for private channels.
   * Return a member-info object (or `false`) for presence channels.
   */
  channel: registerAuth as (pattern: string, callback: AuthCallback) => void,

  /**
   * Register a per-connection auth callback. Invoked once at WebSocket
   * upgrade time, before the socket is upgraded. Returning `false`
   * rejects the upgrade with HTTP 401 — useful for requiring a valid
   * session cookie, bearer token, or other gate before any subscribe
   * is even possible.
   *
   * Only one callback may be registered at a time; calling again replaces.
   *
   * @example
   * Broadcast.authConnection(async (req) => {
   *   return Boolean(req.headers.cookie?.includes('session='))
   * })
   */
  authConnection: registerConnectionAuth as (callback: ConnectionAuthCallback) => void,
}

// ─── Provider ───────────────────────────────────────────────

export class BroadcastingProvider extends ServiceProvider {
  register(): void {}

  async boot(): Promise<void> {
    const cfg  = config<BroadcastConfig>('broadcast', {})
    const path = cfg.path ?? '/ws'

    // Build the driver only on first boot. initWsServer() is init-once (it
    // early-returns on dev HMR re-boots), so a driver constructed on every boot
    // would be discarded by that early return — leaking its Redis pub/sub
    // connections per edit. On re-boot the live ws-server keeps its driver.
    const driver = cfg.driver && !isWsServerRunning() ? await cfg.driver() : undefined

    initWsServer({
      ...(cfg.allowedOrigins      ? { allowedOrigins:      cfg.allowedOrigins      } : {}),
      ...(cfg.maxConnectionsPerIp ? { maxConnectionsPerIp: cfg.maxConnectionsPerIp } : {}),
      ...(cfg.heartbeat !== undefined ? { heartbeat: cfg.heartbeat } : {}),
      ...(driver !== undefined        ? { driver }                  : {}),
    })

      // Register upgrade handler on globalThis so @rudderjs/vite and
      // @rudderjs/server-hono can attach it to the http.Server without
      // a hard dependency on @rudderjs/broadcast.
      // Store both the broadcast-specific handler AND the combined handler
      // so that @rudderjs/sync can chain without circular references on HMR.
      const handler = getUpgradeHandler(path)
      ;(globalThis as Record<string, unknown>)['__rudderjs_ws_broadcast_upgrade__'] = handler
      ;(globalThis as Record<string, unknown>)[UPGRADE_KEY] = handler

      this.publishes({
        from: fileURLToPath(new URL(/* @vite-ignore */ '../client', import.meta.url)),
        to:   'src',
        tag:  'broadcast-client',
      })

    rudder.command('broadcast:connections', () => {
      const { connections, channels } = broadcastStats()
      console.log(`\n  Active connections : ${connections}`)
      console.log(`  Active channels    : ${channels}\n`)
    }).description('Show active WebSocket connection stats')
  }
}
