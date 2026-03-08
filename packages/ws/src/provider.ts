import { ServiceProvider, artisan, type Application } from '@boostkit/core'
import {
  initWsServer,
  getUpgradeHandler,
  registerAuth,
  wsStats,
  type AuthCallback,
} from './ws-server.js'

// ─── Config ─────────────────────────────────────────────────

export interface WsConfig {
  /** URL path the WebSocket server listens on (default: `/ws`) */
  path?: string
}

// ─── globalThis key for the upgrade handler ─────────────────

export const UPGRADE_KEY = '__boostkit_ws_upgrade__'

// ─── Factory ────────────────────────────────────────────────

interface WsFactory {
  (config?: WsConfig): new (app: Application) => ServiceProvider
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

function _ws(config: WsConfig = {}): new (app: Application) => ServiceProvider {
  const path = config.path ?? '/ws'

  return class WsServiceProvider extends ServiceProvider {
    register(): void {}

    async boot(): Promise<void> {
      initWsServer()

      // Register upgrade handler on globalThis so @boostkit/vite and
      // @boostkit/server-hono can attach it to the http.Server without
      // a hard dependency on @boostkit/ws.
      ;(globalThis as Record<string, unknown>)[UPGRADE_KEY] = getUpgradeHandler(path)

      this.publishes({
        from: new URL('../client', import.meta.url).pathname,
        to:   'src',
        tag:  'ws-client',
      })

      artisan.command('ws:connections', () => {
        const { connections, channels } = wsStats()
        console.log(`\n  Active connections : ${connections}`)
        console.log(`  Active channels    : ${channels}\n`)
      }).description('Show active WebSocket connection stats')
    }
  }
}

_ws.auth = registerAuth as (pattern: string, callback: AuthCallback) => void

export const ws = _ws as WsFactory
