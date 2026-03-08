import { ServiceProvider, artisan } from '@boostkit/core';
import { initWsServer, getUpgradeHandler, registerAuth, wsStats, } from './ws-server.js';
// ─── globalThis key for the upgrade handler ─────────────────
export const UPGRADE_KEY = '__boostkit_ws_upgrade__';
function _ws(config = {}) {
    const path = config.path ?? '/ws';
    return class WsServiceProvider extends ServiceProvider {
        register() { }
        async boot() {
            initWsServer();
            globalThis[UPGRADE_KEY] = getUpgradeHandler(path);
            this.publishes({
                from: new URL('../client', import.meta.url).pathname,
                to: 'src',
                tag: 'ws-client',
            });
            artisan.command('ws:connections', () => {
                const { connections, channels } = wsStats();
                console.log(`\n  Active connections : ${connections}`);
                console.log(`  Active channels    : ${channels}\n`);
            }).description('Show active WebSocket connection stats');
        }
    };
}
_ws.auth = registerAuth;
export const ws = _ws;
//# sourceMappingURL=provider.js.map