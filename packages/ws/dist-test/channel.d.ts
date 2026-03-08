/** Public channel — anyone can subscribe, no auth required. */
export declare class Channel {
    readonly name: string;
    constructor(name: string);
}
/** Private channel — auth required. Prefixed with `private-`. */
export declare class PrivateChannel extends Channel {
    constructor(name: string);
}
/** Presence channel — auth required, tracks connected members. Prefixed with `presence-`. */
export declare class PresenceChannel extends Channel {
    constructor(name: string);
}
//# sourceMappingURL=channel.d.ts.map