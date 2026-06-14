---
"@rudderjs/broadcast": patch
---

Deny presence-channel subscriptions whose auth callback returns a truthy non-object. A presence auth callback is expected to return member info (an object), but a return of `true` (valid for a private channel, an easy copy/paste mistake) passed the authorization gate while the separate `typeof result === 'object'` check skipped member registration. The socket was fully subscribed and received every broadcast, yet stayed invisible in the presence roster: absent from the `presence.members` snapshot, no `presence.joined`/`presence.left` events, with no error surfaced to the developer. Presence subscriptions now fail closed when the auth result is not a non-null object, returning an Unauthorized error frame and a rejection observer event.
