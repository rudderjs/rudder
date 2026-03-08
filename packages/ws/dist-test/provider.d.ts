import { ServiceProvider, type Application } from '@boostkit/core';
import { type AuthCallback } from './ws-server.js';
export interface WsConfig {
    /** URL path the WebSocket server listens on (default: `/ws`) */
    path?: string;
}
export declare const UPGRADE_KEY = "__boostkit_ws_upgrade__";
interface WsFactory {
    (config?: WsConfig): new (app: Application) => ServiceProvider;
    /**
     * Register a channel auth callback.
     *
     * Pattern supports `*` as a single-segment wildcard:
     *   `'private-orders.*'` matches `'private-orders.123'`
     *
     * Return `true`/`false` for private channels.
     * Return a member-info object (or `false`) for presence channels.
     */
    auth(pattern: string, callback: AuthCallback): void;
}
export declare const ws: WsFactory;
export {};
//# sourceMappingURL=provider.d.ts.map