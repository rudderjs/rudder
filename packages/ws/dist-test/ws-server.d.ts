import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
/** The HTTP upgrade request context passed to auth callbacks. */
export interface WsAuthRequest {
    /** Raw HTTP headers from the upgrade request (includes cookies, Authorization, etc.) */
    headers: Record<string, string | string[] | undefined>;
    /** Request URL (including query string) */
    url: string;
    /** Token the client sent in the subscribe message, if any */
    token?: string;
}
/**
 * Channel auth callback.
 * - Return `true` / `false` for private channels.
 * - Return a member-info object (or `false`) for presence channels.
 */
export type AuthCallback = (req: WsAuthRequest, channel: string) => Promise<boolean | Record<string, unknown>>;
export declare function initWsServer(): void;
export declare function registerAuth(pattern: string, callback: AuthCallback): void;
/** Reset all WebSocket state. For use in tests only. */
export declare function resetWs(): void;
/** Broadcast an event to all subscribers of a channel from anywhere on the server. */
export declare function broadcast(channel: string, event: string, data: unknown): void;
/** Current connection stats. */
export declare function wsStats(): {
    connections: number;
    channels: number;
};
/**
 * Returns a Node.js HTTP `upgrade` event handler.
 * Attach this to your http.Server to enable WebSocket connections on the given path.
 *
 * @internal Used by @boostkit/vite and @boostkit/server-hono.
 */
export declare function getUpgradeHandler(wsPath?: string): (req: IncomingMessage, socket: Duplex, head: Buffer) => void;
//# sourceMappingURL=ws-server.d.ts.map