// ─── Channel Types ─────────────────────────────────────────

/** Public channel — anyone can subscribe, no auth required. */
export class Channel {
  constructor(public readonly name: string) {}
}

/** Private channel — auth required. Prefixed with `private-`. */
export class PrivateChannel extends Channel {
  constructor(name: string) {
    super(`private-${name}`)
  }
}

/** Presence channel — auth required, tracks connected members. Prefixed with `presence-`. */
export class PresenceChannel extends Channel {
  constructor(name: string) {
    super(`presence-${name}`)
  }
}
