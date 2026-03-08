import { WebSocketServer, WebSocket as WsSocket } from 'ws';
// ─── Global state ───────────────────────────────────────────
const g = globalThis;
const KEY = '__boostkit_ws__';
const AUTH_KEY = '__boostkit_ws_auth__';
// ─── Init ───────────────────────────────────────────────────
export function initWsServer() {
    if (g[KEY])
        return; // already running (HMR / hot-reload)
    const wss = new WebSocketServer({ noServer: true });
    const state = {
        wss,
        subscriptions: new Map(),
        channels: new Map(),
        presence: new Map(),
        sockets: new Map(),
        upgradeReqs: new Map(),
        counter: 0,
    };
    g[KEY] = state;
    wss.on('connection', (ws, req) => {
        void onConnection(state, ws, req);
    });
}
// ─── Auth registry ──────────────────────────────────────────
export function registerAuth(pattern, callback) {
    if (!g[AUTH_KEY])
        g[AUTH_KEY] = new Map();
    g[AUTH_KEY].set(pattern, callback);
}
function matchPattern(pattern, channel) {
    const re = new RegExp('^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^.]+') + '$');
    return re.test(channel);
}
function findAuth(channel) {
    const map = g[AUTH_KEY];
    if (!map)
        return undefined;
    for (const [pattern, cb] of map) {
        if (matchPattern(pattern, channel))
            return cb;
    }
    return undefined;
}
// ─── Helpers ────────────────────────────────────────────────
function nextId(state) {
    return `bk${++state.counter}${Math.random().toString(36).slice(2, 7)}`;
}
function send(ws, data) {
    if (ws.readyState === WsSocket.OPEN)
        ws.send(JSON.stringify(data));
}
function broadcastTo(state, channel, data, excludeId) {
    for (const sid of state.channels.get(channel) ?? []) {
        if (sid === excludeId)
            continue;
        const ws = state.sockets.get(sid);
        if (ws)
            send(ws, data);
    }
}
// ─── Connection lifecycle ───────────────────────────────────
async function onConnection(state, ws, req) {
    const id = nextId(state);
    state.sockets.set(id, ws);
    state.subscriptions.set(id, new Set());
    state.upgradeReqs.set(id, req);
    send(ws, { type: 'connected', socketId: id });
    ws.on('message', (raw) => {
        let msg;
        try {
            msg = JSON.parse(String(raw));
        }
        catch {
            send(ws, { type: 'error', message: 'Invalid JSON' });
            return;
        }
        void onMessage(state, id, ws, req, msg);
    });
    ws.on('close', () => { disconnect(state, id); });
}
async function onMessage(state, id, ws, req, msg) {
    switch (msg.type) {
        case 'ping':
            send(ws, { type: 'pong' });
            break;
        case 'subscribe': {
            const { channel, token } = msg;
            const isPrivate = channel.startsWith('private-');
            const isPresence = channel.startsWith('presence-');
            if (isPrivate || isPresence) {
                const authFn = findAuth(channel);
                if (!authFn) {
                    send(ws, { type: 'error', channel, message: 'Unauthorized' });
                    return;
                }
                const authReq = {
                    headers: req.headers,
                    url: req.url ?? '/',
                    ...(token !== undefined ? { token } : {}),
                };
                const result = await authFn(authReq, channel).catch(() => false);
                if (!result) {
                    send(ws, { type: 'error', channel, message: 'Unauthorized' });
                    return;
                }
                if (isPresence && typeof result === 'object') {
                    if (!state.presence.has(channel))
                        state.presence.set(channel, new Map());
                    state.presence.get(channel).set(id, result);
                }
            }
            if (!state.channels.has(channel))
                state.channels.set(channel, new Set());
            state.channels.get(channel).add(id);
            state.subscriptions.get(id).add(channel);
            send(ws, { type: 'subscribed', channel });
            if (isPresence) {
                const members = [...(state.presence.get(channel)?.values() ?? [])];
                send(ws, { type: 'presence.members', channel, members });
                const me = state.presence.get(channel)?.get(id);
                broadcastTo(state, channel, { type: 'presence.joined', channel, user: me }, id);
            }
            break;
        }
        case 'unsubscribe':
            leaveChannel(state, id, msg.channel);
            send(ws, { type: 'unsubscribed', channel: msg.channel });
            break;
        case 'client-event': {
            const { channel, event, data } = msg;
            if (!state.subscriptions.get(id)?.has(channel)) {
                send(ws, { type: 'error', message: 'Not subscribed to channel' });
                return;
            }
            broadcastTo(state, channel, { type: 'event', channel, event, data }, id);
            break;
        }
    }
}
function leaveChannel(state, id, channel) {
    state.channels.get(channel)?.delete(id);
    if ((state.channels.get(channel)?.size ?? 0) === 0)
        state.channels.delete(channel);
    state.subscriptions.get(id)?.delete(channel);
    if (channel.startsWith('presence-')) {
        const memberInfo = state.presence.get(channel)?.get(id);
        state.presence.get(channel)?.delete(id);
        if ((state.presence.get(channel)?.size ?? 0) === 0)
            state.presence.delete(channel);
        if (memberInfo) {
            broadcastTo(state, channel, { type: 'presence.left', channel, user: memberInfo });
        }
    }
}
function disconnect(state, id) {
    for (const ch of [...(state.subscriptions.get(id) ?? [])]) {
        leaveChannel(state, id, ch);
    }
    state.subscriptions.delete(id);
    state.sockets.delete(id);
    state.upgradeReqs.delete(id);
}
// ─── Test helpers ───────────────────────────────────────────
/** Reset all WebSocket state. For use in tests only. */
export function resetWs() {
    const state = g[KEY];
    if (state) {
        // Terminate all open client connections first so server.close() doesn't hang
        for (const ws of state.sockets.values()) {
            try {
                ws.terminate();
            }
            catch { /* ignore */ }
        }
        try {
            state.wss.close();
        }
        catch { /* ignore */ }
    }
    delete g[KEY];
    delete g[AUTH_KEY];
}
// ─── Public API ─────────────────────────────────────────────
/** Broadcast an event to all subscribers of a channel from anywhere on the server. */
export function broadcast(channel, event, data) {
    const state = g[KEY];
    if (!state)
        return;
    broadcastTo(state, channel, { type: 'event', channel, event, data });
}
/** Current connection stats. */
export function wsStats() {
    const state = g[KEY];
    if (!state)
        return { connections: 0, channels: 0 };
    return { connections: state.sockets.size, channels: state.channels.size };
}
/**
 * Returns a Node.js HTTP `upgrade` event handler.
 * Attach this to your http.Server to enable WebSocket connections on the given path.
 *
 * @internal Used by @boostkit/vite and @boostkit/server-hono.
 */
export function getUpgradeHandler(wsPath = '/ws') {
    return (req, socket, head) => {
        const pathname = (req.url ?? '/').split('?')[0];
        if (pathname !== wsPath)
            return; // not our path — leave for other handlers (e.g. Vite HMR)
        const state = g[KEY];
        if (!state) {
            socket.destroy();
            return;
        }
        state.wss.handleUpgrade(req, socket, head, (ws) => {
            state.wss.emit('connection', ws, req);
        });
    };
}
//# sourceMappingURL=ws-server.js.map