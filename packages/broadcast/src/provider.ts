import { ServiceProvider, artisan, type Application } from '@boostkit/core'
import {
  initWsServer,
  getUpgradeHandler,
  registerAuth,
  broadcastStats,
  type AuthCallback,
} from './ws-server.js'

// ─── Config ─────────────────────────────────────────────────

export interface BroadcastConfig {
  /** URL path the WebSocket server listens on (default: `/ws`) */
  path?: string
}

// ─── globalThis key for the upgrade handler ─────────────────

export const UPGRADE_KEY = '__boostkit_ws_upgrade__'

// ─── Broadcast facade ────────────────────────────────────────

/**
 * Broadcast facade — register channel auth callbacks.
 *
 * @example
 * // routes/channels.ts
 * import { Broadcast } from '@boostkit/broadcast'
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
}

// ─── Factory ────────────────────────────────────────────────

export function broadcasting(config: BroadcastConfig = {}): new (app: Application) => ServiceProvider {
  const path = config.path ?? '/ws'

  return class BroadcastServiceProvider extends ServiceProvider {
    register(): void {}

    async boot(): Promise<void> {
      initWsServer()

      // Register upgrade handler on globalThis so @boostkit/vite and
      // @boostkit/server-hono can attach it to the http.Server without
      // a hard dependency on @boostkit/broadcast.
      // Store both the broadcast-specific handler AND the combined handler
      // so that @boostkit/live can chain without circular references on HMR.
      const handler = getUpgradeHandler(path)
      ;(globalThis as Record<string, unknown>)['__boostkit_ws_broadcast_upgrade__'] = handler
      ;(globalThis as Record<string, unknown>)[UPGRADE_KEY] = handler

      this.publishes({
        from: new URL('../client', import.meta.url).pathname,
        to:   'src',
        tag:  'broadcast-client',
      })

      artisan.command('broadcast:connections', () => {
        const { connections, channels } = broadcastStats()
        console.log(`\n  Active connections : ${connections}`)
        console.log(`  Active channels    : ${channels}\n`)
      }).description('Show active WebSocket connection stats')
    }
  }
}
