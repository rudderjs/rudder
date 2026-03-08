// ─── Channel Types ─────────────────────────────────────────
/** Public channel — anyone can subscribe, no auth required. */
export class Channel {
    name;
    constructor(name) {
        this.name = name;
    }
}
/** Private channel — auth required. Prefixed with `private-`. */
export class PrivateChannel extends Channel {
    constructor(name) {
        super(`private-${name}`);
    }
}
/** Presence channel — auth required, tracks connected members. Prefixed with `presence-`. */
export class PresenceChannel extends Channel {
    constructor(name) {
        super(`presence-${name}`);
    }
}
//# sourceMappingURL=channel.js.map