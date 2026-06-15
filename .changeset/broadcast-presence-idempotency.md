---
"@rudderjs/broadcast": patch
---

Make presence subscribes idempotent and clarify multi-instance presence behavior.

- **Re-subscribing a presence channel no longer re-broadcasts `presence.joined`.** A socket already subscribed to a channel could send another `subscribe` frame and trigger a second `presence.joined` to every peer (and re-run the auth callback), while disconnect only ever emits one `presence.left`. Append-only client rosters were left with ghost duplicate members. Re-subscribe is now idempotent — it returns a fresh `subscribed` confirmation (and, for presence, the current roster) without re-auth or a duplicate join broadcast, matching Pusher's already-subscribed semantics.
- **Presence is documented as per-instance, with a boot-time notice.** Presence rosters and `presence.joined` / `presence.left` deltas are tracked in each instance's memory and are NOT fanned across the cross-instance driver (regular `broadcast()` / `client-event` traffic IS). The docs previously claimed presence was "unchanged" on multi-instance deployments; they now state the limitation, and the provider logs a one-time notice at boot when a cross-instance driver is configured.
