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

// ─── Factory ────────────────────────────────────────────────

interface BroadcastingFactory {
  (config?: BroadcastConfig): new (app: Application) => ServiceProvider
  /**
   * Register a channel auth callback.
   *
   * Pattern supports `*` as a single-segment wildcard:
   *   `'private-orders.*'` matches `'private-orders.123'`
   *
   * Return `true`/`false` for private channels.
   * Return a member-info object (or `false`) for presence channels.
   */
  auth(pattern: string, callback: AuthCallback): void
}

function _broadcasting(config: BroadcastConfig = {}): new (app: Application) => ServiceProvider {
  const path = config.path ?? '/ws'

  return class BroadcastServiceProvider extends ServiceProvider {
    register(): void {}

    async boot(): Promise<void> {
      initWsServer()

      // Register upgrade handler on globalThis so @boostkit/vite and
      // @boostkit/server-hono can attach it to the http.Server without
      // a hard dependency on @boostkit/broadcast.
      ;(globalThis as Record<string, unknown>)[UPGRADE_KEY] = getUpgradeHandler(path)

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

_broadcasting.auth = registerAuth as (pattern: string, callback: AuthCallback) => void

export const broadcasting = _broadcasting as BroadcastingFactory
